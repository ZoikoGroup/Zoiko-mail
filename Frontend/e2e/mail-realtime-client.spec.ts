import { test, expect, type Page } from "@playwright/test";
import { json } from "./admin-harness";

/**
 * The live stream's client half, with the API stubbed: what the real-backend
 * spec (mail-realtime.spec.ts) cannot arrange on demand — an access token
 * that expires while the stream is down, and the same message announced more
 * than once.
 */

/** An unsigned token with the claims the client reads; the stubbed API never checks it. */
function token(sub: string, exp: number, sid = "s1") {
  const part = (value: object) => Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${part({ alg: "none" })}.${part({ sub, tenantId: "t1", sid, exp, type: "access" })}.sig`;
}

const now = () => Math.floor(Date.now() / 1000);

const listItem = (id: string, subject: string) => ({
  id: `item-${id}`,
  messageId: id,
  folder: "INBOX",
  isRead: false,
  isStarred: false,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  labels: [],
  message: {
    id,
    subject,
    snippet: "",
    status: "RECEIVED",
    sentAt: new Date().toISOString(),
    scheduledAt: null,
    threadId: null,
    authorUserId: "u2",
    fromAddress: "info@temveris.com",
    fromName: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    recipients: [],
    hasAttachments: false,
    attachmentCount: 0,
    author: { id: "u2", email: "info@temveris.com", displayName: "Info" },
  },
});

const sse = (...events: Array<{ type: string; payload?: object }>) =>
  events.map((e) => `event: ${e.type}\ndata: ${JSON.stringify({ ...e, timestamp: new Date().toISOString() })}\n\n`).join("");

interface Stub {
  /** The token each stream request carried, in order. */
  streamTokens: string[];
  refreshes: number;
  inbox: ReturnType<typeof listItem>[];
  /** What the next stream request answers with; the stream ends after it. */
  nextStream: string[];
}

async function stubApi(page: Page, loginToken: string, refreshed: string): Promise<Stub> {
  const stub: Stub = { streamTokens: [], refreshes: 0, inbox: [], nextStream: [] };
  await page.route(
    (url) => url.pathname.startsWith("/api/v1/"),
    async (route) => {
      const url = new URL(route.request().url());
      const path = url.pathname.replace("/api/v1", "");
      const session = {
        accessToken: loginToken,
        refreshToken: "refresh-1",
        expiresIn: "12h",
        user: { id: "u1", email: "management@temveris.com", displayName: "Management" },
        tenant: { id: "t1", name: "Temveris", planCode: "starter" },
        membership: { id: "m1", role: "MEMBER" },
        workspace: "MEMBER",
      };
      if (path === "/events/stream") {
        stub.streamTokens.push(url.searchParams.get("token") ?? "");
        const body = stub.nextStream.shift() ?? sse({ type: "CONNECTED" });
        return route.fulfill({ status: 200, contentType: "text/event-stream", body });
      }
      if (path === "/auth/login") return route.fulfill(json({ state: "SIGNED_IN", session, ...session }));
      if (path === "/auth/refresh") {
        stub.refreshes += 1;
        return route.fulfill(json({ accessToken: refreshed, refreshToken: "refresh-2" }));
      }
      if (path === "/auth/me")
        return route.fulfill(json({ ...session.user, tenant: session.tenant, membership: session.membership, workspace: "MEMBER" }));
      if (path === "/mail" && route.request().method() === "GET")
        return route.fulfill(json({ items: stub.inbox, pagination: { folder: "INBOX", starredOnly: false, page: 1, limit: 25, total: stub.inbox.length, totalPages: 1 } }));
      return route.fulfill(json({ items: [], count: 0, counts: {}, labels: [], mailboxes: [], signature: null }));
    }
  );
  return stub;
}

async function signIn(page: Page) {
  await page.goto("/login/member");
  await page.getByPlaceholder("john@example.com").fill("management@temveris.com");
  await page.getByPlaceholder("Enter your password").fill("Password123!");
  await page.getByRole("button", { name: "Sign In to Member Workspace" }).click();
  await expect(page).toHaveURL(/\/mail$/, { timeout: 60_000 });
}

test("a stream that drops after its token expired reconnects with a refreshed token, then catches up", async ({ page }) => {
  // Valid at sign-in, expired by the time the stream needs reopening.
  // (The client refreshes a token with under 30s left, so this one is used
  // for the first stream and refreshed for a reconnect some seconds later.)
  const expiring = token("u1", now() + 50);
  const refreshed = token("u1", now() + 3600);
  const stub = await stubApi(page, expiring, refreshed);
  // The first stream opens and then ends, as a dropped connection does.
  stub.nextStream.push(sse({ type: "CONNECTED" }));
  await signIn(page);
  await expect.poll(() => stub.streamTokens.length, { timeout: 30_000 }).toBeGreaterThanOrEqual(1);
  expect(stub.streamTokens[0]).toBe(expiring);

  // Mail arrives while it is down.
  stub.inbox.push(listItem("m-missed", "Arrived during the outage"));
  // Within 30s of expiry the client refreshes before it reconnects.
  await expect.poll(() => stub.streamTokens.includes(refreshed), { timeout: 30_000 }).toBe(true);
  expect(stub.refreshes).toBeGreaterThanOrEqual(1);
  // The refused, expired token is not sent again after the refresh.
  expect(stub.streamTokens.slice(stub.streamTokens.indexOf(refreshed))).not.toContain(expiring);
  // Reconnecting re-reads the inbox, so what was announced while down shows.
  await expect(page.getByText("Arrived during the outage")).toBeVisible({ timeout: 20_000 });
});

test("the same message announced twice is listed once and toasted once", async ({ page }) => {
  const valid = token("u1", now() + 3600);
  const stub = await stubApi(page, valid, valid);
  stub.inbox.push(listItem("m-1", "Announced twice"));
  stub.nextStream.push(
    sse(
      { type: "CONNECTED" },
      { type: "NEW_MAIL", payload: { count: 1, folder: "INBOX", messageId: "m-1" } },
      { type: "NEW_MAIL", payload: { count: 1, folder: "INBOX", messageId: "m-1" } }
    )
  );
  await signIn(page);
  await expect(page.getByText("Announced twice")).toHaveCount(1, { timeout: 30_000 });
  await expect(page.getByText(/new email.* arrived/)).toHaveCount(1, { timeout: 10_000 });
  await expect(page.getByText("1 new email arrived")).toBeVisible();
});
