import {
  createCipheriv,
  createDecipheriv,
  hkdfSync,
  randomBytes,
  randomInt,
} from "node:crypto";
import bcrypt from "bcrypt";
import type { MembershipRole, Prisma } from "@prisma/client";
import { prisma } from "../../config/prisma.js";
import { withCrossTenant } from "../../config/tenantScope.js";
import { env } from "../../config/env.js";
import { logger } from "../../config/logger.js";
import { AppError } from "../../common/errors/AppError.js";
import { ErrorCodes } from "../../common/errors/errorCodes.js";
import { auditService } from "../audit/audit.service.js";
import { generateTotpSecret, totpUri, verifyTotp } from "./totp.js";
import { SYSTEM_TENANT_ID } from "./auth.types.js";

/**
 * Multi-factor authentication — AC-002, Security §5.
 *
 * "MFA is enforced for Owners, Admins and Support actors." Nothing in the
 * product had a second factor: no secret, no enrolment, no challenge. The
 * admin dashboard carried a hardcoded `MFA_SUPPORTED = false` precisely so it
 * would stop reporting a control that did not exist.
 *
 * Two decisions shape everything here.
 *
 * The first is that enforcement lives at session issuance rather than at the
 * point of a privileged action. A half-privileged session that can read but
 * not act would have to be understood by every route in the product; refusing
 * to mint the session at all is one rule in one place. The cost is that a
 * newly privileged account has to enrol before it gets its first session,
 * which is why enrolment can be completed while holding only a challenge
 * token.
 *
 * The second is that the requirement follows the *membership role*, not the
 * console the session was opened for. An Owner signing into the member
 * console is still an Owner and could switch consoles at will, so basing the
 * requirement on the narrower acting role would be a bypass with extra steps.
 */

/** The roles AC-002 names. MEMBER may enrol, but is not compelled to. */
const MFA_REQUIRED_ROLES: MembershipRole[] = ["OWNER", "ADMIN", "SUPPORT"];

/** How many recovery codes an enrolment issues. */
const RECOVERY_CODE_COUNT = 10;

/** Failed challenges tolerated per account before it is locked out briefly. */
const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_WINDOW_MS = 15 * 60 * 1000;

const ALGORITHM = "aes-256-gcm";

export function roleRequiresMfa(role: MembershipRole): boolean {
  return MFA_REQUIRED_ROLES.includes(role);
}

let warnedAboutDerivedKey = false;

/**
 * The key the TOTP secret is encrypted with.
 *
 * `ENCRYPTION_KEY` when it is configured, which is the deployment answer. It
 * is optional in the environment schema, though, and MFA is not optional for
 * a privileged account — so rather than making enrolment fail on a machine
 * without that variable, the key is derived from `JWT_ACCESS_SECRET`, which
 * is always present and already the most sensitive value the process holds.
 *
 * The trade-off is real and worth stating: with the derived key, rotating
 * `JWT_ACCESS_SECRET` invalidates every enrolment as well as every session,
 * and everyone re-enrols. Setting `ENCRYPTION_KEY` decouples the two.
 */
function secretKey(): Buffer {
  const configured = env.ENCRYPTION_KEY;
  if (configured && configured.length === 64) return Buffer.from(configured, "hex");

  if (!warnedAboutDerivedKey) {
    warnedAboutDerivedKey = true;
    logger.warn(
      { control: "AC-002" },
      "ENCRYPTION_KEY is not set; MFA secrets are encrypted with a key derived from JWT_ACCESS_SECRET. Rotating that secret will require every user to re-enrol."
    );
  }
  // Domain-separated, so this key cannot collide with any other use of the
  // same input.
  return Buffer.from(
    hkdfSync("sha256", env.JWT_ACCESS_SECRET, "zoiko.mfa", "zoiko.mfa.secret.v1", 32)
  );
}

function encryptSecret(plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGORITHM, secretKey(), iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return [
    iv.toString("base64"),
    cipher.getAuthTag().toString("base64"),
    encrypted.toString("base64"),
  ].join(":");
}

function decryptSecret(ciphertext: string): string {
  const [ivPart, tagPart, dataPart] = ciphertext.split(":");
  if (!ivPart || !tagPart || !dataPart) throw new Error("Malformed MFA secret");
  const decipher = createDecipheriv(ALGORITHM, secretKey(), Buffer.from(ivPart, "base64"));
  decipher.setAuthTag(Buffer.from(tagPart, "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(dataPart, "base64")),
    decipher.final(),
  ]).toString("utf8");
}

/** A recovery code, in the shape people can read off a screen and retype. */
function newRecoveryCode(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no I, O, 0, 1
  const block = (length: number) =>
    Array.from({ length }, () => alphabet[randomInt(alphabet.length)]).join("");
  return `${block(5)}-${block(5)}`;
}

/** Recovery codes are compared by hash, and bcrypt is what passwords use here. */
const hashRecoveryCode = (code: string) =>
  bcrypt.hash(code.trim().toUpperCase(), env.BCRYPT_ROUNDS);

interface ActorContext {
  requestId?: string;
  ipAddress?: string | null;
  userAgent?: string | null;
}

export interface MfaEnrolmentOffer {
  secret: string;
  uri: string;
  /** Already enrolled accounts must disable first; re-enrolling silently would strand the old device. */
  alreadyEnrolled: boolean;
}

export class MfaService {
  /** Whether this account has a confirmed second factor. */
  async isEnrolled(userId: string): Promise<boolean> {
    const user = await prisma.appUser.findUnique({
      where: { id: userId },
      select: { mfaEnrolledAt: true, mfaSecret: true },
    });
    return Boolean(user?.mfaEnrolledAt && user.mfaSecret);
  }

  /**
   * Begin enrolment: mint a secret and hand back the URI to scan.
   *
   * The secret is stored immediately but `mfaEnrolledAt` stays null until a
   * code proves the authenticator actually has it. Storing it only after
   * confirmation would mean holding it in the client or in a cache between
   * two requests, and both are worse places for it than the encrypted column.
   */
  async beginEnrolment(
    userId: string,
    accountEmail: string,
    context: ActorContext
  ): Promise<MfaEnrolmentOffer> {
    const user = await prisma.appUser.findUniqueOrThrow({
      where: { id: userId },
      select: { mfaEnrolledAt: true },
    });
    if (user.mfaEnrolledAt) {
      throw new AppError(
        "This account already has an authenticator. Remove it before enrolling another.",
        409,
        ErrorCodes.CONFLICT,
        { alreadyEnrolled: true }
      );
    }

    const secret = generateTotpSecret();
    await prisma.appUser.update({
      where: { id: userId },
      data: { mfaSecret: encryptSecret(secret), mfaLastUsedStep: null },
    });

    await this.audit(userId, "MFA_ENROLMENT_STARTED", context);

    return {
      secret,
      uri: totpUri({ secret, accountName: accountEmail, issuer: "Zoiko Mail" }),
      alreadyEnrolled: false,
    };
  }

  /**
   * Finish enrolment by proving the authenticator holds the secret.
   *
   * Returns the recovery codes, which are shown exactly once — only their
   * hashes are kept, so a second look is impossible by construction rather
   * than by policy.
   */
  async confirmEnrolment(
    userId: string,
    code: string,
    context: ActorContext
  ): Promise<{ recoveryCodes: string[] }> {
    const user = await prisma.appUser.findUniqueOrThrow({
      where: { id: userId },
      select: { mfaSecret: true, mfaEnrolledAt: true },
    });
    if (user.mfaEnrolledAt) {
      throw new AppError("MFA is already enabled for this account", 409, ErrorCodes.CONFLICT);
    }
    if (!user.mfaSecret) {
      throw new AppError(
        "Start enrolment before confirming it",
        409,
        ErrorCodes.CONFLICT,
        { reason: "NO_PENDING_ENROLMENT" }
      );
    }

    const match = verifyTotp(decryptSecret(user.mfaSecret), code);
    if (!match) {
      await this.audit(userId, "MFA_ENROLMENT_FAILED", context);
      throw new AppError("That code is not valid", 401, ErrorCodes.UNAUTHORIZED);
    }

    const codes = Array.from({ length: RECOVERY_CODE_COUNT }, newRecoveryCode);
    const hashes = await Promise.all(codes.map(hashRecoveryCode));

    await prisma.$transaction(async (tx) => {
      await tx.appUser.update({
        where: { id: userId },
        data: { mfaEnrolledAt: new Date(), mfaLastUsedStep: match.step },
      });
      // Any codes from an earlier enrolment are void; leaving them alive would
      // let a previous device holder back in.
      await tx.mfaRecoveryCode.deleteMany({ where: { userId } });
      await tx.mfaRecoveryCode.createMany({
        data: hashes.map((codeHash) => ({ userId, codeHash })),
      });
    });

    await this.audit(userId, "MFA_ENROLLED", context, { recoveryCodeCount: codes.length });
    return { recoveryCodes: codes };
  }

  /**
   * Answer a challenge with a TOTP code or a recovery code.
   *
   * Both are accepted here rather than at separate endpoints: the client
   * cannot tell them apart usefully, and a single field means a locked-out
   * user does not have to find the right screen to get back in.
   */
  async verifyChallenge(
    userId: string,
    code: string,
    context: ActorContext
  ): Promise<{ usedRecoveryCode: boolean; remainingRecoveryCodes: number }> {
    await this.assertNotLockedOut(userId, context);

    const user = await prisma.appUser.findUniqueOrThrow({
      where: { id: userId },
      select: { mfaSecret: true, mfaEnrolledAt: true, mfaLastUsedStep: true },
    });
    if (!user.mfaEnrolledAt || !user.mfaSecret) {
      throw new AppError("This account has no authenticator enrolled", 409, ErrorCodes.CONFLICT, {
        reason: "MFA_NOT_ENROLLED",
      });
    }

    const match = verifyTotp(decryptSecret(user.mfaSecret), code);
    if (match) {
      // RFC 6238 §5.2: a code is accepted once. Without this, a code observed
      // in transit stays usable for the rest of its window.
      if (user.mfaLastUsedStep !== null && match.step <= user.mfaLastUsedStep) {
        await this.audit(userId, "MFA_CHALLENGE_FAILED", context, { reason: "CODE_ALREADY_USED" });
        throw new AppError("That code has already been used", 401, ErrorCodes.UNAUTHORIZED, {
          reason: "CODE_ALREADY_USED",
        });
      }
      await prisma.appUser.update({
        where: { id: userId },
        data: { mfaLastUsedStep: match.step },
      });
      await this.audit(userId, "MFA_CHALLENGE_SUCCEEDED", context, { method: "TOTP" });
      return {
        usedRecoveryCode: false,
        remainingRecoveryCodes: await prisma.mfaRecoveryCode.count({
          where: { userId, usedAt: null },
        }),
      };
    }

    const recovery = await this.spendRecoveryCode(userId, code);
    if (recovery.spent) {
      await this.audit(userId, "MFA_RECOVERY_CODE_USED", context, {
        remaining: recovery.remaining,
      });
      return { usedRecoveryCode: true, remainingRecoveryCodes: recovery.remaining };
    }

    await this.audit(userId, "MFA_CHALLENGE_FAILED", context, { reason: "INVALID_CODE" });
    throw new AppError("That code is not valid", 401, ErrorCodes.UNAUTHORIZED);
  }

  /**
   * Remove the second factor.
   *
   * Refused while the account holds a role AC-002 requires MFA for, which is
   * what makes the requirement an enforcement rather than a default. Somebody
   * who has lost their device uses a recovery code; somebody who has lost
   * both needs an Owner to change their role or an operator to intervene, and
   * that is the intended shape — the specification forbids support staff
   * quietly bypassing MFA.
   */
  async disable(userId: string, code: string, context: ActorContext) {
    const privileged = await prisma.tenantMembership.findFirst({
      where: { userId, status: "ACTIVE", role: { in: MFA_REQUIRED_ROLES } },
      select: { role: true, tenantId: true },
    });
    const staff = await prisma.appUser.findUniqueOrThrow({
      where: { id: userId },
      select: { platformRole: true },
    });
    if (privileged || staff.platformRole !== "NONE") {
      throw new AppError(
        "MFA is required for this account and cannot be removed",
        403,
        ErrorCodes.FORBIDDEN,
        {
          reason: "MFA_REQUIRED_FOR_ROLE",
          role: privileged?.role ?? staff.platformRole,
        }
      );
    }

    // Still requires a valid code: without it, a stolen session could quietly
    // strip the factor and keep working.
    await this.verifyChallenge(userId, code, context);

    await prisma.$transaction(async (tx) => {
      await tx.appUser.update({
        where: { id: userId },
        data: { mfaSecret: null, mfaEnrolledAt: null, mfaLastUsedStep: null },
      });
      await tx.mfaRecoveryCode.deleteMany({ where: { userId } });
    });

    await this.audit(userId, "MFA_DISABLED", context);
    return { enrolled: false };
  }

  /** Replace the recovery codes, voiding the old set. */
  async regenerateRecoveryCodes(
    userId: string,
    code: string,
    context: ActorContext
  ): Promise<{ recoveryCodes: string[] }> {
    await this.verifyChallenge(userId, code, context);

    const codes = Array.from({ length: RECOVERY_CODE_COUNT }, newRecoveryCode);
    const hashes = await Promise.all(codes.map(hashRecoveryCode));
    await prisma.$transaction(async (tx) => {
      await tx.mfaRecoveryCode.deleteMany({ where: { userId } });
      await tx.mfaRecoveryCode.createMany({
        data: hashes.map((codeHash) => ({ userId, codeHash })),
      });
    });

    await this.audit(userId, "MFA_RECOVERY_CODES_REGENERATED", context, {
      recoveryCodeCount: codes.length,
    });
    return { recoveryCodes: codes };
  }

  /** How the account stands, for a settings screen. */
  async status(userId: string) {
    const [user, remaining, privileged] = await Promise.all([
      prisma.appUser.findUniqueOrThrow({
        where: { id: userId },
        select: { mfaEnrolledAt: true, mfaSecret: true, platformRole: true },
      }),
      prisma.mfaRecoveryCode.count({ where: { userId, usedAt: null } }),
      prisma.tenantMembership.findFirst({
        where: { userId, status: "ACTIVE", role: { in: MFA_REQUIRED_ROLES } },
        select: { role: true },
      }),
    ]);

    return {
      enrolled: Boolean(user.mfaEnrolledAt),
      enrolledAt: user.mfaEnrolledAt,
      // A secret with no enrolment date is an enrolment someone started and
      // never confirmed; the settings screen offers to resume rather than
      // pretending nothing happened.
      enrolmentPending: Boolean(user.mfaSecret && !user.mfaEnrolledAt),
      required: Boolean(privileged) || user.platformRole !== "NONE",
      requiredBecause: privileged?.role ?? (user.platformRole !== "NONE" ? user.platformRole : null),
      remainingRecoveryCodes: remaining,
    };
  }

  private async spendRecoveryCode(userId: string, code: string) {
    const candidates = await prisma.mfaRecoveryCode.findMany({
      where: { userId, usedAt: null },
      select: { id: true, codeHash: true },
    });
    const normalized = code.trim().toUpperCase();
    for (const candidate of candidates) {
      if (await bcrypt.compare(normalized, candidate.codeHash)) {
        // updateMany with the null guard, so two requests racing the same code
        // cannot both spend it.
        const spent = await prisma.mfaRecoveryCode.updateMany({
          where: { id: candidate.id, usedAt: null },
          data: { usedAt: new Date() },
        });
        if (spent.count !== 1) break;
        return {
          spent: true,
          remaining: await prisma.mfaRecoveryCode.count({ where: { userId, usedAt: null } }),
        };
      }
    }
    return { spent: false, remaining: candidates.length };
  }

  /**
   * Refuse a challenge from an account that has just failed several.
   *
   * Six digits is a small space, and the challenge is reachable with only a
   * password. Counted from the audit trail rather than a new column: the
   * failures are already recorded there, and a second store would be a second
   * thing to keep consistent.
   */
  private async assertNotLockedOut(userId: string, context: ActorContext) {
    const since = new Date(Date.now() - LOCKOUT_WINDOW_MS);
    const failures = await prisma.auditEvent.count({
      where: {
        actorUserId: userId,
        eventType: "MFA_CHALLENGE_FAILED",
        createdAt: { gte: since },
      },
    });
    if (failures >= MAX_FAILED_ATTEMPTS) {
      await this.audit(userId, "MFA_CHALLENGE_LOCKED_OUT", context, { failures });
      throw new AppError(
        "Too many incorrect codes. Try again in a few minutes.",
        429,
        ErrorCodes.RATE_LIMIT_EXCEEDED,
        { retryAfterMinutes: Math.ceil(LOCKOUT_WINDOW_MS / 60000) }
      );
    }
  }

  /**
   * MFA events belong to the account, not to a workspace.
   *
   * They are recorded against the system tenant because a challenge happens
   * before any workspace is resolved — §18 lists "MFA challenge" in the
   * identity category, which is platform-level by nature.
   */
  private async audit(
    userId: string,
    eventType: string,
    context: ActorContext,
    metadata?: Prisma.InputJsonValue
  ) {
    // Written outside the request's own tenant scope, because these rows
    // belong to the system tenant and a request bound to a workspace cannot
    // write them under the row-level policies (AC-004). That is the policy
    // working: an MFA challenge is a platform-level identity event, so it
    // says so rather than being filed under whichever workspace the account
    // happened to be signing into.
    return withCrossTenant(async () => {
      // The same sentinel-tenant upsert the auth service does before
      // recording a pre-membership event. Repeated here rather than imported:
      // auth.service imports this module for the enforcement gate, and
      // reaching back into it would close a cycle. Only the constant is
      // shared, from a types module.
      await prisma.tenant.upsert({
        where: { id: SYSTEM_TENANT_ID },
        update: {},
        create: { id: SYSTEM_TENANT_ID, name: "System", status: "ACTIVE", planCode: "system" },
      });
      await auditService.record({
        tenantId: SYSTEM_TENANT_ID,
        actorUserId: userId,
        eventType,
        targetType: "AppUser",
        targetId: userId,
        requestId: context.requestId,
        ipAddress: context.ipAddress,
        userAgent: context.userAgent,
        metadata,
      });
    });
  }
}

export const mfaService = new MfaService();

/** Exported for the enrolment tests, which need to read a stored secret. */
export const __mfaInternals = { encryptSecret, decryptSecret };
