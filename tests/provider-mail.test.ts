import { describe, expect, it, vi } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import { env } from "../src/config/env.js";
import { ImapSmtpAdapter, type ImapFetchMessage, type ProviderMailConfig } from "../src/modules/provider-mail/imap-smtp.adapter.js";

const config: ProviderMailConfig = {
  imap: { host: "imap.secureserver.net", port: 993, secure: true },
  smtp: { host: "smtpout.secureserver.net", port: 465, secure: true },
  username: "mailbox@example.test",
  password: "secret-used-only-by-mock",
  fromAddress: "mailbox@example.test",
  connectionTimeoutMs: 5_000,
};

function mocks(messages: ImapFetchMessage[] = []) {
  const release = vi.fn();
  const connect = vi.fn(async () => undefined);
  const logout = vi.fn(async () => undefined);
  const verify = vi.fn(async () => true as const);
  const sendMail = vi.fn(async () => ({
    messageId: "smtp-message-1",
    accepted: ["accepted@example.test"],
    rejected: [],
    pending: [],
    response: "250 accepted",
  }));
  const imapFactory = vi.fn(() => ({
    connect,
    logout,
    mailbox: { exists: messages.length },
    getMailboxLock: vi.fn(async () => ({ release })),
    async *fetch() {
      for (const message of messages) yield message;
    },
  }));
  const smtpFactory = vi.fn(() => ({ verify, sendMail }));
  return { release, connect, logout, verify, sendMail, imapFactory, smtpFactory };
}

describe("SecureServer IMAP/SMTP adapter", () => {
  it("reports whether the production adapter is configured", async () => {
    const app = createApp();
    await request(app).get("/api/provider-mail/health").expect(401);
    const response = await request(app).get("/api/provider-mail/health")
      .set("x-operations-key", env.OPERATIONS_KEY).expect(200);
    expect(response.body.data).toMatchObject({
      configured: env.MAIL_PROVIDER_ENABLED,
      imap: { host: "imap.secureserver.net", port: 993, secure: true },
      smtp: { host: "smtpout.secureserver.net", port: 465, secure: true },
    });
    expect(JSON.stringify(response.body)).not.toContain("password");
  });

  it("verifies both TLS services and always closes IMAP", async () => {
    const mock = mocks();
    const adapter = new ImapSmtpAdapter(config, mock.imapFactory, mock.smtpFactory);
    await expect(adapter.verify()).resolves.toEqual({ configured: true, imap: "UP", smtp: "UP" });
    expect(mock.connect).toHaveBeenCalledOnce();
    expect(mock.verify).toHaveBeenCalledOnce();
    expect(mock.logout).toHaveBeenCalledOnce();
  });

  it("normalizes only allow-listed IMAP metadata", async () => {
    const mock = mocks([{
      uid: 42,
      envelope: {
        messageId: "<provider-42@example.test>",
        subject: "Provider mail",
        from: [{ address: "SENDER@EXAMPLE.TEST", name: "Sender" }],
        to: [{ address: "mailbox@example.test" }],
      },
      flags: new Set(["\\Seen", "\\Recent", "provider-private-label"]),
      internalDate: new Date("2026-07-28T10:00:00.000Z"),
      size: 1234,
    }]);
    const adapter = new ImapSmtpAdapter(config, mock.imapFactory, mock.smtpFactory);
    const result = await adapter.fetchMetadata();
    expect(result).toEqual([expect.objectContaining({
      uid: 42,
      providerMessageId: "<provider-42@example.test>",
      from: [{ address: "sender@example.test", name: "Sender" }],
      flags: ["\\Seen"],
      size: 1234,
    })]);
    expect(JSON.stringify(result)).not.toContain("must not be returned");
    expect(JSON.stringify(result)).not.toContain("provider-private-label");
    expect(mock.release).toHaveBeenCalledOnce();
    expect(mock.logout).toHaveBeenCalledOnce();
  });

  it("submits SMTP through the configured sender without exposing credentials", async () => {
    const mock = mocks();
    const adapter = new ImapSmtpAdapter(config, mock.imapFactory, mock.smtpFactory);
    const result = await adapter.send({
      to: ["accepted@example.test"],
      subject: "SMTP adapter",
      text: "Provider-independent send",
    });
    expect(mock.sendMail).toHaveBeenCalledWith(expect.objectContaining({
      from: "mailbox@example.test",
      to: ["accepted@example.test"],
    }));
    expect(result).toMatchObject({ messageId: "smtp-message-1", accepted: ["accepted@example.test"] });
    expect(JSON.stringify(result)).not.toContain(config.password);
  });
});
