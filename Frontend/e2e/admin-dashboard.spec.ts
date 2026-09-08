import { test, expect, type Page } from "@playwright/test";

/**
 * What the admin dashboard tiles actually say.
 *
 * Three tiles used to display a quantity that was not the one on the label:
 * "Failed sends · last 24 hours" counted suspended mailboxes, the mailbox
 * meter divided by itself so it always read full, and the subtitle printed the
 * timezone under the word "region". None of that shows up in a type check or a
 * backend test — the API was answering correctly and the page was mislabelling
 * the answer — so it needs a browser.
 */

const API = "**/api/v1";

/** A full ADMIN capability set, so the rail renders and audit.read is held. */
const ADMIN_CAPABILITIES = [
  "mail.own.rw",
  "commitments.own.manage",
  "connector.own.connect",
  "people.read",
  "people.invite.member",
  "people.invite.admin",
  "people.member.manage",
  "people.admin.manage",
  "workspace.settings.read",
  "workspace.settings.write",
  "workspace.mailboxes.manage",
  "workspace.domains.manage",
  "workspace.groups.manage",
  "policy.write",
  "audit.read",
];

interface Mailbox {
  id: string;
  address: string;
  storageUsed: number;
  storageLimit: number;
  sendSuspendedAt: string | null;
  sendSuspensionReason: string | null;
}

interface DashboardStubs {
  /** null makes the summary endpoint answer 403, as it does for a non-operator. */
  failures: { windowHours: number; failed: number; byType: Record<string, number> } | null;
  mailboxes: Mailbox[];
  timezone: string;
}

function mailbox(id: string, suspended = false): Mailbox {
  return {
    id,
    address: `${id}@acme.test`,
    storageUsed: 1_000_000_000,
    storageLimit: 5_000_000_000,
    sendSuspendedAt: suspended ? new Date().toISOString() : null,
    sendSuspensionReason: suspended ? "Bounce rate" : null,
  };
}

const json = (data: unknown) => ({
  status: 200,
  contentType: "application/json",
  body: JSON.stringify({ success: true, data }),
});

/**
 * Signs in as an admin and stubs every read the dashboard makes.
 *
 * The catch-all is registered FIRST on purpose: Playwright consults routes in
 * reverse registration order, so the specific handlers below it win. Doing it
 * the other way round needs a hand-maintained fallback list, which is how a
 * missing capability stub once made every field read-only.
 */
async function openDashboard(page: Page, stubs: DashboardStubs) {
  await page.route(`${API}/**`, (route) => route.fulfill(json({ items: [], count: 0 })));

  const session = {
    accessToken: "stub-access-token",
    refreshToken: "stub-refresh-token",
    expiresIn: "12h",
    user: { id: "u1", email: "admin@zoiko.test", displayName: "Admin" },
    tenant: { id: "t1", name: "Acme Corp", planCode: "starter" },
    membership: { id: "m1", role: "ADMIN" },
    workspace: "ADMIN",
  };

  await page.route(`${API}/auth/login`, (route) =>
    route.fulfill(json({ state: "SIGNED_IN", session, ...session }))
  );
  await page.route(`${API}/auth/me`, (route) =>
    route.fulfill(
      json({
        ...session.user,
        tenant: session.tenant,
        membership: session.membership,
        workspace: "ADMIN",
      })
    )
  );
  await page.route(`${API}/users/me/capabilities`, (route) =>
    route.fulfill(json({ capabilities: ADMIN_CAPABILITIES, decisions: [] }))
  );

  await page.route(`${API}/tenants/current`, (route) =>
    route.fulfill(
      json({
        id: "t1",
        name: "Acme Corp",
        status: "ACTIVE",
        planCode: "starter",
        timezone: stubs.timezone,
        language: "en",
        allowedDomains: ["acme.test"],
      })
    )
  );
  await page.route(`${API}/membership/members`, (route) =>
    route.fulfill(
      json({
        members: [
          {
            id: "m1",
            role: "ADMIN",
            status: "ACTIVE",
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            user: { id: "u1", email: "admin@zoiko.test", displayName: "Admin" },
          },
          {
            id: "m2",
            role: "MEMBER",
            status: "ACTIVE",
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            user: { id: "u2", email: "member@zoiko.test", displayName: "Member" },
          },
        ],
      })
    )
  );
  await page.route(`${API}/mail/admin/mailboxes`, (route) =>
    route.fulfill(json({ mailboxes: stubs.mailboxes }))
  );
  await page.route(`${API}/domains`, (route) => route.fulfill(json({ domains: [] })));
  await page.route(/\/connectors\/admin/, (route) => route.fulfill(json({ accounts: [] })));
  await page.route(/\/audit\/events/, (route) => route.fulfill(json({ events: [] })));

  // Registered last, so it is consulted before the /mail/** shapes above.
  await page.route(/\/mail\/admin\/delivery-events\/summary/, (route) => {
    if (!stubs.failures) {
      return route.fulfill({
        status: 403,
        contentType: "application/json",
        body: JSON.stringify({
          success: false,
          error: { code: "FORBIDDEN", message: "Operator role required" },
        }),
      });
    }
    return route.fulfill(json(stubs.failures));
  });

  await page.goto("/login");
  await page.getByPlaceholder("john@example.com").fill("admin@zoiko.test");
  await page.getByPlaceholder("Enter your password").fill("Password123!");
  await page.getByRole("button", { name: "Sign In", exact: true }).click();
  await expect(page).toHaveURL(/\/admin$/, { timeout: 60_000 });
}

/** The tile with the given label, as a container its value can be read from. */
function tile(page: Page, label: string) {
  return page.locator(".zoiko-stat").filter({ hasText: label });
}

test.describe("admin dashboard tiles", () => {
  const base: DashboardStubs = {
    failures: { windowHours: 24, failed: 0, byType: {} },
    mailboxes: [mailbox("ops"), mailbox("sales")],
    timezone: "Europe/London",
  };

  test("failed sends shows the server's count and names the failure types", async ({
    page,
  }) => {
    await openDashboard(page, {
      ...base,
      failures: {
        windowHours: 24,
        failed: 6,
        byType: { FAILED: 1, BOUNCED: 3, REJECTED: 2, BLOCKED: 0, PROVIDER_ERROR: 0 },
      },
    });

    const failed = tile(page, "Failed sends");
    await expect(failed).toContainText("6", { timeout: 60_000 });
    // Ordered by count, and the zero-count types are not listed.
    await expect(failed).toContainText("3 bounced");
    await expect(failed).toContainText("2 rejected");
    await expect(failed).not.toContainText("blocked");
  });

  test("failed sends reads em-dash, not zero, when the count is unavailable", async ({
    page,
  }) => {
    // A 403 and "no failures" are different facts. Showing 0 for a refused
    // read is the reassuring answer rather than the true one.
    await openDashboard(page, { ...base, failures: null });

    const failed = tile(page, "Failed sends");
    await expect(failed).toContainText("—", { timeout: 60_000 });
    await expect(failed).toContainText("unavailable");
  });

  test("a clean window says so without claiming a failure", async ({ page }) => {
    await openDashboard(page, base);

    const failed = tile(page, "Failed sends");
    await expect(failed).toContainText("0", { timeout: 60_000 });
    await expect(failed).toContainText("last 24 hours");
  });

  test("the rest of the dashboard survives a refused failure count", async ({ page }) => {
    // The summary read is excluded from the blocking set on purpose: one tile
    // the caller cannot see must not blank the five they can.
    await openDashboard(page, { ...base, failures: null });

    await expect(tile(page, "Users")).toContainText("2", { timeout: 60_000 });
    await expect(tile(page, "Mailboxes")).toContainText("2");
    await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
  });

  test("the mailbox tile has no meter and reports suspensions", async ({ page }) => {
    await openDashboard(page, {
      ...base,
      mailboxes: [mailbox("ops"), mailbox("sales", true), mailbox("billing", true)],
    });

    const mailboxes = tile(page, "Mailboxes");
    await expect(mailboxes).toContainText("3", { timeout: 60_000 });
    await expect(mailboxes).toContainText("2 suspended");
    // The old tile divided the mailbox count by itself, so the bar was always
    // full — a progress meter that could never mean anything.
    await expect(mailboxes).not.toContainText("/3");
  });

  test("a workspace with nothing suspended says so", async ({ page }) => {
    await openDashboard(page, base);

    await expect(tile(page, "Mailboxes")).toContainText("none suspended", {
      timeout: 60_000,
    });
  });

  test("the subtitle names the timezone rather than calling it a region", async ({
    page,
  }) => {
    await openDashboard(page, { ...base, timezone: "Asia/Kolkata" });

    const header = page.locator("header, div").filter({ hasText: "Acme Corp" }).first();
    await expect(header).toContainText("Asia/Kolkata", { timeout: 60_000 });
    await expect(page.getByText(/region/i)).toHaveCount(0);
  });

  test("view log reaches the audit screen", async ({ page }) => {
    await openDashboard(page, base);

    const viewLog = page.getByRole("link", { name: "View log" });
    await expect(viewLog).toBeVisible({ timeout: 60_000 });
    await viewLog.click();

    await expect(page).toHaveURL(/\/admin\/audit$/, { timeout: 60_000 });
  });

  test("the page does not claim an aggregate endpoint that does not exist", async ({
    page,
  }) => {
    await openDashboard(page, base);

    // The note used to read "Mirrors GET /admin/dashboard". No such route is
    // served, so anyone who went looking for it found nothing.
    await expect(page.getByText("/admin/dashboard")).toHaveCount(0);
  });
});
