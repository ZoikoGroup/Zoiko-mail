import { test, expect, type Page } from "@playwright/test";
import { json } from "./admin-harness";

/**
 * The Member workspace's mail screen, as the reference design lays it out,
 * driven by API responses shaped exactly like the server's.
 *
 * What it checks is that every number and name on screen comes from those
 * responses (the workspace, unread counts, shared inboxes, notifications,
 * storage, snippets, attachments) — nothing is hard-coded — and that the
 * sections not built yet show Coming Soon. Set E2E_SCREENSHOTS to a folder
 * to also save screenshots of each state.
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

interface Calls {
  paths: string[];
}

async function openWebmail(page: Page): Promise<Calls> {
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

async function shot(page: Page, name: string) {
  if (process.env.E2E_SCREENSHOTS) await page.screenshot({ path: `${process.env.E2E_SCREENSHOTS}/${name}.png` });
}

test("the inbox shows the workspace, counts, shared inboxes, storage and messages from the API", async ({ page }) => {
  await openWebmail(page);
  const header = page.locator("header");
  await expect(header.getByText("Acme Workspace")).toBeVisible({ timeout: 60_000 });
  await expect(page.getByTestId("notification-count")).toHaveText("2");

  const folders = page.getByRole("complementary", { name: "Mail folders" });
  await expect(folders.getByRole("button", { name: /Inbox\s*8/ })).toBeVisible();
  await expect(folders.getByRole("button", { name: /Drafts\s*2/ })).toBeVisible();
  const shared = folders.getByTestId("shared-inboxes");
  await expect(shared.getByRole("button", { name: /support\s*5/ })).toBeVisible();
  await expect(shared.getByRole("button", { name: /sales\s*3/ })).toBeVisible();
  await expect(folders.getByTestId("storage-meter")).toContainText("2.4 of 10 GB");

  const list = page.getByRole("region", { name: "Inbox messages" });
  await expect(list.getByText("Personal mailbox")).toBeVisible();
  await expect(list.getByText("8 unread")).toBeVisible();
  await expect(list.getByText("Sarah Mitchell", { exact: true })).toBeVisible();
  await expect(list.getByText("Sharing the revised timeline and milestones for review.")).toBeVisible();
  await expect(list.getByText("3 attachments")).toBeVisible();
  await shot(page, "1-inbox");
});

test("opening a message shows sender, recipients, body, attachment cards and the reply bar", async ({ page }) => {
  const calls = await openWebmail(page);
  await page.getByText("Project update — Q4 planning").first().click();
  const pane = page.getByRole("article", { name: "Project update — Q4 planning" });
  await expect(pane.getByRole("heading", { name: "Project update — Q4 planning" })).toBeVisible({ timeout: 30_000 });
  await expect(pane.getByText("<sarah.mitchell@example.com>")).toBeVisible();
  await expect(pane.getByText("To: michael@acme.test")).toBeVisible();
  await expect(pane.getByText("Cc: james.carter@example.com")).toBeVisible();
  await expect(pane.frameLocator("iframe[title='Message body']").getByText("Items for review")).toBeVisible();
  const attachments = pane.getByTestId("attachment-list");
  await expect(attachments).toContainText("3 attachments · 5.6 MB");
  await expect(attachments.getByRole("button", { name: "Download all" })).toBeVisible();
  await expect(attachments.getByTestId("attachment-card")).toHaveCount(3);
  await expect(pane.getByRole("button", { name: "Reply", exact: true })).toBeVisible();
  await expect(pane.getByRole("button", { name: "Reply all" })).toBeVisible();
  await expect(pane.getByRole("button", { name: "Forward" })).toBeVisible();
  await expect(pane.getByRole("button", { name: /Create task/ })).toHaveAttribute("aria-disabled", "true");
  // Opening an unread message marks it read on the server.
  await expect.poll(() => calls.paths.some((p) => p.startsWith("PATCH /mail/m1"))).toBe(true);
  await shot(page, "2-reading");
});

test("a shared inbox opens in the same list, read from that mailbox", async ({ page }) => {
  const calls = await openWebmail(page);
  await page.getByTestId("shared-inboxes").getByRole("button", { name: /support/ }).click();
  const list = page.getByRole("region", { name: "support@acme.test messages" });
  await expect(list.getByText("Shared inbox")).toBeVisible({ timeout: 30_000 });
  await expect(list.getByText("Order question")).toBeVisible();
  expect(calls.paths.some((p) => p.startsWith("GET /mail?") && p.includes("mailboxId=sh-support"))).toBe(true);
});

test("Ctrl+K focuses search", async ({ page }) => {
  await openWebmail(page);
  await expect(page.getByText("Sarah Mitchell").first()).toBeVisible({ timeout: 60_000 });
  await page.keyboard.press("Control+k");
  await expect(page.locator("#mail-search")).toBeFocused();
});

for (const [href, title] of [
  ["/mail/calendar", "Calendar"],
  ["/mail/tasks", "Tasks"],
  ["/mail/contacts", "Contacts"],
  ["/mail/work-graph", "Work Graph"],
  ["/mail/alet", "Alet"],
] as const) {
  test(`${title} shows Coming Soon inside the workspace`, async ({ page }) => {
    await openWebmail(page);
    await page.getByRole("navigation", { name: "Workspace sections" }).first().getByRole("link", { name: title, exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`${href}$`), { timeout: 60_000 });
    const soon = page.getByTestId("coming-soon");
    await expect(soon.getByRole("heading", { name: title })).toBeVisible({ timeout: 60_000 });
    await expect(soon.getByText("Coming Soon...")).toBeVisible();
    await expect(soon.getByRole("link", { name: "Back to Mail" })).toHaveAttribute("href", "/mail");
    if (title === "Calendar") await shot(page, "3-coming-soon");
  });
}

test("on a phone, folders are in a drawer and sections along the bottom", async ({ page }) => {
  await openWebmail(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole("button", { name: "Open folders" })).toBeVisible({ timeout: 60_000 });
  await expect(page.getByRole("navigation", { name: "Workspace sections" }).last().getByRole("link", { name: "Mail" })).toBeVisible();
  await page.getByRole("button", { name: "Open folders" }).click();
  await expect(page.getByRole("dialog", { name: "Folders" }).getByRole("button", { name: /Inbox\s*8/ })).toBeVisible();
  await shot(page, "4-phone-drawer");
});
