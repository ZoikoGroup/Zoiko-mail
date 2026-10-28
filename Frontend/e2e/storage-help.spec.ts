import { test, expect, type Page } from "@playwright/test";
import { json } from "./admin-harness";
import { openWebmail } from "./webmail-harness";

/**
 * The Storage page (opened from the storage meter) and the Help centre
 * (opened from the help button), driven by API responses shaped like the
 * server's.
 */

const GIB = 1024 ** 3;
const MIB = 1024 ** 2;

const STORAGE = {
  address: "michael@acme.test",
  usedBytes: 4.2 * GIB,
  limitBytes: 5 * GIB,
  freeBytes: 0.8 * GIB,
  full: false,
  itemisedBytes: 4.2 * GIB,
  folders: [
    { folder: "INBOX", messages: 320, bytes: 2.5 * GIB },
    { folder: "SENT", messages: 80, bytes: 1.1 * GIB },
    { folder: "TRASH", messages: 12, bytes: 600 * MIB },
  ],
  attachments: { files: 41, bytes: 3 * GIB },
  largest: [
    { id: "m1", subject: "Brand video final cut", folder: "INBOX", from: "sarah.mitchell@example.com", date: "2026-10-20T09:00:00.000Z", bytes: 48 * MIB, attachments: 2 },
    { id: "m9", subject: "Old export", folder: "TRASH", from: "system@acme.test", date: "2026-09-01T09:00:00.000Z", bytes: 12 * MIB, attachments: 1 },
  ],
};

interface Ticket {
  id: string; ticketNumber: number; tenantId: string; tenantName: string; subject: string; description: string;
  category: string; severity: string; status: string; openedBy: null; openedByType: string; assignedStaff: null;
  slaDueAt: null; slaTarget?: string; slaOverdue: boolean; resolvedAt: null; closedAt: null; createdAt: string; updatedAt: string;
  comments: Array<{ id: string; authorType: string; internal: boolean; body: string; createdAt: string; updatedAt: string; author: null }>;
}

const ticket = (over: Partial<Ticket>): Ticket => ({
  id: "t1", ticketNumber: 1042, tenantId: "t1", tenantName: "Acme Workspace", subject: "Mail to a customer bounced",
  description: "It bounced at 10:15 yesterday.", category: "DELIVERY", severity: "MEDIUM", status: "IN_PROGRESS", openedBy: null,
  openedByType: "TENANT", assignedStaff: null, slaDueAt: null, slaOverdue: false, resolvedAt: null, closedAt: null,
  createdAt: "2026-10-26T10:00:00.000Z", updatedAt: "2026-10-26T10:00:00.000Z",
  comments: [
    { id: "c1", authorType: "STAFF", internal: false, body: "We are looking at the delivery log.", createdAt: "2026-10-26T11:00:00.000Z", updatedAt: "2026-10-26T11:00:00.000Z", author: null },
    { id: "c2", authorType: "STAFF", internal: true, body: "INTERNAL NOTE never shown", createdAt: "2026-10-26T11:05:00.000Z", updatedAt: "2026-10-26T11:05:00.000Z", author: null },
  ],
  ...over,
});

async function stub(page: Page) {
  const writes: Array<{ method: string; path: string; body: unknown }> = [];
  const tickets = [ticket({})];
  await page.route(
    (url) => url.pathname === "/api/v1/mail/storage" || url.pathname === "/api/v1/mail/storage/recalculate" || url.pathname.startsWith("/api/v1/support/tickets") || url.pathname === "/api/v1/mail/trash",
    async (route) => {
      const req = route.request();
      const path = new URL(req.url()).pathname.replace("/api/v1", "");
      if (req.method() !== "GET") writes.push({ method: req.method(), path, body: req.postDataJSON?.() ?? null });
      if (path === "/mail/storage") return route.fulfill(json(STORAGE));
      if (path === "/mail/storage/recalculate") return route.fulfill(json({ ...STORAGE, usedBytes: 3.9 * GIB, itemisedBytes: 3.9 * GIB, freeBytes: 1.1 * GIB }));
      if (path === "/mail/trash") return route.fulfill(json({ deletedCount: 12 }));
      if (path === "/support/tickets" && req.method() === "POST") {
        const body = req.postDataJSON() as Partial<Ticket>;
        const created = ticket({ id: "t2", ticketNumber: 1043, subject: String(body.subject), description: String(body.description), status: "OPEN", comments: [], slaTarget: "4 business hours" });
        tickets.unshift(created);
        return route.fulfill(json(created));
      }
      if (path === "/support/tickets") return route.fulfill(json({ tickets, ticketCounts: {} }));
      const detail = tickets.find((t) => path === `/support/tickets/${t.id}`);
      if (detail) return route.fulfill(json(detail));
      if (path.endsWith("/comments") && req.method() === "POST") {
        return route.fulfill(json({ id: "c9", authorType: "TENANT", internal: false, body: (req.postDataJSON() as { body: string }).body, createdAt: "2026-10-27T09:00:00.000Z", updatedAt: "2026-10-27T09:00:00.000Z", author: null }));
      }
      return route.fulfill(json({}));
    },
  );
  return writes;
}

test("the storage meter opens the Storage page, which itemises the mailbox", async ({ page }) => {
  await openWebmail(page);
  await stub(page);
  await page.getByTestId("storage-meter").click();
  await expect(page).toHaveURL(/\/mail\/storage$/, { timeout: 60_000 });

  const root = page.getByTestId("storage-page");
  await expect(root.getByTestId("storage-used")).toContainText("4.2 GB", { timeout: 60_000 });
  await expect(root.getByTestId("storage-used")).toContainText("of 5.0 GB used");
  await expect(root.getByRole("progressbar", { name: "Mailbox storage used" })).toHaveAttribute("aria-valuenow", "84");
  await expect(root.getByText("You’re nearly out of space")).toBeVisible();
  await expect(root.getByTestId("storage-folder")).toHaveCount(3);
  await expect(root.getByTestId("storage-folder").first()).toContainText("Inbox");
  await expect(root.getByText("41 files")).toBeVisible();
  await expect(root.getByTestId("largest-messages")).toContainText("Brand video final cut");
  await expect(root.getByRole("link", { name: /Brand video final cut/ })).toHaveAttribute("href", "/mail?message=m1&folder=INBOX");
  await expect(root.getByTestId("storage-drift")).toHaveCount(0);
});

test("Recalculate corrects the total and Empty Trash asks first", async ({ page }) => {
  await openWebmail(page);
  const writes = await stub(page);
  await page.getByTestId("storage-meter").click();
  const root = page.getByTestId("storage-page");
  await expect(root.getByTestId("storage-used")).toContainText("4.2 GB", { timeout: 60_000 });

  await root.getByRole("button", { name: "Recalculate" }).click();
  await expect(root.getByTestId("storage-used")).toContainText("3.9 GB");
  expect(writes.some((w) => w.method === "POST" && w.path === "/mail/storage/recalculate")).toBe(true);

  await root.getByRole("button", { name: "Empty Trash" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("12 messages");
  await expect(dialog).toContainText("600 MB");
  expect(writes.some((w) => w.path === "/mail/trash")).toBe(false);
  await dialog.getByRole("button", { name: "Empty trash" }).click();
  await expect.poll(() => writes.some((w) => w.method === "DELETE" && w.path === "/mail/trash")).toBe(true);
});

test("a full mailbox says so", async ({ page }) => {
  await openWebmail(page);
  await stub(page);
  await page.route((url) => url.pathname === "/api/v1/mail/storage", (route) =>
    route.fulfill(json({ ...STORAGE, usedBytes: 5 * GIB, freeBytes: 0, full: true })),
  );
  await page.getByTestId("storage-meter").click();
  await expect(page.getByTestId("storage-page").getByText("Your mailbox is full")).toBeVisible({ timeout: 60_000 });
});

test("the Help centre searches its guides", async ({ page }) => {
  await openWebmail(page);
  await stub(page);
  await page.getByRole("navigation", { name: "Workspace sections" }).first().getByRole("link", { name: "Help and support" }).click();
  const root = page.getByTestId("help-centre");
  await expect(root.getByRole("heading", { name: "Help centre" })).toBeVisible({ timeout: 60_000 });
  const total = await root.getByTestId("help-articles").getByRole("listitem").count();
  expect(total).toBeGreaterThan(10);

  await root.getByRole("searchbox", { name: "Search the guides" }).fill("snooze");
  await expect(root.getByRole("button", { name: /Scheduling a send and snoozing mail/ })).toBeVisible();
  await expect(root.getByTestId("help-articles").getByRole("listitem")).toHaveCount(1);
  await root.getByRole("button", { name: /Scheduling a send and snoozing mail/ }).click();
  await expect(root.getByText("takes a message out of your Inbox")).toBeVisible();

  await root.getByRole("searchbox", { name: "Search the guides" }).fill("zzzzqq");
  await expect(root.getByTestId("help-empty")).toBeVisible();

  await root.getByRole("searchbox", { name: "Search the guides" }).fill("");
  await root.getByRole("button", { name: "Calendar", exact: true }).click();
  await expect(root.getByRole("button", { name: /Creating events and meetings/ })).toBeVisible();
  await expect(root.getByRole("button", { name: /Scheduling a send/ })).toHaveCount(0);
});

test("a member can send a request and follow up on an existing one", async ({ page }) => {
  await openWebmail(page);
  const writes = await stub(page);
  await page.getByRole("navigation", { name: "Workspace sections" }).first().getByRole("link", { name: "Help and support" }).click();
  const root = page.getByTestId("help-centre");
  await expect(root.getByTestId("my-requests")).toContainText("Mail to a customer bounced", { timeout: 60_000 });
  await expect(root.getByTestId("my-requests")).toContainText("In progress");

  // Too short to send.
  const send = root.getByRole("button", { name: "Send request" });
  await expect(send).toBeDisabled();
  await root.getByLabel("Subject").fill("Cannot reach sales@");
  await root.getByLabel("Details").fill("Nothing I send to sales@ arrives.");
  await root.getByLabel("What is it about?").selectOption("DELIVERY");
  await root.getByLabel("How urgent is it?").selectOption("HIGH");
  await send.click();
  await expect(root.getByTestId("request-sent")).toContainText("Request #1043 sent");
  await expect(root.getByTestId("request-sent")).toContainText("4 business hours");
  const created = writes.find((w) => w.method === "POST" && w.path === "/support/tickets");
  expect(created?.body).toMatchObject({ subject: "Cannot reach sales@", category: "DELIVERY", severity: "HIGH" });
  await expect(root.getByTestId("my-requests")).toContainText("#1043 · Cannot reach sales@");

  // Open the older one: support's reply shows, an internal note never does.
  await root.getByRole("button", { name: /#1042/ }).click();
  await expect(root.getByText("We are looking at the delivery log.")).toBeVisible();
  await expect(root.getByText("INTERNAL NOTE")).toHaveCount(0);
  await root.getByLabel("Reply").fill("It also happens to support@.");
  await root.getByRole("button", { name: "Reply", exact: true }).click();
  await expect.poll(() => writes.some((w) => w.path === "/support/tickets/t1/comments" && (w.body as { body: string }).body === "It also happens to support@.")).toBe(true);
});
