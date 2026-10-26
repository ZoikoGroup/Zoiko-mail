import { expect, type Page } from "@playwright/test";
import { json } from "./admin-harness";

/**
 * Signing in as a Member and opening a Work Graph page against an in-memory
 * stand-in for the API. Each spec supplies a `handle` for the Work Graph
 * endpoints it cares about; everything else (sign-in, mailbox, calendars, people)
 * is answered here, the same way for every spec.
 */

export interface Written {
  method: string;
  path: string;
  body: unknown;
}

export interface Request {
  path: string;
  method: string;
  url: URL;
  body: any;
}

export type Handler = (request: Request) => unknown;

export const COLLEAGUES = [
  { email: "priya@acme.test", name: "Priya Shah" },
  { email: "james@acme.test", name: "James Carter" },
];

export const MAIL = [
  { id: "mm-1", messageId: "msg-1", folder: "INBOX", isRead: true, isStarred: false, createdAt: "2026-10-20T09:00:00.000Z", message: { id: "msg-1", subject: "Creative sign-off", fromName: "Partner Team", fromAddress: "partner@outside.example", sentAt: "2026-10-20T09:00:00.000Z", createdAt: "2026-10-20T09:00:00.000Z" } },
  { id: "mm-2", messageId: "msg-2", folder: "INBOX", isRead: true, isStarred: false, createdAt: "2026-10-21T09:00:00.000Z", message: { id: "msg-2", subject: "Launch partner handoff", fromName: "Partner Team", fromAddress: "partner@outside.example", sentAt: "2026-10-21T09:00:00.000Z", createdAt: "2026-10-21T09:00:00.000Z" } },
];

export async function openWorkGraph(page: Page, path: string, handle: Handler, { viewport = { width: 1700, height: 1000 } }: { viewport?: { width: number; height: number } } = {}) {
  const writes: Written[] = [];
  const requests: Array<{ path: string; query: Record<string, string> }> = [];
  await page.addInitScript(() => window.localStorage.setItem("theme", "dark"));
  await page.route(
    (url) => url.pathname.startsWith("/api/v1/"),
    async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      const p = url.pathname.replace("/api/v1", "");
      const method = request.method();
      const body = method === "GET" || method === "DELETE" ? null : request.postDataJSON();
      if (method !== "GET") writes.push({ method, path: p, body });
      else requests.push({ path: p, query: Object.fromEntries(url.searchParams) });
      const session = {
        accessToken: "stub-access-token",
        refreshToken: "stub-refresh-token",
        expiresIn: "12h",
        user: { id: "u1", email: "michael@acme.test", displayName: "Michael Irvine" },
        tenant: { id: "t1", name: "Acme Workspace", planCode: "business" },
        membership: { id: "m1", role: "MEMBER" },
        workspace: "MEMBER",
      };
      if (p === "/events/stream") return route.fulfill({ status: 200, contentType: "text/event-stream", body: "" });
      if (p === "/auth/login") return route.fulfill(json({ state: "SIGNED_IN", session, ...session }));
      if (p === "/auth/me") return route.fulfill(json({ ...session.user, tenant: session.tenant, membership: session.membership, workspace: "MEMBER" }));
      if (p === "/mail/mailbox") return route.fulfill(json({ address: "michael@acme.test", storageUsed: 2.4 * 1024 ** 3, storageLimit: 10 * 1024 ** 3 }));
      if (p === "/mail/unread-counts") return route.fulfill(json({ counts: { INBOX: 0 } }));
      if (p === "/mail/shared-inboxes") return route.fulfill(json({ mailboxes: [] }));
      if (p === "/mail" && method === "GET") return route.fulfill(json({ items: MAIL, pagination: { folder: "INBOX", starredOnly: false, page: 1, limit: 8, total: MAIL.length, totalPages: 1 } }));
      if (p === "/calendar/preferences") return route.fulfill(json({}));
      if (p === "/calendar/invitations/counts") return route.fulfill(json({ awaiting: 0, updates: 0 }));
      if (p === "/calendar/calendars") return route.fulfill(json([{ id: "c-work", kind: "PERSONAL", name: "Work", color: "blue", description: null, isDefault: true, isVisible: true, createdAt: "", updatedAt: "" }]));
      if (p === "/calendar/events" && method === "GET") return route.fulfill(json([{ id: "ev-1", calendarId: "c-work", title: "Release review", description: null, location: null, videoLink: null, startsAt: "2026-10-21T14:00:00.000Z", endsAt: "2026-10-21T15:00:00.000Z", allDay: false, timeZone: "UTC", visibility: "DEFAULT", showAs: "BUSY", createdAt: "", updatedAt: "", source: "OWN" }]));
      if (p === "/calendar/events/stream") return route.fulfill(json([]));
      if (p === "/workgraph/people") return route.fulfill(json(COLLEAGUES.filter((c) => !url.searchParams.get("q") || c.name.toLowerCase().includes(url.searchParams.get("q")!.toLowerCase()))));
      const result = handle({ path: p, method, url, body });
      if (result === undefined) return route.fulfill(json([]));
      if (result && typeof result === "object" && "__status" in (result as object)) {
        const r = result as { __status: number; __body: unknown };
        return route.fulfill({ status: r.__status, contentType: "application/json", body: r.__status === 204 ? "" : JSON.stringify(r.__body) });
      }
      return route.fulfill(json(result));
    }
  );
  await page.setViewportSize(viewport);
  await page.goto("/login/member");
  await page.getByPlaceholder("john@example.com").fill("michael@acme.test");
  await page.getByPlaceholder("Enter your password").fill("Password123!");
  await page.getByRole("button", { name: "Sign In to Member Workspace" }).click();
  await expect(page).toHaveURL(/\/mail$/, { timeout: 60_000 });
  // The first visit to a route can be interrupted while the dev server compiles it.
  try {
    await page.goto(path);
  } catch {
    await page.goto(path);
  }
  return { writes, requests };
}

export const noContent = () => ({ __status: 204, __body: null });
export const refused = (status: number, code: string, message: string, details?: unknown) => ({ __status: status, __body: { success: false, error: { code, message, details }, requestId: "e2e" } });

export async function shot(page: Page, name: string) {
  if (process.env.E2E_SCREENSHOTS) await page.screenshot({ path: `${process.env.E2E_SCREENSHOTS}/${name}.png` });
}

/** A signed-in colleague view of someone: member or team. */
export const me = { kind: "MEMBER", name: "Michael Irvine", email: "michael@acme.test", isMe: true };
export const team = (name: string) => ({ kind: "TEAM", name, email: null, isMe: false });
export const colleague = (name: string, email: string) => ({ kind: "MEMBER", name, email, isMe: false });
