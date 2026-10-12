import { randomBytes } from "node:crypto";
import { Prisma, type MembershipRole } from "@prisma/client";
import { prisma } from "../../config/prisma.js";
import { withCrossTenant } from "../../config/tenantScope.js";
import { env } from "../../config/env.js";
import { logger } from "../../config/logger.js";
import { AppError } from "../../common/errors/AppError.js";
import { ErrorCodes } from "../../common/errors/errorCodes.js";
import { setSecret } from "../../common/secrets/secrets.js";
import { systemMailer } from "../../common/mailer/system-mailer.js";
import { auditService } from "../audit/audit.service.js";
import { billingService } from "../billing/billing.service.js";
import { membershipService } from "../membership/membership.service.js";
import { stalwartClient } from "../stalwart/stalwart.client.js";
import { StalwartError, type HostedAccount, type MailHostingProvider } from "../stalwart/stalwart.types.js";
import type { ProvisionMailboxInput } from "./mail.schema.js";

interface ProvisioningContext {
  tenantId: string;
  userId: string;
  role: MembershipRole;
  requestId?: string;
  ipAddress?: string | null;
  userAgent?: string | null;
}

const GIB = 1024 ** 3;

/** The quota choices offered, in GiB. The plan's storage ceiling trims the top. */
export const QUOTA_OPTIONS_GIB = [1, 5, 10, 25, 50, 100] as const;
const DEFAULT_QUOTA_GIB = 10;

/**
 * Addresses the mail system itself needs (RFC 2142 and the usual daemon
 * names). Handing one to a person would route bounce and abuse reports to
 * them, or collide with the server's own use.
 */
const RESERVED_LOCAL_PARTS = new Set([
  "postmaster", "abuse", "hostmaster", "mailer-daemon", "root", "nobody", "noreply", "no-reply",
]);

/**
 * Letters, digits, dot, hyphen, underscore; starting and ending with a letter
 * or digit, no consecutive dots. Narrower than RFC 5322 on purpose: `+` is
 * sub-addressing on the server, and quoted local parts are not worth the
 * interoperability trouble for an address a person will type every day.
 */
const LOCAL_PART = /^[a-z0-9](?:[a-z0-9._-]{0,62}[a-z0-9])?$/;

/** How long a PROVISIONING row may sit before it is treated as interrupted. */
const STALE_PROVISIONING_MS = 2 * 60 * 1000;
/** Minimum gap between two invitation emails for the same mailbox. */
const INVITATION_RESEND_COOLDOWN_MS = 60 * 1000;

const mailboxInclude = {
  domain: { select: { id: true, domainName: true } },
  membership: {
    select: {
      id: true,
      status: true,
      user: { select: { id: true, email: true, displayName: true } },
    },
  },
} satisfies Prisma.MailboxInclude;

type MailboxRow = Prisma.MailboxGetPayload<{ include: typeof mailboxInclude }>;

/** The marker that ties a host account to the Zoiko mailbox that created it. */
function ownershipMarker(mailboxId: string): string {
  return `zoiko:mailbox:${mailboxId}`;
}

function credentialRef(mailboxId: string): string {
  return `mailbox-credential-${mailboxId}`;
}

/**
 * The status a person reads, derived from the facts rather than stored
 * beside them, so it cannot disagree with them.
 */
export function mailboxDisplayStatus(row: {
  provisioningStatus: string | null;
  sendSuspendedAt: Date | null;
  membership: { status: string } | null;
}): "PROVISIONING" | "FAILED" | "SUSPENDED" | "INVITATION_PENDING" | "ACTIVE" {
  if (row.provisioningStatus === "FAILED") return "FAILED";
  if (row.provisioningStatus === "PENDING" || row.provisioningStatus === "PROVISIONING") return "PROVISIONING";
  if (row.sendSuspendedAt) return "SUSPENDED";
  if (row.membership?.status === "INVITED") return "INVITATION_PENDING";
  return "ACTIVE";
}

function toView(row: MailboxRow) {
  return {
    id: row.id,
    address: row.address,
    displayName: row.displayName,
    domainId: row.domainId,
    domainName: row.domain?.domainName ?? null,
    quotaBytes: Number(row.storageLimit),
    appliedQuotaBytes: row.providerQuotaBytes === null ? null : Number(row.providerQuotaBytes),
    provider: row.provider,
    provisioningStatus: row.provisioningStatus,
    provisioningError: row.provisioningError,
    provisioningAttempts: row.provisioningAttempts,
    provisionedAt: row.provisionedAt,
    invitationStatus: row.invitationStatus,
    invitationSentAt: row.invitationSentAt,
    invitationError: row.invitationError,
    invitationRecipient: row.membership?.user.email ?? null,
    membershipStatus: row.membership?.status ?? null,
    status: mailboxDisplayStatus(row),
    createdAt: row.createdAt,
  };
}

export type ProvisionedMailboxView = ReturnType<typeof toView>;

/**
 * Hosted mailbox creation: the Zoiko record and the real account on the mail
 * host, kept in step.
 *
 * There is no transaction spanning PostgreSQL and Stalwart, so the flow is
 * built to be re-run rather than to be atomic:
 *
 *   1. The mailbox row is written first, as PENDING, with the invitation in
 *      the same transaction. The (tenant, address) unique index is what
 *      stops two concurrent requests for one address.
 *   2. The host is asked. Before creating anything it looks for an account
 *      with that address, and adopts it only if it carries this mailbox's
 *      ownership marker — so a retry after a timeout, or after the database
 *      write that followed a successful create failed, finds the account it
 *      made instead of making a second one. An account without the marker
 *      belongs to someone else and is never adopted.
 *   3. Only once the host confirms the account is the invitation sent, and
 *      its delivery is recorded separately. Resending it never touches the
 *      host.
 */
export class MailboxProvisioningService {
  constructor(private provider: MailHostingProvider = stalwartClient) {}

  /** Test seam. */
  setProvider(provider: MailHostingProvider): void {
    this.provider = provider;
  }

  private async load(tenantId: string, mailboxId: string): Promise<MailboxRow> {
    const row = await prisma.mailbox.findFirst({
      where: { id: mailboxId, tenantId },
      include: mailboxInclude,
    });
    // Scoped to the tenant, so another workspace's mailbox reads as absent.
    if (!row) throw new AppError("Mailbox not found", 404, ErrorCodes.NOT_FOUND);
    return row;
  }

  private async audit(
    context: ProvisioningContext,
    eventType: string,
    mailboxId: string,
    metadata: Prisma.InputJsonValue,
    tx: Prisma.TransactionClient = prisma
  ) {
    await auditService.record(
      {
        tenantId: context.tenantId,
        actorUserId: context.userId,
        actorType: "ADMIN",
        eventType,
        targetType: "Mailbox",
        targetId: mailboxId,
        requestId: context.requestId,
        ipAddress: context.ipAddress,
        userAgent: context.userAgent,
        metadata,
      },
      tx
    );
  }

  private async quotaCeilingBytes(tenantId: string): Promise<number | null> {
    const plan = await billingService.getEffectivePlan(tenantId);
    return plan?.storageLimitGb ? plan.storageLimitGb * GIB : null;
  }

  // ─── What the form may offer ──────────────────────────────────────────────

  /**
   * Everything the Create Email form needs, from the server's point of view:
   * which domains this workspace may use and how ready each one is, which
   * quotas the plan allows, and whether the mail host is configured at all.
   */
  async options(tenantId: string) {
    const [domains, ceiling, plan, mailboxCount] = await Promise.all([
      prisma.mailDomain.findMany({
        where: { tenantId },
        select: {
          id: true, domainName: true, verificationStatus: true, status: true,
          mxStatus: true, spfStatus: true, dkimStatus: true, dmarcStatus: true,
          sendingEnabled: true, receivingEnabled: true,
        },
        orderBy: { domainName: "asc" },
      }),
      this.quotaCeilingBytes(tenantId),
      billingService.getEffectivePlan(tenantId),
      prisma.mailbox.count({ where: { tenantId } }),
    ]);

    const optionsBytes = QUOTA_OPTIONS_GIB.map((gib) => gib * GIB).filter((bytes) => ceiling === null || bytes <= ceiling);
    const defaultBytes = optionsBytes.includes(DEFAULT_QUOTA_GIB * GIB)
      ? DEFAULT_QUOTA_GIB * GIB
      : optionsBytes[optionsBytes.length - 1] ?? null;

    return {
      providerConfigured: this.provider.isConfigured(),
      provider: this.provider.name,
      domains: domains.map((domain) => ({
        ...domain,
        usable: domain.verificationStatus === "VERIFIED",
        readiness: {
          ownershipVerified: domain.verificationStatus === "VERIFIED",
          // Records checked by the DNS verifier. These say the DNS points at
          // the platform; they do not prove the mail server accepts the mail.
          inboundRouting: domain.receivingEnabled && domain.mxStatus === "VALID",
          outboundConfigured:
            domain.sendingEnabled && domain.spfStatus === "VALID" && domain.dkimStatus === "VALID",
          dmarcPublished: domain.dmarcStatus === "VALID",
        },
      })),
      quota: { optionsBytes, defaultBytes, maxBytes: ceiling },
      mailboxes: { used: mailboxCount, limit: plan?.mailboxLimit ?? null },
      invitationDelivery: env.SYSTEM_MAIL_ENABLED ? "EMAIL" : "DISABLED",
    };
  }

  // ─── Create ───────────────────────────────────────────────────────────────

  async create(input: ProvisionMailboxInput, context: ProvisioningContext) {
    if (!this.provider.isConfigured()) {
      throw new AppError(
        "Mailbox hosting is not configured on this deployment",
        503,
        ErrorCodes.MAIL_HOSTING_NOT_CONFIGURED
      );
    }

    const localPart = input.localPart.trim().toLowerCase();
    if (!LOCAL_PART.test(localPart) || localPart.includes("..")) {
      throw new AppError(
        "Use letters, numbers, dots, hyphens or underscores, starting and ending with a letter or number",
        422,
        ErrorCodes.VALIDATION_ERROR,
        { parameter: "localPart" }
      );
    }
    if (RESERVED_LOCAL_PARTS.has(localPart)) {
      throw new AppError(`${localPart}@ is reserved for the mail system`, 422, ErrorCodes.VALIDATION_ERROR, {
        parameter: "localPart",
        reason: "RESERVED",
      });
    }

    const domain = await prisma.mailDomain.findFirst({
      where: { id: input.domainId, tenantId: context.tenantId },
      select: { id: true, domainName: true, verificationStatus: true },
    });
    if (!domain) throw new AppError("Domain not found", 404, ErrorCodes.NOT_FOUND);
    if (domain.verificationStatus !== "VERIFIED") {
      throw new AppError(
        `${domain.domainName} is not verified yet. Finish its DNS checks before creating mailboxes on it.`,
        409,
        ErrorCodes.CONFLICT,
        { reason: "DOMAIN_NOT_VERIFIED", domainName: domain.domainName }
      );
    }
    const address = `${localPart}@${domain.domainName.toLowerCase()}`;

    const ceiling = await this.quotaCeilingBytes(context.tenantId);
    const allowed = QUOTA_OPTIONS_GIB.map((gib) => gib * GIB);
    if (!allowed.includes(input.quotaBytes) || (ceiling !== null && input.quotaBytes > ceiling)) {
      throw new AppError("That mailbox quota is not available on this plan", 422, ErrorCodes.VALIDATION_ERROR, {
        parameter: "quotaBytes",
      });
    }

    await billingService.assertMailboxWithinLimit(context.tenantId);

    // An address is global on the mail host, so it is checked across every
    // workspace — and against aliases, which route the same way. Explicitly
    // cross-tenant: only existence is read, and nothing about the other
    // workspace reaches the caller beyond "in use".
    const [mailboxClash, aliasClash] = await withCrossTenant(() =>
      Promise.all([
        prisma.mailbox.findFirst({ where: { address }, select: { id: true } }),
        prisma.alias.findFirst({ where: { address }, select: { id: true } }),
      ])
    );
    if (mailboxClash || aliasClash) {
      throw new AppError(`${address} is already in use`, 409, ErrorCodes.CONFLICT, { reason: "ADDRESS_TAKEN" });
    }

    const recoveryEmail = input.recoveryEmail.trim().toLowerCase();
    if (recoveryEmail === address) {
      throw new AppError(
        "The invitation has to go to an address the person can already read, not the new mailbox",
        422,
        ErrorCodes.VALIDATION_ERROR,
        { parameter: "recoveryEmail" }
      );
    }

    let invitationToken: string | null = null;
    let mailboxId: string;
    try {
      mailboxId = await prisma.$transaction(async (tx) => {
        const user = await tx.appUser.findUnique({ where: { email: recoveryEmail }, select: { id: true } });
        const existing = user
          ? await tx.tenantMembership.findFirst({
            where: { tenantId: context.tenantId, userId: user.id },
            select: { id: true, status: true, mailbox: { select: { id: true } } },
          })
          : null;

        let membershipId: string;
        let invitationStatus: "NOT_REQUIRED" | "PENDING";
        if (existing && (existing.status === "ACTIVE" || existing.status === "INVITED")) {
          if (existing.mailbox) {
            throw new AppError(
              `${recoveryEmail} already has a mailbox in this workspace`,
              409,
              ErrorCodes.CONFLICT,
              { reason: "MEMBER_HAS_MAILBOX" }
            );
          }
          membershipId = existing.id;
          if (existing.status === "ACTIVE") {
            // Already signs in here: the mailbox simply appears for them.
            invitationStatus = "NOT_REQUIRED";
          } else {
            invitationToken = (await membershipService.rotateInvitationToken(tx, existing.id, context)).invitationToken;
            invitationStatus = "PENDING";
          }
        } else if (existing?.status === "SUSPENDED") {
          throw new AppError(`${recoveryEmail} is suspended in this workspace`, 409, ErrorCodes.CONFLICT, {
            reason: "MEMBER_SUSPENDED",
          });
        } else {
          const issued = await membershipService.issueInvitation(
            tx,
            { email: recoveryEmail, role: "MEMBER", firstName: input.firstName, lastName: input.lastName },
            context
          );
          membershipId = issued.membership.id;
          invitationToken = issued.invitationToken;
          invitationStatus = "PENDING";
        }

        const mailbox = await tx.mailbox.create({
          data: {
            tenantId: context.tenantId,
            membershipId,
            domainId: domain.id,
            address,
            displayName: input.displayName.trim(),
            storageLimit: BigInt(input.quotaBytes),
            provider: this.provider.name,
            provisioningStatus: "PENDING",
            invitationStatus,
          },
          select: { id: true },
        });

        await this.audit(context, "MAILBOX_PROVISIONING_REQUESTED", mailbox.id, {
          address,
          domainId: domain.id,
          quotaBytes: input.quotaBytes,
          provider: this.provider.name,
          invitation: invitationStatus === "PENDING" ? "REQUIRED" : "NOT_REQUIRED",
        }, tx);
        return mailbox.id;
      });
    } catch (error) {
      // Two requests for one address in the same instant: the index decides.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        throw new AppError(`${address} is already in use`, 409, ErrorCodes.CONFLICT, { reason: "ADDRESS_TAKEN" });
      }
      throw error;
    }

    await this.provisionOnHost(mailboxId, context);
    const row = await this.load(context.tenantId, mailboxId);
    if (row.provisioningStatus === "PROVISIONED" && row.invitationStatus === "PENDING" && invitationToken) {
      await this.deliverInvitation(row, invitationToken, context);
    }
    return toView(await this.load(context.tenantId, mailboxId));
  }

  // ─── The host half ────────────────────────────────────────────────────────

  /**
   * Ask the host for the account, reconciling first.
   *
   * Never throws for a provider failure: the outcome is written to the row,
   * which is what the caller reports. Throws only when the row cannot be
   * claimed because another attempt is already running.
   */
  private async provisionOnHost(mailboxId: string, context: ProvisioningContext): Promise<void> {
    const staleBefore = new Date(Date.now() - STALE_PROVISIONING_MS);
    const claimed = await prisma.mailbox.updateMany({
      where: {
        id: mailboxId,
        tenantId: context.tenantId,
        OR: [
          { provisioningStatus: { in: ["PENDING", "FAILED"] } },
          { provisioningStatus: "PROVISIONING", provisioningStartedAt: { lt: staleBefore } },
        ],
      },
      data: {
        provisioningStatus: "PROVISIONING",
        provisioningStartedAt: new Date(),
        provisioningAttempts: { increment: 1 },
        provisioningError: null,
      },
    });
    if (claimed.count === 0) {
      throw new AppError(
        "This mailbox is already being provisioned. Check back in a moment.",
        409,
        ErrorCodes.PROVISIONING_IN_PROGRESS
      );
    }

    const row = await this.load(context.tenantId, mailboxId);
    const [localPart, domainName] = row.address.split("@") as [string, string];
    const marker = ownershipMarker(row.id);

    try {
      let hostDomain = await this.provider.findDomain(domainName);
      if (!hostDomain) {
        if (!env.STALWART_AUTO_CREATE_DOMAINS) {
          throw new StalwartError("The domain is not registered on the mail server", "DOMAIN_MISSING", false);
        }
        try {
          hostDomain = await this.provider.createDomain(domainName);
        } catch (error) {
          // Created by a concurrent request a moment ago: use that one.
          if (!(error instanceof StalwartError && error.code === "ALREADY_EXISTS")) throw error;
          hostDomain = await this.provider.findDomain(domainName);
          if (!hostDomain) throw error;
        }
      }

      let account: HostedAccount | null = await this.provider.findAccount(localPart, hostDomain.id);
      if (account && !account.description?.includes(marker)) {
        // Exists on the host but was not made for this mailbox. Adopting it
        // would hand someone else's mail to this workspace.
        throw new StalwartError("The address already exists on the mail server", "ALREADY_EXISTS", false);
      }

      if (!account) {
        // The initial credential is stored before the account exists, so a
        // crash between the two can never leave an account whose password
        // nobody holds. It is never returned, logged or emailed; the person
        // gets access through the invitation, not through this secret.
        const secret = randomBytes(32).toString("base64url");
        await setSecret(credentialRef(row.id), secret, {
          purpose: "Hosted mailbox initial credential",
          tenantId: context.tenantId,
          requestId: context.requestId,
        });
        try {
          account = await this.provider.createAccount({
            name: localPart,
            domainId: hostDomain.id,
            secret,
            diskQuotaBytes: Number(row.storageLimit),
            description: `${row.displayName ?? row.address} [${marker}]`,
          });
        } catch (error) {
          if (!(error instanceof StalwartError && error.code === "ALREADY_EXISTS")) throw error;
          // Lost a race with our own earlier attempt: reconcile once more.
          account = await this.provider.findAccount(localPart, hostDomain.id);
          if (!account?.description?.includes(marker)) throw error;
        }
      }

      if (account.name.toLowerCase() !== localPart || account.domainId !== hostDomain.id) {
        throw new StalwartError("The mail server returned a different account than requested", "UNEXPECTED_RESPONSE", false);
      }

      await prisma.mailbox.update({
        where: { id: row.id },
        data: {
          provisioningStatus: "PROVISIONED",
          providerAccountId: account.id,
          provisionedAt: new Date(),
          provisioningError: null,
          providerQuotaBytes: account.diskQuotaBytes === null ? null : BigInt(account.diskQuotaBytes),
        },
      });
      await this.audit(context, "MAILBOX_PROVISIONED", row.id, {
        address: row.address,
        provider: this.provider.name,
        attempt: row.provisioningAttempts,
        quotaApplied: account.diskQuotaBytes,
      });
    } catch (error) {
      const code = error instanceof StalwartError ? `STALWART_${error.code}` : "INTERNAL_ERROR";
      const retryable = error instanceof StalwartError ? error.retryable : true;
      if (!(error instanceof StalwartError)) {
        logger.error({ err: error, mailboxId: row.id }, "Mailbox provisioning failed unexpectedly");
      } else {
        logger.warn({ mailboxId: row.id, code, retryable }, "Mailbox provisioning failed");
      }
      await prisma.mailbox.update({
        where: { id: row.id },
        data: { provisioningStatus: "FAILED", provisioningError: code },
      });
      await this.audit(context, "MAILBOX_PROVISIONING_FAILED", row.id, {
        address: row.address,
        provider: this.provider.name,
        attempt: row.provisioningAttempts,
        code,
        retryable,
      });
    }
  }

  // ─── Invitation ───────────────────────────────────────────────────────────

  /**
   * Send the access invitation and record what happened.
   *
   * Goes to the person's existing address, never the new mailbox, which they
   * cannot read yet. With system mail turned off nothing is sent — and the
   * mailer is not called either, because its log-only mode would print the
   * accept link, and the link is a credential.
   */
  private async deliverInvitation(row: MailboxRow, invitationToken: string, context: ProvisioningContext) {
    const recipient = row.membership?.user.email;
    if (!recipient) return;

    if (!env.SYSTEM_MAIL_ENABLED) {
      await prisma.mailbox.update({
        where: { id: row.id },
        data: { invitationStatus: "PENDING", invitationError: "SYSTEM_MAIL_DISABLED" },
      });
      await this.audit(context, "MAILBOX_INVITATION_NOT_SENT", row.id, { recipient, reason: "SYSTEM_MAIL_DISABLED" });
      return;
    }

    try {
      const letter = await membershipService.invitationLetter({ email: recipient, role: "MEMBER" }, context);
      letter.paragraphs = [
        ...letter.paragraphs,
        `Your new email address is ${row.address}. Once you accept, you can read and send mail from it in Zoiko Mail.`,
      ];
      await systemMailer.sendInvitationEmail(recipient, letter, membershipService.acceptUrl(invitationToken));
      await prisma.mailbox.update({
        where: { id: row.id },
        data: { invitationStatus: "SENT", invitationSentAt: new Date(), invitationError: null },
      });
      await this.audit(context, "MAILBOX_INVITATION_SENT", row.id, { recipient });
    } catch (error) {
      logger.warn({ err: error, mailboxId: row.id }, "Mailbox invitation delivery failed");
      await prisma.mailbox.update({
        where: { id: row.id },
        data: { invitationStatus: "FAILED", invitationError: "DELIVERY_FAILED" },
      });
      await this.audit(context, "MAILBOX_INVITATION_FAILED", row.id, { recipient, code: "DELIVERY_FAILED" });
    }
  }

  /** New token, new email. Never touches the mail host. */
  private async reissueAndDeliver(row: MailboxRow, context: ProvisioningContext) {
    if (!row.membership || row.membership.status !== "INVITED") {
      throw new AppError("This invitation has already been accepted", 409, ErrorCodes.CONFLICT, {
        reason: "INVITATION_NOT_PENDING",
      });
    }
    const membershipId = row.membership.id;
    const { invitationToken } = await prisma.$transaction((tx) =>
      membershipService.rotateInvitationToken(tx, membershipId, context)
    );
    await this.deliverInvitation(row, invitationToken, context);
  }

  // ─── Retry and resend ─────────────────────────────────────────────────────

  /**
   * Finish whatever did not finish: the host half if it failed or was
   * interrupted, then the invitation if it is still owed.
   */
  async retry(mailboxId: string, context: ProvisioningContext) {
    const row = await this.load(context.tenantId, mailboxId);
    if (!row.provider) {
      throw new AppError("This mailbox is not managed by a mail host", 409, ErrorCodes.CONFLICT, {
        reason: "NOT_HOSTED",
      });
    }
    if (!this.provider.isConfigured()) {
      throw new AppError("Mailbox hosting is not configured on this deployment", 503, ErrorCodes.MAIL_HOSTING_NOT_CONFIGURED);
    }

    if (row.provisioningStatus !== "PROVISIONED") {
      await this.audit(context, "MAILBOX_PROVISIONING_RETRIED", row.id, {
        address: row.address,
        previousStatus: row.provisioningStatus,
        previousError: row.provisioningError,
      });
      await this.provisionOnHost(row.id, context);
    }

    const after = await this.load(context.tenantId, mailboxId);
    if (
      after.provisioningStatus === "PROVISIONED" &&
      (after.invitationStatus === "PENDING" || after.invitationStatus === "FAILED") &&
      after.membership?.status === "INVITED"
    ) {
      await this.reissueAndDeliver(after, context);
    }
    return toView(await this.load(context.tenantId, mailboxId));
  }

  async resendInvitation(mailboxId: string, context: ProvisioningContext) {
    const row = await this.load(context.tenantId, mailboxId);
    if (row.provisioningStatus !== "PROVISIONED") {
      throw new AppError(
        "The mailbox has to exist on the mail server before an invitation is sent",
        409,
        ErrorCodes.CONFLICT,
        { reason: "NOT_PROVISIONED" }
      );
    }
    if (row.invitationSentAt && Date.now() - row.invitationSentAt.getTime() < INVITATION_RESEND_COOLDOWN_MS) {
      throw new AppError("An invitation was sent a moment ago. Wait a minute before sending another.", 429, ErrorCodes.RATE_LIMIT_EXCEEDED);
    }
    await this.audit(context, "MAILBOX_INVITATION_RESEND_REQUESTED", row.id, { recipient: row.membership?.user.email ?? null });
    await this.reissueAndDeliver(row, context);
    return toView(await this.load(context.tenantId, mailboxId));
  }

  async get(mailboxId: string, tenantId: string) {
    return toView(await this.load(tenantId, mailboxId));
  }
}

export const mailboxProvisioningService = new MailboxProvisioningService();
