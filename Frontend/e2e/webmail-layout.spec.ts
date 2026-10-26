import { test, expect, type Page } from "@playwright/test";
import { openWebmail } from "./webmail-harness";

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
  // Drafts holds a total, not unread mail, so it carries no number.
  await expect(folders.getByRole("button", { name: "Drafts", exact: true })).toBeVisible();
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
  await expect(pane.getByRole("button", { name: "Create task" })).toBeEnabled();
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

// Calendar (app/mail/calendar), Contacts (app/mail/contacts), Tasks
// (app/mail/tasks) and the Work Graph (app/mail/work-graph) are built; they have
// their own specs. Only Alet is still a placeholder.
for (const [href, title] of [["/mail/alet", "Alet"]] as const) {
  test(`${title} shows Coming Soon inside the workspace`, async ({ page }) => {
    await openWebmail(page);
    await page.getByRole("navigation", { name: "Workspace sections" }).first().getByRole("link", { name: title, exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`${href}$`), { timeout: 60_000 });
    const soon = page.getByTestId("coming-soon");
    await expect(soon.getByRole("heading", { name: title })).toBeVisible({ timeout: 60_000 });
    await expect(soon.getByText("Coming Soon...")).toBeVisible();
    await expect(soon.getByRole("link", { name: "Back to Mail" })).toHaveAttribute("href", "/mail");
    if (title === "Alet") await shot(page, "3-coming-soon");
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
