import { test, expect, type Page } from "@playwright/test";

/**
 * The Admin security-alerts screen.
 *
 * The last Admin page with no browser coverage, and the newest — the module
 * behind it was deleted by the PR #35 merge and recovered from git objects,
 * so nothing here had ever been driven end to end.
 *
 * Asserted on what leaves the browser rather than what is drawn. The two
 * failures worth catching are both invisible on screen: a decision that
 * renders as taken but never reaches the server, and a review sent without
 * the note the operator typed — which is the part a later reader depends on
 * to know why an alert was dismissed.
 */

const API = "**/api/v1";

const ADMIN_CAPABILITIES = [
  "people.read",
  "workspace.settings.read",
  "audit.read",
  "security-alert.read",
  "security-alert.review",
];

const json = (data: unknown) => ({
  status: 200,
  contentType: "application/json",
  body: JSON.stringify({ success: true, data }),
});

interface Reviewed {
  id: string;
  action: string;
  note?: string;
}

function alert(over: Partial<Record<string, unknown>> = {}) {
  return {
    id: "a1",
    type: "NEW_DEVICE_LOGIN",
    severity: "MEDIUM",
    status: "OPEN",
    title: "Sign-in from a new device",
    message: "This account signed in from a device it has not used before in this workspace.",
    actorEmail: "devon@acme.test",
    ipAddress: "203.0.113.7",
    userAgent: "Mozilla/5.0",
    deviceLabel: "iOS · Safari",
    resolutionNote: null,
    resolvedAt: null,
    createdAt: new Date().toISOString(),
    actor: { id: "u2", email: "devon@acme.test", displayName: "Devon" },
    resolvedBy: null,
    ...over,
  };
}

async function openAlerts(
  page: Page,
  opts: { alerts?: unknown[]; capabilities?: string[] } = {}
): Promise<Reviewed[]> {
  const reviewed: Reviewed[] = [];
  const alerts = opts.alerts ?? [alert()];

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
    route.fulfill(
      json({ capabilities: opts.capabilities ?? ADMIN_CAPABILITIES, decisions: [] })
    )
  );

  await page.route(`${API}/security-alerts`, (route) =>
    route.fulfill(
      json({
        counts: { OPEN: alerts.length },
        openCount: alerts.length,
        alerts,
      })
    )
  );

  await page.route(`${API}/security-alerts/*/review`, (route) => {
    const request = route.request();
    const body = (request.postDataJSON?.() ?? {}) as { action: string; note?: string };
    const id = request.url().split("/security-alerts/")[1]?.split("/")[0] ?? "";
    reviewed.push({ id, action: body.action, note: body.note });
    return route.fulfill(json({ id, status: "RESOLVED" }));
  });

  await page.goto("/login");
  await page.getByPlaceholder("john@example.com").fill("admin@zoiko.test");
  await page.getByPlaceholder("Enter your password").fill("Password123!");
  await page.getByRole("button", { name: "Sign In", exact: true }).click();
  await expect(page).toHaveURL(/\/admin$/, { timeout: 60_000 });

  await page.goto("/admin/security-alerts");
  return reviewed;
}

test.describe("the alert inbox", () => {
  test("shows what the alert is and what it was about", async ({ page }) => {
    test.setTimeout(120_000);
    await openAlerts(page);

    await expect(page.getByText("Sign-in from a new device")).toBeVisible({ timeout: 60_000 });

    // The three fields an operator triages on. An alert that says only
    // "something happened" is one nobody can act on, and the device and
    // address are what the account holder is asked to recognise.
    await expect(page.getByText("devon@acme.test").first()).toBeVisible();
    await expect(page.getByText("203.0.113.7").first()).toBeVisible();
    await expect(page.getByText(/iOS/).first()).toBeVisible();
  });

  test("separates open alerts from ones already decided", async ({ page }) => {
    test.setTimeout(120_000);
    await openAlerts(page, {
      alerts: [
        alert({ id: "a1" }),
        alert({
          id: "a2",
          status: "RESOLVED",
          title: "Refresh token replayed",
          type: "REFRESH_TOKEN_REUSE",
          severity: "CRITICAL",
          resolutionNote: "Rotated the credential and told the customer.",
          resolvedAt: new Date().toISOString(),
          resolvedBy: { id: "u1", email: "admin@zoiko.test", displayName: "Admin" },
        }),
      ],
    });

    await expect(page.getByText("Sign-in from a new device")).toBeVisible({ timeout: 60_000 });

    // An inbox that shows resolved rows beside open ones stops being a queue
    // within a week — the filter is the feature. A decided alert also shows
    // the note and who left it, which is what a later reader needs.
    await expect(page.getByText("Refresh token replayed")).toBeVisible();
    await expect(page.getByText(/Rotated the credential/)).toBeVisible();

    // Only the open one offers a decision.
    await expect(page.getByRole("button", { name: /^Resolve$/ })).toHaveCount(1);
  });
});

test.describe("deciding on an alert", () => {
  test("sends the decision to the server", async ({ page }) => {
    test.setTimeout(120_000);
    const reviewed = await openAlerts(page);

    await expect(page.getByText("Sign-in from a new device")).toBeVisible({ timeout: 60_000 });
    await page.getByRole("button", { name: /^Resolve$/i }).first().click();

    await expect.poll(() => reviewed.length).toBeGreaterThan(0);
    expect(reviewed[0]?.id).toBe("a1");
    expect(reviewed[0]?.action).toBe("RESOLVE");
  });

  test("carries the note the operator typed", async ({ page }) => {
    test.setTimeout(120_000);
    const reviewed = await openAlerts(page);

    await expect(page.getByText("Sign-in from a new device")).toBeVisible({ timeout: 60_000 });

    // The note is the whole value of a dismissal. Without it the log records
    // that somebody decided, and nothing about why — which is useless to
    // whoever reads it during the next incident.
    await page
      .getByPlaceholder(/Optional note/i)
      .first()
      .fill("Confirmed with Devon — new work phone.");
    await page.getByRole("button", { name: /^Dismiss$/i }).first().click();

    await expect.poll(() => reviewed.length).toBeGreaterThan(0);
    expect(reviewed[0]?.action).toBe("DISMISS");
    expect(reviewed[0]?.note).toContain("new work phone");
  });

  test("offers no decision to an account that may only read", async ({ page }) => {
    test.setTimeout(120_000);
    await openAlerts(page, {
      // security-alert.read without security-alert.review. The matrix names
      // the two separately because dismissing a security signal is a
      // decision and ought to be attributable to whoever made it.
      capabilities: ["people.read", "workspace.settings.read", "security-alert.read"],
    });

    await expect(page.getByText("Sign-in from a new device")).toBeVisible({ timeout: 60_000 });
    await expect(page.getByRole("button", { name: /^Resolve$/i })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /^Dismiss$/i })).toHaveCount(0);
  });
});
