import nodemailer, { type Transporter } from "nodemailer";
import { env } from "../../config/env.js";
import { logger } from "../../config/logger.js";

/**
 * Transactional "system" mailer for platform emails (OTP, security notices).
 * Separate from the per-tenant provider-mail pipeline, which is warmup-limited
 * and tenant-scoped and must not be used for auth emails.
 * When SYSTEM_MAIL_ENABLED is false (default) or SMTP creds are missing, it
 * falls back to log-only so local development works without a mail server.
 */
let transporter: Transporter | null = null;

function getTransporter(): Transporter | null {
  if (!env.SYSTEM_MAIL_ENABLED) return null;
  if (!env.MAIL_PROVIDER_USERNAME || !env.MAIL_PROVIDER_PASSWORD) {
    logger.warn("SYSTEM_MAIL_ENABLED is true but SMTP credentials are missing; using log-only mailer");
    return null;
  }
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: env.SMTP_HOST,
      port: env.SMTP_PORT,
      secure: env.SMTP_SECURE,
      auth: { user: env.MAIL_PROVIDER_USERNAME, pass: env.MAIL_PROVIDER_PASSWORD },
      // Fail fast instead of letting an unreachable host hang the process.
      connectionTimeout: 15_000,
      greetingTimeout: 15_000,
      socketTimeout: 15_000,
    });
  }
  return transporter;
}

export interface SystemMail {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

export class SystemMailer {
  async send(mail: SystemMail): Promise<void> {
    const tx = getTransporter();
    if (!tx) {
      // The field is `logOnlyBody`, not `body`: the logger redacts `body`
      // because real message content must never reach logs (Infrastructure §10).
      // This branch only runs when SYSTEM_MAIL_ENABLED is false — no recipient
      // is receiving the mail, so printing it is the whole point of log-only
      // mode and is how local development reads an OTP.
      logger.info(
        { to: mail.to, subject: mail.subject, logOnlyBody: mail.text },
        "[system-mail:log-only] email not sent (mailer disabled)"
      );
      return;
    }
    await tx.sendMail({
      from: env.SYSTEM_MAIL_FROM,
      to: mail.to,
      subject: mail.subject,
      text: mail.text,
      html: mail.html,
    });
    logger.info({ to: mail.to, subject: mail.subject }, "system email sent");
  }

  async sendOtpEmail(to: string, code: string, ttlMinutes: number): Promise<void> {
    if (env.NODE_ENV !== "production") {
      logger.info({ to, code, ttlMinutes }, "OTP issued (development)");
    }
    await this.send({
      to,
      subject: "Your Zoiko Mail verification code",
      text: `Your verification code is ${code}. It expires in ${ttlMinutes} minutes. If you didn't request this, you can ignore this email.`,
      html: `<p>Your Zoiko Mail verification code is:</p>`
        + `<p style="font-size:24px;font-weight:bold;letter-spacing:3px">${code}</p>`
        + `<p>It expires in ${ttlMinutes} minutes. If you didn't request this, you can ignore this email.</p>`,
    });
  }

  async sendPasswordResetEmail(to: string, code: string, ttlMinutes: number): Promise<void> {
  await this.send({
    to,
    subject: "Reset your Zoiko Mail password",
    text: `Your password reset code is ${code}. It expires in ${ttlMinutes} minutes. `
      + `If you didn't request a reset, ignore this email — your password won't change.`,
    html: `<p>We received a request to reset your Zoiko Mail password. Your code is:</p>`
      + `<p style="font-size:24px;font-weight:bold;letter-spacing:3px">${code}</p>`
      + `<p>It expires in ${ttlMinutes} minutes. If you didn't request this, ignore this email — your password won't change.</p>`,
  });
}

  async sendInvitationEmail(to: string, inviterName: string, workspaceName: string, acceptUrl: string): Promise<void> {
    await this.send({
      to,
      subject: `You've been invited to join ${workspaceName} on Zoiko Mail`,
      text: `${inviterName} has invited you to join ${workspaceName}. Click the link to accept: ${acceptUrl}`,
      html: `<p><b>${inviterName}</b> has invited you to join <b>${workspaceName}</b> on Zoiko Mail.</p>`
        + `<p style="margin:24px 0"><a href="${acceptUrl}" style="display:inline-block;padding:12px 24px;background:#0A7EA4;color:white;text-decoration:none;border-radius:8px;font-weight:600">Accept Invitation</a></p>`
        + `<p style="color:#6C8092;font-size:12px">This invitation expires in ${env.INVITATION_EXPIRES_IN_HOURS} hours. If you didn't expect this, you can ignore this email.</p>`,
    });
  }
}

export const systemMailer = new SystemMailer();