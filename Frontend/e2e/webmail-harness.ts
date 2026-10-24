import { expect, type Page } from "@playwright/test";
import { json } from "./admin-harness";

/**
 * The Member inbox with its API stubbed by responses shaped exactly like the
 * server's: an inbox, a message with attachments, two shared inboxes,
 * notifications, labels and storage. Shared by the webmail specs.
 */

const now = new Date();
const iso = (minutesAgo: number) => new Date(now.getTime() - minutesAgo * 60_000).toISOString();

function listItem(id: string, from: string, fromName: string, subject: string, snippet: string, minutesAgo: number, extra: Partial<{ isRead: boolean; attachmentCount: number }> = {}) {
  return {
    id: `item-${id}`,
    messageId: id,
    folder: "INBOX",
    isRead: extra.isRead ?? false,
    isStarred: false,
    createdAt: iso(minutesAgo),
    updatedAt: iso(minutesAgo),
    labels: [],
    message: {
      id,
      subject,
      snippet,
      status: "RECEIVED",
      sentAt: iso(minutesAgo),
      scheduledAt: null,
      threadId: null,
      authorUserId: "u2",
      fromAddress: from,
      fromName,
      createdAt: iso(minutesAgo),
      updatedAt: iso(minutesAgo),
      recipients: [{ id: `r-${id}`, email: "michael@acme.test", type: "TO", deliveryStatus: "DELIVERED" }],
      hasAttachments: (extra.attachmentCount ?? 0) > 0,
      attachmentCount: extra.attachmentCount ?? 0,
      author: { id: "u2", email: from, displayName: fromName },
    },
  };
}

const INBOX = [
  listItem("m1", "sarah.mitchell@example.com", "Sarah Mitchell", "Project update — Q4 planning", "Sharing the revised timeline and milestones for review.", 30, { attachmentCount: 3 }),
  listItem("m2", "james.carter@example.com", "James Carter", "Re: Marketing assets", "Thanks, Sarah. The files look great.", 95),
  listItem("m3", "team@zoiko.example", "Zoiko Team", "Security policy reminder", "Review the latest account security guidance.", 160, { isRead: true }),
  listItem("m4", "lena.park@example.com", "Lena Park", "Team meeting agenda", "Can we move the meeting to 2:00 PM?", 60 * 26),
];

const DETAIL = {
  ...INBOX[0],
  message: {
    ...INBOX[0].message,
    textBody: "Hi team,\n\nSharing the updated planning materials for our Q4 review.",
    htmlBody:
      "<p>Hi team,</p><p>Sharing the updated planning materials for our Q4 review. Please take a look at the proposed priorities.</p><p><b>Items for review</b></p><ul><li><b>Product:</b> Confirm the next set of mailbox workflow improvements.</li><li><b>Security:</b> Review authentication and tenant access controls.</li></ul><p>Best regards,<br/><b>Sarah Mitchell</b><br/>Product Manager</p>",
    recipients: [
      { id: "r1", email: "michael@acme.test", type: "TO", deliveryStatus: "DELIVERED" },
      { id: "r2", email: "james.carter@example.com", type: "CC", deliveryStatus: "DELIVERED" },
    ],
    attachments: [
      { id: "a1", fileName: "Q4 Roadmap.pptx", contentType: "application/vnd.openxmlformats-officedocument.presentationml.presentation", sizeBytes: 2_516_582, createdAt: iso(30) },
      { id: "a2", fileName: "Budget v2.xlsx", contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", sizeBytes: 1_153_434, createdAt: iso(30) },
      { id: "a3", fileName: "Milestones.pdf", contentType: "application/pdf", sizeBytes: 2_202_009, createdAt: iso(30) },
    ],
  },
};

const SHARED = [
  { id: "sh-support", address: "support@acme.test", type: "SHARED", delegated: false, canSend: true, canManage: false, unread: 5 },
  { id: "sh-sales", address: "sales@acme.test", type: "SHARED", delegated: false, canSend: false, canManage: false, unread: 3 },
];

export interface Calls {
  paths: string[];
}

export async function openWebmail(page: Page): Promise<Calls> {
  const calls: Calls = { paths: [] };
  await page.route(
    (url) => url.pathname.startsWith("/api/v1/"),
    async (route) => {
      const url = new URL(route.request().url());
      const path = url.pathname.replace("/api/v1", "");
      calls.paths.push(`${route.request().method()} ${path}${url.search}`);
      const session = {
        accessToken: "stub-access-token",
        refreshToken: "stub-refresh-token",
        expiresIn: "12h",
        user: { id: "u1", email: "michael@acme.test", displayName: "Michael Rivera" },
        tenant: { id: "t1", name: "Acme Workspace", planCode: "business" },
        membership: { id: "m1", role: "MEMBER" },
        workspace: "MEMBER",
      };
      if (path === "/events/stream") return route.fulfill({ status: 200, contentType: "text/event-stream", body: "" });
      if (path === "/auth/login") return route.fulfill(json({ state: "SIGNED_IN", session, ...session }));
      if (path === "/auth/me") return route.fulfill(json({ ...session.user, tenant: session.tenant, membership: session.membership, workspace: "MEMBER" }));
      if (path === "/mail/unread-counts") return route.fulfill(json({ counts: { INBOX: 8, DRAFTS: 2, SNOOZED: 0, SCHEDULED: 0 } }));
      if (path === "/mail/shared-inboxes") return route.fulfill(json({ mailboxes: SHARED }));
      if (path === "/mail/mailbox") return route.fulfill(json({ address: "michael@acme.test", storageUsed: 2.4 * 1024 ** 3, storageLimit: 10 * 1024 ** 3 }));
      if (path === "/mail/labels") return route.fulfill(json({ labels: [{ id: "l1", name: "Clients", color: "#2563eb" }] }));
      if (path === "/mail/send-as") return route.fulfill(json({ mailboxes: [{ id: "own", address: "michael@acme.test", type: "USER", shared: false, sendSuspended: false }] }));
      if (path === "/mail/signature") return route.fulfill(json({ signature: null }));
      if (path === "/notifications")
        return route.fulfill(json({ notifications: [
          { id: "n1", type: "INFO", title: "New sign-in", body: "A new device signed in.", createdAt: iso(10), readAt: null },
          { id: "n2", type: "INFO", title: "Storage at 24%", body: "", createdAt: iso(100), readAt: null },
          { id: "n3", type: "INFO", title: "Weekly digest", body: "", createdAt: iso(2000), readAt: iso(1000) },
        ] }));
      if (path === "/mail" && route.request().method() === "GET") {
        const shared = url.searchParams.get("mailboxId");
        const items = shared === "sh-support" ? [listItem("s1", "customer@outside.test", "Dana Customer", "Order question", "Where is my order?", 12)] : INBOX;
        return route.fulfill(json({ items, pagination: { folder: "INBOX", starredOnly: false, page: 1, limit: 25, total: items.length, totalPages: 1 } }));
      }
      if (path === "/mail/m1" && route.request().method() === "GET") return route.fulfill(json(DETAIL));
      if (path.startsWith("/mail/") && route.request().method() === "PATCH") return route.fulfill(json(DETAIL));
      return route.fulfill(json({ items: [], count: 0 }));
    }
  );
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.goto("/login/member");
  await page.getByPlaceholder("john@example.com").fill("michael@acme.test");
  await page.getByPlaceholder("Enter your password").fill("Password123!");
  await page.getByRole("button", { name: "Sign In to Member Workspace" }).click();
  await expect(page).toHaveURL(/\/mail$/, { timeout: 60_000 });
  return calls;
}

