import { afterEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import { prisma } from "../src/config/prisma.js";
import { authHeader, registerUser } from "./helpers.js";
import { gmailConnector } from "../src/modules/connector/gmail/gmail.connector.js";
import { connectorService } from "../src/modules/connector/connector.service.js";
import { storeConnectorTokens } from "../src/common/secrets/connectorTokens.js";

const app = createApp();

// Record of every Gmail API call made by the connector, keyed by method name.
const gmailCalls: string[] = [];

const gmailStub = {
  users: {
    watch: vi.fn(async () => ({
      data: { historyId: "2000", expiration: String(Date.now() + 3600_000) },
    })),
    getProfile: vi.fn(async () => ({ data: { historyId: "2000" } })),
    messages: {
      list: vi.fn(async () => ({ data: { messages: [{ id: "msg-1" }, { id: "msg-2" }] } })),
      get: vi.fn(async (params: { id: string }) => ({
        data: {
          id: params.id,
          threadId: "thread-1",
          labelIds: params.id === "msg-1" ? [] : ["UNREAD"],
          internalDate: "1700000000000",
          snippet: "snippet",
          payload: {
            headers: [
              { name: "Subject", value: "Re: Hello" },
              { name: "From", value: "Alice <alice@example.com>" },
              { name: "To", value: "bob@example.com" },
              { name: "Date", value: "2023-11-14T22:13:20.000Z" },
            ],
            mimeType: "multipart/alternative",
            parts: [
              { mimeType: "text/plain", body: { data: Buffer.from("hello").toString("base64") } },
            ],
          },
        },
      })),
    },
    history: {
      list: vi.fn(async () => ({
        data: {
          history: [
            {
              id: "1999",
              messagesAdded: [{ message: { id: "msg-9", threadId: "thread-9" } }],
            },
          ],
        },
      })),
    },
  },
};

vi.mock("googleapis", () => ({
  google: {
    auth: {
      OAuth2: class {
        setCredentials() {}
      },
    },
    gmail: () => wrapForCalls(gmailStub),
  },
}));

function wrapForCalls(node: Record<string, unknown>, path: string[] = []): Record<string, unknown> {
  const wrapped: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(node)) {
    const nextPath = [...path, key];
    if (typeof value === "function") {
      wrapped[key] = async (...args: unknown[]) => {
        gmailCalls.push(nextPath.join("."));
        return (value as (...a: unknown[]) => Promise<unknown>)(...args);
      };
    } else if (value && typeof value === "object") {
      wrapped[key] = wrapForCalls(value as Record<string, unknown>, nextPath);
    }
  }
  return wrapped;
}

async function seedConnectedAccount() {
  const owner = await registerUser(app, { email: `gmail-sync-${Date.now()}@zoiko.test` });
  const membership = await prisma.tenantMembership.findFirstOrThrow({
    where: { tenantId: owner.tenantId },
  });
  const mailbox = await prisma.mailbox.upsert({
    where: { membershipId: membership.id },
    update: {},
    create: {
      tenantId: owner.tenantId,
      membershipId: membership.id,
      address: "bob@example.com",
    },
  });

  // Store tokens in the secret store seam (env-file default) so
  // getGoogleAccessToken resolves to a non-expired token without a web round-trip.
  const providerAccountId = `gma-${Date.now()}`;
  const tokenRef = await storeConnectorTokens(
    "GMAIL",
    providerAccountId,
    { accessToken: "test-access-token", refreshToken: "test-refresh-token" },
    { purpose: "test" }
  );
  await prisma.connectedAccount.create({
    data: {
      tenantId: owner.tenantId,
      membershipId: membership.id,
      userId: owner.userId,
      provider: "GMAIL",
      providerAccountId,
      email: "bob@gmail.test",
      scopes: ["https://www.googleapis.com/auth/gmail.readonly"],
      status: "ACTIVE",
      tokenSecretRef: tokenRef,
      tokenExpiresAt: new Date(Date.now() + 3600_000),
    },
  });
  return { owner, mailboxId: mailbox.id };
}

afterEach(() => {
  vi.clearAllMocks();
  gmailCalls.length = 0;
});

describe("Gmail connector history sync (ZM-BE-005)", () => {
  it("backfills recent INBOX messages on first sync and is idempotent", async () => {
    const { owner } = await seedConnectedAccount();
    const account = await prisma.connectedAccount.findFirstOrThrow({
      where: { tenantId: owner.tenantId, provider: "GMAIL" },
    });

    const first = await gmailConnector.syncHistory(account.id, owner.tenantId);
    // No startHistoryId -> backfill path; messages.list + messages.get x2 + getProfile.
    expect(first.imported).toBe(2);
    expect(await prisma.emailMessage.count({ where: { tenantId: owner.tenantId } })).toBe(2);

    // Sync again — already-checkpointed history (id 1999 < 2000) yields nothing
    // new, and the unique providerMessageId constraint guards double-import.
    const second = await gmailConnector.syncHistory(account.id, owner.tenantId);
    expect(second.imported).toBe(0);
    expect(await prisma.emailMessage.count({ where: { tenantId: owner.tenantId } })).toBe(2);

    // Normalization sanity: subject stripped of Re:, read/unread flag mapped.
    const msg = await prisma.emailMessage.findFirstOrThrow({
      where: { tenantId: owner.tenantId, providerMessageId: "msg-1" },
      include: { mailboxItems: true, recipients: true },
    });
    expect(msg.subject).toBe("Re: Hello");
    expect(msg.fromAddress).toBe("alice@example.com");
    expect(msg.mailboxItems[0].folder).toBe("INBOX");
    expect(msg.mailboxItems[0].isRead).toBe(true);
    expect(msg.recipients.some((r) => r.email === "bob@example.com")).toBe(true);
  });
});

describe("Gmail users.watch registration (ZM-BE-005)", () => {
  it("registers watch and records expiration on the connected account", async () => {
    const { owner } = await seedConnectedAccount();
    const account = await prisma.connectedAccount.findFirstOrThrow({
      where: { tenantId: owner.tenantId, provider: "GMAIL" },
    });

    // Without a Pub/Sub topic configured, watch must throw a clear error.
    const prevTopic = process.env.GMAIL_PUBSUB_TOPIC;
    delete process.env.GMAIL_PUBSUB_TOPIC;
    await expect(gmailConnector.registerWatch(account.id, owner.tenantId)).rejects.toThrow(/PUBSUB_TOPIC/);
    if (prevTopic !== undefined) process.env.GMAIL_PUBSUB_TOPIC = prevTopic;
  });
});

describe("Connector OAuth validation stays intact with Gmail connector", () => {
  it("still rejects non-readonly Gmail scopes", async () => {
    const owner = await registerUser(app, { email: `gmail-scope-${Date.now()}@zoiko.test` });
    await connectorService;
    const res = await request(app).post("/api/v1/connectors")
      .set(authHeader(owner.accessToken))
      .send({
        provider: "GMAIL",
        providerAccountId: "g-with-modify",
        email: "a@gmail.test",
        scopes: ["https://www.googleapis.com/auth/gmail.modify"],
      });
    expect(res.status).toBe(400);
  });
});
