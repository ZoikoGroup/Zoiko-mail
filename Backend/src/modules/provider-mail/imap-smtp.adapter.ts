import { ImapFlow } from "imapflow";
import nodemailer, { type Transporter } from "nodemailer";
import { env } from "../../config/env.js";
import { AppError } from "../../common/errors/AppError.js";
import { ErrorCodes } from "../../common/errors/errorCodes.js";

export interface ProviderMailConfig {
  // imap: { host: string; port: number; secure: true };
  // smtp: { host: string; port: number; secure: true };
  imap: { host: string; port: number; secure: boolean };
  smtp: { host: string; port: number; secure: boolean };
  username: string;
  password: string;
  fromAddress: string;
  connectionTimeoutMs: number;
}

export interface ImapFetchMessage {
  uid: number;
  envelope?: {
    messageId?: string;
    subject?: string;
    date?: Date;
    from?: Array<{ address?: string; name?: string }>;
    to?: Array<{ address?: string; name?: string }>;
    cc?: Array<{ address?: string; name?: string }>;
  };
  flags?: Set<string>;
  internalDate?: Date;
  size?: number;
}

export interface ImapClient {
  connect(): Promise<void>;
  logout(): Promise<void>;
  getMailboxLock(path: string): Promise<{ release(): void }>;
  mailbox: { exists: number } | false;
  fetch(range: string, query: Record<string, boolean>): AsyncIterable<ImapFetchMessage>;
}

export type ImapFactory = (config: ProviderMailConfig) => ImapClient;
export type SmtpFactory = (config: ProviderMailConfig) => Pick<Transporter, "verify" | "sendMail">;

function configuration(): ProviderMailConfig | null {
  if (!env.MAIL_PROVIDER_ENABLED) return null;
  return {
    imap: { host: env.IMAP_HOST, port: env.IMAP_PORT, secure: env.IMAP_SECURE },
    smtp: { host: env.SMTP_HOST, port: env.SMTP_PORT, secure: env.SMTP_SECURE },
    username: env.MAIL_PROVIDER_USERNAME!,
    password: env.MAIL_PROVIDER_PASSWORD!,
    fromAddress: env.MAIL_PROVIDER_FROM_ADDRESS!,
    connectionTimeoutMs: env.MAIL_PROVIDER_CONNECTION_TIMEOUT_MS,
  };
}

const defaultImapFactory: ImapFactory = (config) => new ImapFlow({
  host: config.imap.host,
  port: config.imap.port,
  secure: config.imap.secure,
  auth: { user: config.username, pass: config.password },
  logger: false,
  connectionTimeout: config.connectionTimeoutMs,
  tls: { rejectUnauthorized: true, minVersion: "TLSv1.2" },
  disableAutoIdle: true,
}) as unknown as ImapClient;

// const defaultSmtpFactory: SmtpFactory = (config) => nodemailer.createTransport({
//   host: config.smtp.host,
//   port: config.smtp.port,
//   secure: config.smtp.secure,
//   auth: { user: config.username, pass: config.password },
//   connectionTimeout: config.connectionTimeoutMs,
//   greetingTimeout: config.connectionTimeoutMs,
//   socketTimeout: config.connectionTimeoutMs * 2,
//   tls: { rejectUnauthorized: true, minVersion: "TLSv1.2" },
// });
const defaultSmtpFactory: SmtpFactory = (config) => nodemailer.createTransport({
  host: config.smtp.host,
  port: config.smtp.port,
  secure: config.smtp.secure,
  auth: config.username && config.password
    ? { user: config.username, pass: config.password }
    : undefined,
  connectionTimeout: config.connectionTimeoutMs,
  greetingTimeout: config.connectionTimeoutMs,
  socketTimeout: config.connectionTimeoutMs * 2,
  ...(config.smtp.secure ? { tls: { rejectUnauthorized: true, minVersion: "TLSv1.2" as const } } : {}),
});

function addresses(values?: Array<{ address?: string; name?: string }>) {
  return (values ?? []).flatMap((value) =>
    value.address ? [{ address: value.address.toLowerCase(), name: value.name ?? null }] : []
  );
}

export class ImapSmtpAdapter {
  constructor(
    private readonly config: ProviderMailConfig | null = configuration(),
    private readonly imapFactory: ImapFactory = defaultImapFactory,
    private readonly smtpFactory: SmtpFactory = defaultSmtpFactory
  ) { }

  status() {
    return {
      provider: "SECURESERVER_IMAP_SMTP",
      configured: Boolean(this.config),
      imap: { host: env.IMAP_HOST, port: env.IMAP_PORT, secure: env.IMAP_SECURE },
      smtp: { host: env.SMTP_HOST, port: env.SMTP_PORT, secure: env.SMTP_SECURE },
    };
  }

  private requireConfig() {
    if (!this.config) {
      throw new AppError("IMAP/SMTP provider credentials are not configured", 503, ErrorCodes.INTERNAL_ERROR);
    }
    return this.config;
  }

  async verify() {
    const config = this.requireConfig();
    const imap = this.imapFactory(config);
    const smtp = this.smtpFactory(config);
    let imapConnected = false;
    try {
      await imap.connect();
      imapConnected = true;
      await smtp.verify();
      return { configured: true, imap: "UP", smtp: "UP" };
    } finally {
      if (imapConnected) await imap.logout().catch(() => undefined);
    }
  }

  async fetchMetadata(limit = 50) {
    const config = this.requireConfig();
    const client = this.imapFactory(config);
    await client.connect();
    try {
      const lock = await client.getMailboxLock("INBOX");
      try {
        const exists = client.mailbox ? client.mailbox.exists : 0;
        if (exists === 0) return [];
        const start = Math.max(1, exists - Math.min(Math.max(limit, 1), 100) + 1);
        const result = [];
        for await (const message of client.fetch(`${start}:*`, {
          uid: true, envelope: true, flags: true, internalDate: true, size: true,
        })) {
          result.push({
            uid: message.uid,
            providerMessageId: message.envelope?.messageId ?? null,
            subject: message.envelope?.subject ?? "",
            from: addresses(message.envelope?.from),
            to: addresses(message.envelope?.to),
            cc: addresses(message.envelope?.cc),
            date: message.envelope?.date ?? message.internalDate ?? null,
            flags: [...(message.flags ?? [])].filter((flag) =>
              ["\\Seen", "\\Flagged", "\\Answered", "\\Draft"].includes(flag)
            ),
            size: message.size ?? null,
          });
        }
        return result;
      } finally {
        lock.release();
      }
    } finally {
      await client.logout().catch(() => undefined);
    }
  }

  async send(input: {
    to: string[];
    cc?: string[];
    bcc?: string[];
    subject: string;
    text?: string | null;
    html?: string | null;
  }) {
    const config = this.requireConfig();
    const result = await this.smtpFactory(config).sendMail({
      from: config.fromAddress,
      to: input.to,
      cc: input.cc,
      bcc: input.bcc,
      subject: input.subject,
      text: input.text ?? undefined,
      html: input.html ?? undefined,
    });
    return {
      messageId: result.messageId,
      accepted: result.accepted.map(String),
      rejected: result.rejected.map(String),
      pending: result.pending?.map(String) ?? [],
      response: result.response,
    };
  }
}

export const imapSmtpAdapter = new ImapSmtpAdapter();
