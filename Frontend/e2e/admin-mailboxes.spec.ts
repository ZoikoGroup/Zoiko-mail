import { test, expect, type Page } from "@playwright/test";
import { API, ADMIN_CAPABILITIES, json, record, signInAsAdmin, type Sent } from "./admin-harness";

/**
 * Delegating one person's mailbox to another — RBAC §2, §3, §9.1.
 *
 * `mailbox.delegate` lived in the vocabulary and in two role rows with nothing
 * reading it. The nearest working thing was the shared-mailbox assignee flow,
 * which filters to SHARED/DISTRIBUTION and so refuses a personal mailbox
 * before it reads the body — it could never express "let Dana cover Sam's
 * inbox while Sam is away".
 *
 * The failure worth catching here is not a missing dialog, it is a grant the
 * screen reports and never sends, and a refusal the screen flattens. "This
 * workspace has not enabled delegation for administrators" is not "you may
 * not" — it sends an Admin to ask for a permission they already hold.
 */

const mailboxes = [
  {
    id: "mb-sam",
    membershipId: "m-sam",
    address: "sam@acme.test",
    type: "USER",
    storageUsed: 1_000_000_000,
    storageLimit: 10_000_000_000,
    sendSuspendedAt: null,
    sendSuspensionReason: null,
    aiEnabled: true,
  },
  {
    id: "mb-team",
    membershipId: null,
    address: "team@acme.test",
    type: "SHARED",
    storageUsed: 0,
    storageLimit: 10_000_000_000,
    sendSuspendedAt: null,
    sendSuspensionReason: null,
    aiEnabled: true,
  },
];

const members = [
  { id: "m-sam", role: "MEMBER", status: "ACTIVE", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), user: { id: "u-sam", email: "sam@acme.test", displayName: "Sam" } },
  { id: "m-dana", role: "MEMBER", status: "ACTIVE", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), user: { id: "u-dana", email: "dana@acme.test", displayName: "Dana" } },
];

async function openMailboxes(
  page: Page,
  opts: { capabilities?: string[]; delegateRefusal?: { reason: string; message: string } } = {}
): Promise<Sent[]> {
  const sent: Sent[] = [];
  await signInAsAdmin(page, { capabilities: opts.capabilities });

  await page.route(`${API}/mail/admin/mailboxes`, (route) =>
    route.fulfill(json({ mailboxes }))
  );
  await page.route(`${API}/membership/members*`, (route) =>
    route.fulfill(json({ members, nextCursor: null }))
  );
  await page.route(`${API}/mail/admin/mailboxes/*/delegates`, (route) => {
    if (route.request().method() === "GET") {
      return route.fulfill(json({ delegates: [] }));
    }
    if (opts.delegateRefusal) {
      const request = route.request();
      sent.push({
        method: request.method(),
        url: request.url(),
        body: (request.postDataJSON?.() as Record<string, unknown>) ?? null,
      });
      return route.fulfill({
        status: 403,
        contentType: "application/json",
        body: JSON.stringify({
          success: false,
          error: {
            code: "FORBIDDEN",
            message: opts.delegateRefusal.message,
            details: { reason: opts.delegateRefusal.reason },
          },
        }),
      });
    }
    return record(sent, route, { id: "acc-1", membershipId: "m-dana", canRead: true });
  });

  await page.goto("/admin/mailboxes");
  // By level, not just by name: the page title and a card title are both
  // exactly "Mailboxes", and name matching is substring by default so the
  // count heading ("1 mailboxes") collides too.
  await expect(page.getByRole("heading", { level: 1, name: "Mailboxes" })).toBeVisible();
  return sent;
}

test.describe("admin mailbox delegation", () => {
  test("offers Delegate on a personal mailbox and not on a shared one", async ({ page }) => {
    await openMailboxes(page);
    // A shared mailbox already has assignees, and the server refuses a
    // delegation against it — so offering the control there would be a
    // button whose only outcome is an error.
    await expect(page.getByRole("button", { name: "Delegate" })).toHaveCount(1);
  });

  test("sends the grant, with send left off unless asked for", async ({ page }) => {
    const sent = await openMailboxes(page);

    await page.getByRole("button", { name: "Delegate" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toContainText("sam@acme.test");

    await dialog.getByLabel("Give access to").selectOption({ label: "Dana — dana@acme.test" });
    await dialog.getByRole("button", { name: "Grant access" }).click();
    await page.waitForTimeout(500);

    const grant = sent.find((s) => s.method === "POST");
    expect(grant, "Grant access must reach /delegates").toBeTruthy();
    expect(grant!.body?.membershipId).toBe("m-dana");
    // Widening is typed out, not inherited: read is the point of delegating,
    // send is a second decision.
    expect(grant!.body?.canSend).toBe(false);
  });

  test("carries send through when the operator ticks it", async ({ page }) => {
    const sent = await openMailboxes(page);

    await page.getByRole("button", { name: "Delegate" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Give access to").selectOption({ label: "Dana — dana@acme.test" });
    await dialog.getByRole("checkbox").check();
    await dialog.getByRole("button", { name: "Grant access" }).click();
    await page.waitForTimeout(500);

    const grant = sent.find((s) => s.method === "POST");
    expect(grant!.body?.canSend).toBe(true);
  });

  test("shows a policy refusal as a policy refusal, not as a flat denial", async ({ page }) => {
    await openMailboxes(page, {
      delegateRefusal: {
        reason: "NO_ACTIVE_POLICY",
        message:
          "This workspace has not enabled delegation for administrators. An Owner can delegate, or activate a DELEGATION policy.",
      },
    });

    await page.getByRole("button", { name: "Delegate" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Give access to").selectOption({ label: "Dana — dana@acme.test" });
    await dialog.getByRole("button", { name: "Grant access" }).click();

    // The distinction that matters: an Owner can fix this, and an Admin
    // reading "Forbidden" would go asking for a capability they already hold.
    await expect(dialog).toContainText(/has not enabled delegation/);
  });

  test("hides Delegate from an admin without the capability", async ({ page }) => {
    await openMailboxes(page, {
      capabilities: ADMIN_CAPABILITIES.filter((c) => c !== "mailbox.delegate"),
    });
    await expect(page.getByRole("button", { name: "Delegate" })).toHaveCount(0);
  });
});
