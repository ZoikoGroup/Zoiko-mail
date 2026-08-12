import { randomInt } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { prisma } from "../../config/prisma.js";
import { env } from "../../config/env.js";
import { logger } from "../../config/logger.js";
import { AppError } from "../../common/errors/AppError.js";
import { ErrorCodes } from "../../common/errors/errorCodes.js";
import { hashPassword, verifyPassword } from "../../common/utils/password.js";
import { systemMailer } from "../../common/mailer/system-mailer.js";

const PURPOSE = "EMAIL_VERIFICATION" as const;
const RESET_PURPOSE = "PASSWORD_RESET" as const;

function generateCode(length: number): string {
  return String(randomInt(0, 10 ** length)).padStart(length, "0");
}

export class OtpService {
  /**
   * Generate, persist, and return a fresh code; invalidates prior unconsumed
   * codes. Persistence only — email delivery happens AFTER the issuing
   * transaction commits via sendOtpEmail(), never inside the transaction.
   */
  async issue(userId: string, tx: Prisma.TransactionClient = prisma): Promise<{ code: string }> {
    await tx.emailOtp.updateMany({
      where: { userId, purpose: PURPOSE, consumedAt: null },
      data: { consumedAt: new Date() },
    });

    const code = generateCode(env.OTP_CODE_LENGTH);
    const codeHash = await hashPassword(code);
    const expiresAt = new Date(Date.now() + env.OTP_TTL_MS);

    await tx.emailOtp.create({ data: { userId, purpose: PURPOSE, codeHash, expiresAt } });

    return { code };
  }

  /**
   * Best-effort delivery of an issued code. Fire-and-forget so a slow or
   * unreachable SMTP server can never block the auth response.
   */
  async sendOtpEmail(email: string, code: string): Promise<void> {
    void systemMailer
      .sendOtpEmail(email, code, Math.round(env.OTP_TTL_MS / 60_000))
      .catch((err) => {
        logger.error({ err, email }, "failed to send OTP email");
      });
  }

  /** Verify a code; on success consume it and promote a PENDING_VERIFICATION user to ACTIVE. */
  async verify(userId: string, code: string): Promise<void> {
    const otp = await prisma.emailOtp.findFirst({
      where: { userId, purpose: PURPOSE, consumedAt: null },
      orderBy: { createdAt: "desc" },
    });

    if (!otp) throw new AppError("Invalid or expired code", 400, ErrorCodes.OTP_INVALID);
    if (otp.expiresAt.getTime() < Date.now()) {
      throw new AppError("Verification code has expired", 400, ErrorCodes.OTP_EXPIRED);
    }
    if (otp.attempts >= env.OTP_MAX_ATTEMPTS) {
      await prisma.emailOtp.update({ where: { id: otp.id }, data: { consumedAt: new Date() } });
      throw new AppError("Too many incorrect attempts; request a new code", 429, ErrorCodes.OTP_MAX_ATTEMPTS);
    }

    const matches = await verifyPassword(code, otp.codeHash);
    if (!matches) {
      await prisma.emailOtp.update({ where: { id: otp.id }, data: { attempts: { increment: 1 } } });
      throw new AppError("Invalid or expired code", 400, ErrorCodes.OTP_INVALID);
    }

    const user = await prisma.appUser.findUniqueOrThrow({
      where: { id: userId },
      select: { status: true },
    });

    await prisma.$transaction([
      prisma.emailOtp.update({ where: { id: otp.id }, data: { consumedAt: new Date() } }),
      prisma.appUser.update({
        where: { id: userId },
        data: {
          emailVerifiedAt: new Date(),
          ...(user.status === "PENDING_VERIFICATION" ? { status: "ACTIVE" } : {}),
        },
      }),
    ]);
  }

  /** Resend a code with per-user cooldown + hourly cap; refuses if already verified. */
  async resend(userId: string): Promise<{ cooldownMs: number }> {
    const user = await prisma.appUser.findUniqueOrThrow({
      where: { id: userId },
      select: { email: true, emailVerifiedAt: true },
    });

    if (user.emailVerifiedAt) {
      throw new AppError("Email is already verified", 409, ErrorCodes.EMAIL_ALREADY_VERIFIED);
    }

    const hourAgo = new Date(Date.now() - 3_600_000);
    const sentLastHour = await prisma.emailOtp.count({
      where: { userId, purpose: PURPOSE, createdAt: { gte: hourAgo } },
    });
    if (sentLastHour >= env.OTP_RESEND_MAX_PER_HOUR) {
      throw new AppError("Too many code requests; try again later", 429, ErrorCodes.OTP_RESEND_LIMIT);
    }

    const last = await prisma.emailOtp.findFirst({
      where: { userId, purpose: PURPOSE },
      orderBy: { createdAt: "desc" },
      select: { createdAt: true },
    });
    if (last && Date.now() - last.createdAt.getTime() < env.OTP_RESEND_COOLDOWN_MS) {
      throw new AppError("Please wait before requesting another code", 429, ErrorCodes.OTP_COOLDOWN);
    }

    const { code } = await this.issue(userId);
    await this.sendOtpEmail(user.email, code);
    return { cooldownMs: env.OTP_RESEND_COOLDOWN_MS };
  }

  /** Issue a password-reset code (cooldown + hourly cap). No status side effects. */
  async issuePasswordReset(userId: string, email: string): Promise<{ cooldownMs: number }> {
    const hourAgo = new Date(Date.now() - 3_600_000);
    const sentLastHour = await prisma.emailOtp.count({
      where: { userId, purpose: RESET_PURPOSE, createdAt: { gte: hourAgo } },
    });
    if (sentLastHour >= env.OTP_RESEND_MAX_PER_HOUR) {
      throw new AppError("Too many reset requests; try again later", 429, ErrorCodes.OTP_RESEND_LIMIT);
    }
    const last = await prisma.emailOtp.findFirst({
      where: { userId, purpose: RESET_PURPOSE },
      orderBy: { createdAt: "desc" },
      select: { createdAt: true },
    });
    if (last && Date.now() - last.createdAt.getTime() < env.OTP_RESEND_COOLDOWN_MS) {
      throw new AppError("Please wait before requesting another code", 429, ErrorCodes.OTP_COOLDOWN);
    }
    await prisma.emailOtp.updateMany({
      where: { userId, purpose: RESET_PURPOSE, consumedAt: null },
      data: { consumedAt: new Date() },
    });
    const code = generateCode(env.OTP_CODE_LENGTH);
    const codeHash = await hashPassword(code);
    const ttlMs = env.PASSWORD_RESET_TTL_MS;
    const expiresAt = new Date(Date.now() + ttlMs);
    await prisma.emailOtp.create({ data: { userId, purpose: RESET_PURPOSE, codeHash, expiresAt } });
    try {
      await systemMailer.sendPasswordResetEmail(email, code, Math.round(ttlMs / 60_000));
    } catch (err) {
      logger.error({ err, userId }, "failed to send password reset email");
    }
    return { cooldownMs: env.OTP_RESEND_COOLDOWN_MS };
  }

  /** Verify + consume a password-reset code. No user mutation (unlike verify()). */
  async verifyPasswordReset(userId: string, code: string): Promise<void> {
    const otp = await prisma.emailOtp.findFirst({
      where: { userId, purpose: RESET_PURPOSE, consumedAt: null },
      orderBy: { createdAt: "desc" },
    });
    if (!otp) throw new AppError("Invalid or expired code", 400, ErrorCodes.OTP_INVALID);
    if (otp.expiresAt.getTime() < Date.now()) {
      throw new AppError("Reset code has expired", 400, ErrorCodes.OTP_EXPIRED);
    }
    if (otp.attempts >= env.OTP_MAX_ATTEMPTS) {
      await prisma.emailOtp.update({ where: { id: otp.id }, data: { consumedAt: new Date() } });
      throw new AppError("Too many incorrect attempts; request a new code", 429, ErrorCodes.OTP_MAX_ATTEMPTS);
    }
    const matches = await verifyPassword(code, otp.codeHash);
    if (!matches) {
      await prisma.emailOtp.update({ where: { id: otp.id }, data: { attempts: { increment: 1 } } });
      throw new AppError("Invalid or expired code", 400, ErrorCodes.OTP_INVALID);
    }
    await prisma.emailOtp.update({ where: { id: otp.id }, data: { consumedAt: new Date() } });
  }
}

export const otpService = new OtpService();