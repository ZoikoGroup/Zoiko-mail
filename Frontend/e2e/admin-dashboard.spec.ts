import { test, expect, type Page } from "@playwright/test";

/**
 * What the admin dashboard tiles actually say.
 *
 * Several tiles used to display a quantity that was not the one on the label:
 * "Failed sends · last 24 hours" counted suspended mailboxes, the mailbox
 * meter divided by itself so it always read full, the subtitle printed the
 * timezone under the word "region", and the MFA tile showed 0/n in warning
 * amber for a feature that does not exist. None of that shows up in a type
 * check or a backend test — the API answered correctly and the page
 * mislabelled the answer — so it needs a browser.
 *
 * The page now reads one aggregate, GET /admin/dashboard, and falls back to
 * composing from the individual endpoints when that route is absent. Both
 * paths are exercised here.
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

interface Aggregate {
  tenant: { name: string; planCode: string; timezone: string; status: string };
  counts: {
    people: number;
    pendingInvitations: number;
    mailboxes: number;
    suspendedMailboxes: number;
    connectedAccounts: number;
    connectedGmail: number;
    connectedMicrosoft: number;
    domainsVerified: number;
    domainsTotal: number;
    storageUsedGb: number;
    storageLimitGb: number;
  };
  mfa: { supported: boolean; covered: number; total: number };
  deliveryFailures:
    | { windowHours: number; failed: number; byType: Record<string, number> }
    | null;
  recentAudit: unknown[];
  providerSync: unknown[];
  degraded: string[];
  auditWithheld: boolean;
}

function aggregate(overrides: Partial<Aggregate> = {}): Aggregate {
  return {
    tenant: {
      name: "Acme Corp",
      planCode: "starter",
      timezone: "Europe/London",
      status: "ACTIVE",
    },
    counts: {
      people: 2,
      pendingInvitations: 0,
      mailboxes: 2,
      suspendedMailboxes: 0,
      connectedAccounts: 0,
      connectedGmail: 0,
      connectedMicrosoft: 0,
      domainsVerified: 0,
      domainsTotal: 0,
      storageUsedGb: 1,
      storageLimitGb: 10,
    },
    mfa: { supported: false, covered: 0, total: 2 },
    deliveryFailures: { windowHours: 24, failed: 0, byType: {} },
    recentAudit: [],
    providerSync: [],
    degraded: [],
    auditWithheld: false,
    ...overrides,
  };
}

const json = (data: unknown) => ({
  status: 200,
  contentType: "application/json",
  body: JSON.stringify({ success: true, data }),
});

/**
 * Signs in as an admin. `dashboard` is what GET /admin/dashboard answers —
 * pass a number to answer with that status instead of a body.
 *
 * The catch-all is registered FIRST on purpose: Playwright consults routes in
 * reverse registration order, so the specific handlers below it win. Doing it
 * the other way round needs a hand-maintained fallback list, which is how a
 * missing capability stub once made every field read-only.
 */
async function openDashboard(
  page: Page,
  dashboard: Aggregate | number,
  fanout?: { members?: number; mailboxes?: number; timezone?: string }
) {
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

  // The reads the fallback path uses. Present regardless, so a 404 on the
  // aggregate has somewhere to fall back to.
  await page.route(`${API}/tenants/current`, (route) =>
    route.fulfill(
      json({
        id: "t1",
        name: "Acme Corp",
        status: "ACTIVE",
        planCode: "starter",
        timezone: fanout?.timezone ?? "Europe/London",
        allowedDomains: ["acme.test"],
      })
    )
  );
  await page.route(`${API}/membership/members`, (route) =>
    route.fulfill(
      json({
        members: Array.from({ length: fanout?.members ?? 2 }, (_, i) => ({
          id: `m${i + 1}`,
          role: i === 0 ? "ADMIN" : "MEMBER",
          status: "ACTIVE",
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          user: {
            id: `u${i + 1}`,
            email: `person${i + 1}@zoiko.test`,
            displayName: `Person ${i + 1}`,
          },
        })),
      })
    )
  );
  await page.route(`${API}/mail/admin/mailboxes`, (route) =>
    route.fulfill(
      json({
        mailboxes: Array.from({ length: fanout?.mailboxes ?? 2 }, (_, i) => ({
          id: `mbx${i}`,
          address: `box${i}@acme.test`,
          storageUsed: 1_000_000_000,
          storageLimit: 5_000_000_000,
          sendSuspendedAt: null,
          sendSuspensionReason: null,
        })),
      })
    )
  );
  await page.route(`${API}/domains`, (route) => route.fulfill(json({ domains: [] })));
  await page.route(/\/connectors\/admin/, (route) => route.fulfill(json({ accounts: [] })));
  await page.route(/\/audit\/events/, (route) => route.fulfill(json({ events: [] })));
  await page.route(/\/mail\/admin\/delivery-events\/summary/, (route) =>
    route.fulfill(json({ windowHours: 24, failed: 0, byType: {} }))
  );

  // Registered last, so it wins over the /admin/** and catch-all shapes.
  await page.route(/\/admin\/dashboard/, (route) => {
    if (typeof dashboard === "number") {
      return route.fulfill({
        status: dashboard,
        contentType: "application/json",
        body: JSON.stringify({
          success: false,
          error: { code: "NOT_FOUND", message: "Route not found" },
        }),
      });
    }
    return route.fulfill(json(dashboard));
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
  test("failed sends shows the server's count and names the failure types", async ({
    page,
  }) => {
    await openDashboard(
      page,
      aggregate({
        deliveryFailures: {
          windowHours: 24,
          failed: 6,
          byType: { FAILED: 1, BOUNCED: 3, REJECTED: 2, BLOCKED: 0, PROVIDER_ERROR: 0 },
        },
      })
    );

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
    // A refused or failed read and "no failures" are different facts. Showing
    // 0 for a missing count is the reassuring answer rather than the true one.
    await openDashboard(page, aggregate({ deliveryFailures: null }));

    const failed = tile(page, "Failed sends");
    await expect(failed).toContainText("—", { timeout: 60_000 });
    await expect(failed).toContainText("unavailable");
  });

  test("a clean window says so without claiming a failure", async ({ page }) => {
    await openDashboard(page, aggregate());

    const failed = tile(page, "Failed sends");
    await expect(failed).toContainText("0", { timeout: 60_000 });
    await expect(failed).toContainText("last 24 hours");
  });

  test("the mailbox tile has no meter and reports suspensions", async ({ page }) => {
    await openDashboard(
      page,
      aggregate({
        counts: { ...aggregate().counts, mailboxes: 3, suspendedMailboxes: 2 },
      })
    );

    const mailboxes = tile(page, "Mailboxes");
    await expect(mailboxes).toContainText("3", { timeout: 60_000 });
    await expect(mailboxes).toContainText("2 suspended");
    // The old tile divided the mailbox count by itself, so the bar was always
    // full — a progress meter that could never mean anything.
    await expect(mailboxes).not.toContainText("/3");
  });

  test("a workspace with nothing suspended says so", async ({ page }) => {
    await openDashboard(page, aggregate());

    await expect(tile(page, "Mailboxes")).toContainText("none suspended", {
      timeout: 60_000,
    });
  });

  test("the subtitle names the timezone rather than calling it a region", async ({
    page,
  }) => {
    await openDashboard(
      page,
      aggregate({
        tenant: { ...aggregate().tenant, timezone: "Asia/Kolkata" },
      })
    );

    const header = page.locator("header, div").filter({ hasText: "Acme Corp" }).first();
    await expect(header).toContainText("Asia/Kolkata", { timeout: 60_000 });
    await expect(page.getByText(/region/i)).toHaveCount(0);
  });

  test("view log reaches the audit screen", async ({ page }) => {
    await openDashboard(page, aggregate());

    const viewLog = page.getByRole("link", { name: "View log" });
    await expect(viewLog).toBeVisible({ timeout: 60_000 });
    await viewLog.click();

    await expect(page).toHaveURL(/\/admin\/audit$/, { timeout: 60_000 });
  });
});

test.describe("MFA is reported as unavailable, not as a coverage failure", () => {
  test("says not available instead of firing a warning nobody can act on", async ({
    page,
  }) => {
    await openDashboard(page, aggregate({ mfa: { supported: false, covered: 0, total: 9 } }));

    const mfa = tile(page, "MFA coverage");
    await expect(mfa).toContainText("—", { timeout: 60_000 });
    await expect(mfa).toContainText("not available yet");
    // The banner used to fire on every load of every workspace. An alarm with
    // no action behind it teaches people to ignore the banner region.
    await expect(page.getByText(/no second factor/i)).toHaveCount(0);
  });

  test("warns once MFA exists and someone has not enrolled", async ({ page }) => {
    await openDashboard(page, aggregate({ mfa: { supported: true, covered: 7, total: 9 } }));

    const mfa = tile(page, "MFA coverage");
    await expect(mfa).toContainText("7", { timeout: 60_000 });
    await expect(mfa).toContainText("/9");
    await expect(page.getByText(/2 people have/i)).toBeVisible();
  });

  test("stays quiet when everyone has enrolled", async ({ page }) => {
    await openDashboard(page, aggregate({ mfa: { supported: true, covered: 4, total: 4 } }));

    await expect(tile(page, "MFA coverage")).toContainText("4", { timeout: 60_000 });
    await expect(page.getByText(/no second factor/i)).toHaveCount(0);
  });
});

test.describe("a section the server could not read", () => {
  test("is named, and does not pass its zero off as good news", async ({ page }) => {
    await openDashboard(
      page,
      aggregate({
        degraded: ["domains"],
        counts: { ...aggregate().counts, domainsTotal: 0, domainsVerified: 0 },
      })
    );

    await expect(page.getByText(/One section could not be read/i)).toBeVisible({
      timeout: 60_000,
    });
    await expect(page.getByText(/domains/).first()).toBeVisible();
    // And the rest of the page is still there — the whole point of resolving
    // sections separately rather than as one all-or-nothing response.
    await expect(tile(page, "Users")).toContainText("2");
    await expect(tile(page, "Mailboxes")).toContainText("2");
  });

  test("says nothing when every section was read", async ({ page }) => {
    await openDashboard(page, aggregate());

    await expect(tile(page, "Users")).toContainText("2", { timeout: 60_000 });
    await expect(page.getByText(/could not be read/i)).toHaveCount(0);
  });
});

test.describe("falling back when the aggregate is not there", () => {
  test("composes the dashboard from the individual reads on a 404", async ({ page }) => {
    // A client can be newer than the API it is talking to. The page must still
    // work rather than showing an error for a route that has not shipped yet.
    await openDashboard(page, 404, { members: 3, mailboxes: 4, timezone: "Asia/Kolkata" });

    await expect(tile(page, "Users")).toContainText("3", { timeout: 60_000 });
    await expect(tile(page, "Mailboxes")).toContainText("4");
    const header = page.locator("header, div").filter({ hasText: "Acme Corp" }).first();
    await expect(header).toContainText("Asia/Kolkata");
    // The fallback knows no more about MFA than the aggregate did.
    await expect(tile(page, "MFA coverage")).toContainText("not available yet");
  });

  test("does not fall back on a refusal", async ({ page }) => {
    // A 403 must not be retried as seven calls: that either fails seven times
    // or, worse, succeeds at some and renders data the caller was refused.
    await openDashboard(page, 403);

    await expect(page.getByText(/Route not found|forbidden|refused/i).first()).toBeVisible(
      { timeout: 60_000 }
    );
    await expect(tile(page, "Users")).toHaveCount(0);
  });
});
