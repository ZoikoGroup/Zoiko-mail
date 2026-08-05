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
      logger.info(
        { to: mail.to, subject: mail.subject, body: mail.text },
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
    await this.send({
      to,
      subject: "Your Zoiko Mail verification code",
      text: `Your verification code is ${code}. It expires in ${ttlMinutes} minutes. If you didn't request this, you can ignore this email.`,
      html: `<p>Your Zoiko Mail verification code is:</p>`
        + `<p style="font-size:24px;font-weight:bold;letter-spacing:3px">${code}</p>`
        + `<p>It expires in ${ttlMinutes} minutes. If you didn't request this, you can ignore this email.</p>`,
    });
  }
}

export const systemMailer = new SystemMailer();