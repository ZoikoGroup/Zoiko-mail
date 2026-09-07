import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import nodemailer, { type Transporter } from "nodemailer";
import { env } from "../../config/env.js";
import { logger } from "../../config/logger.js";

import type { InvitationLetter } from "../../modules/membership/invitation-letter.js";

/** Content id the invitation HTML uses to reference the attached wordmark. */
const WORDMARK_CID = "zoiko-wordmark";

/**
 * Where the wordmark lives, or null if it cannot be found.
 *
 * Two candidates because the same code runs from source and from the image,
 * and the layout differs: `tsx src/...` puts this file under src/, while the
 * build emits it under dist/src/. Both resolve to Backend/assets, but from
 * different depths.
 *
 * The asset is duplicated from Frontend/public rather than shared, because
 * the Docker build context is Backend/ and cannot reach outside it. Worth the
 * copy: the alternative is an email whose logo only renders in production.
 */
let wordmarkCache: string | null | undefined;
function wordmarkPath(): string | null {
  if (wordmarkCache !== undefined) return wordmarkCache;

  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    // src/common/mailer -> Backend/assets
    resolve(here, "../../../assets/zoiko-wordmark.png"),
    // dist/src/common/mailer -> /app/assets
    resolve(here, "../../../../assets/zoiko-wordmark.png"),
  ];

  wordmarkCache = candidates.find((path) => existsSync(path)) ?? null;
  if (!wordmarkCache) {
    logger.warn(
      { candidates },
      "wordmark asset not found; invitation emails will use a text wordmark"
    );
  }
  return wordmarkCache;
}

/**
 * Escapes text destined for an HTML email body.
 *
 * Needed because the invitation body can be edited by an admin before it is
 * sent. Without this, an ampersand in a company name breaks the markup and a
 * pasted tag would be rendered by the recipient's client.
 */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

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
  /**
   * Inline images, referenced from the HTML as `cid:<cid>`.
   *
   * Needed because a remote <img> does not work in a real inbox. Gmail and
   * Outlook fetch images through their own servers, so an absolute URL has to
   * be publicly reachable — a development APP_URL of http://localhost:3000
   * resolves to their proxy's own machine and the recipient sees the alt text.
   * An attached image travels with the message and needs no fetch at all.
   */
  attachments?: Array<{
    filename: string;
    path: string;
    cid: string;
  }>;
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
      attachments: mail.attachments,
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
        + `<p>It expires in ${ttlMinutes} minutes. If you didn't request a reset, ignore this email — your password won't change.</p>`,
    });
  }

  /**
   * The invitation, laid out as a letter: wordmark, greeting, body, then the
   * accept button.
   *
   * The body is escaped because an admin may have edited it before sending.
   * It is theirs to word, but it is not theirs to put markup into a message
   * that goes out under the workspace's name and the platform's address.
   */
  async sendInvitationEmail(
    to: string,
    letter: InvitationLetter,
    acceptUrl: string
  ): Promise<void> {
    const paragraphs = letter.paragraphs
      .map(
        (text) =>
          `<p style="margin:0 0 16px;line-height:1.6">${escapeHtml(text)}</p>`
      )
      .join("");

    // Attached rather than linked. A remote <img> pointing at APP_URL only
    // renders when that host is reachable from the recipient's mail provider,
    // and Gmail fetches through its own servers — so a development APP_URL of
    // localhost:3000 showed nothing but the alt text in a real inbox.
    //
    // Falls back to a text wordmark when the file is missing, because the
    // failure being fixed here is a broken image and a `cid:` pointing at an
    // absent attachment is exactly that again.
    const logoFile = wordmarkPath();
    const logo = logoFile
      ? `<img src="cid:${WORDMARK_CID}" alt="Zoiko Mail" height="24" `
        + `style="height:24px;border:0;display:block" />`
      : `<span style="font-size:17px;font-weight:700;letter-spacing:-0.2px;color:#12232E">Zoiko Mail</span>`;

    await this.send({
      to,
      subject: letter.subject,
      // The plain-text part is a real letter too, not a link dump: some
      // clients show only this, and it is what a screen reader reaches first.
      text: [
        letter.greeting,
        "",
        ...letter.paragraphs,
        "",
        `Accept your invitation: ${acceptUrl}`,
        "",
        letter.closing,
      ].join("\n"),
      html:
        `<div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#12232E;max-width:560px">`
        + `<div style="margin:0 0 28px">${logo}</div>`
        + `<p style="margin:0 0 20px;font-size:16px">${escapeHtml(letter.greeting)}</p>`
        + paragraphs
        + `<p style="margin:28px 0"><a href="${acceptUrl}" style="display:inline-block;padding:12px 24px;background:#0A7EA4;color:white;text-decoration:none;border-radius:8px;font-weight:600">Accept invitation</a></p>`
        + `<p style="color:#6C8092;font-size:12px;margin:0 0 4px">${escapeHtml(letter.closing)}</p>`
        + `<p style="color:#6C8092;font-size:12px;margin:0">This invitation expires in ${env.INVITATION_EXPIRES_IN_HOURS} hours.</p>`
        + `</div>`,
      attachments: logoFile
        ? [
            {
              filename: "zoiko-wordmark.png",
              path: logoFile,
              cid: WORDMARK_CID,
            },
          ]
        : undefined,
    });
  }
}

export const systemMailer = new SystemMailer();