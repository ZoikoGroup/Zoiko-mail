import { test, expect, type Page } from "@playwright/test";

/**
 * Withdrawing a support access request — Runbook §7.
 *
 * POST /support/access-requests/:id/withdraw is the requester changing their
 * mind: SUPPORT-only, and only for the seat's own PENDING request. A Support
 * seat cannot list access requests (that read is the approver's), so the
 * request it just sent, shown in the diagnostics request panel, is where the
 * action lives. Asserted through what leaves the browser — the POST and its
 * URL — and through the row's status changing on screen.
 */

const API = "**/api/v1";

const json = (data: unknown, status = 200) => ({
  status,
  contentType: "application/json",
  body: JSON.stringify(status < 400 ? { success: true, data } : { success: false, error: data }),
});

interface Sent {
  method: string;
  url: string;
}

async function signInAsSupport(page: Page): Promise<void> {
  const session = {
    accessToken: "stub-access-token",
    refreshToken: "stub-refresh-token",
    expiresIn: "12h",
    user: { id: "u1", email: "support@zoiko.test", displayName: "Test" },
    tenant: { id: "t1", name: "Acme Corp", planCode: "starter" },
    membership: { id: "m1", role: "SUPPORT" },
    workspace: "SUPPORT",
  };

  await page.route(`${API}/**`, (route) => route.fulfill(json({ items: [], count: 0 })));
  await page.route(`${API}/auth/login`, (route) =>
    route.fulfill(json({ state: "SIGNED_IN", session, ...session }))
  );
  await page.route(`${API}/auth/me`, (route) =>
    route.fulfill(
      json({ ...session.user, tenant: session.tenant, membership: session.membership, workspace: "SUPPORT" })
    )
  );
  await page.route(`${API}/users/me/capabilities`, (route) =>
    route.fulfill(json({ capabilities: ["support.console.read", "support.workspace.investigate"], decisions: [] }))
  );
  await page.route(`${API}/support/tickets*`, (route) =>
    route.fulfill(json({ tickets: [], ticketCounts: {} }))
  );
  // No live grant, so the Diagnostics tab draws the request panel.
  await page.route(`${API}/support/overview`, (route) =>
    route.fulfill(
      json({
        stats: {
          members: 1, mailboxes: 0, domains: 0, activeGrants: 0, openCommitments: 0, issues: 0,
          failedMessages24h: 0, failedDeliveries24h: 0, retryJobs: 0, failedJobs: 0, deliveryEvents24h: 0,
        },
        members: [],
        team: [],
        issues: [],
        audit: [],
        grants: [],
      })
    )
  );

  await page.goto("/login");
  await page.getByPlaceholder("john@example.com").fill(session.user.email);
  await page.getByPlaceholder("Enter your password").fill("Password123!");
  await page.getByRole("button", { name: "Sign In", exact: true }).click();
  await expect(page).toHaveURL(/\/support$/, { timeout: 60_000 });
}

async function sendRequest(page: Page): Promise<void> {
  await page.route(`${API}/support/access-requests`, (route) => {
    if (route.request().method() !== "POST") return route.fallback();
    return route.fulfill(json({ id: "r1", status: "PENDING" }, 201));
  });

  await page.goto("/support");
  await page.getByRole("button", { name: /Diagnostics/i }).first().click({ timeout: 60_000 });
  await expect(page.getByRole("heading", { name: /Ask for diagnostics access/i })).toBeVisible({
    timeout: 60_000,
  });
  await page
    .getByPlaceholder(/INC-1234/)
    .fill("INC-4471 customer reports external mail bouncing since 09:00");
  await page.getByRole("button", { name: "Request access" }).click();
  await expect(page.getByRole("heading", { name: "Request sent" })).toBeVisible();
}

test.describe("a support seat can withdraw the request it sent", () => {
  test("confirms, POSTs to the withdraw endpoint, and the row shows Withdrawn", async ({ page }) => {
    await signInAsSupport(page);
    const sent: Sent[] = [];
    await page.route(`${API}/support/access-requests/*/withdraw`, (route) => {
      const request = route.request();
      sent.push({ method: request.method(), url: request.url() });
      return route.fulfill(json({ id: "r1", status: "WITHDRAWN" }));
    });

    await sendRequest(page);

    const row = page.getByTestId("support-access-request-row");
    await expect(row).toContainText("Pending");

    await page.getByRole("button", { name: "Withdraw request" }).click();
    // The first click only asks; nothing has left the browser yet.
    await expect(page.getByText(/Withdraw this request\?/)).toBeVisible();
    expect(sent).toHaveLength(0);

    await page.getByRole("button", { name: "Yes, withdraw" }).click();

    await expect.poll(() => sent.length).toBe(1);
    expect(sent[0]?.method).toBe("POST");
    expect(new URL(sent[0]!.url).pathname).toMatch(/\/api\/v1\/support\/access-requests\/r1\/withdraw$/);

    await expect(row).toContainText("Withdrawn");
    await expect(page.getByRole("heading", { name: "Request withdrawn" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Withdraw request" })).toHaveCount(0);
  });

  test("shows the server's reason when the request is no longer pending", async ({ page }) => {
    await signInAsSupport(page);
    await page.route(`${API}/support/access-requests/*/withdraw`, (route) =>
      route.fulfill(
        json({ code: "NOT_FOUND", message: "Pending support access request not found" }, 404)
      )
    );

    await sendRequest(page);
    await page.getByRole("button", { name: "Withdraw request" }).click();
    await page.getByRole("button", { name: "Yes, withdraw" }).click();

    await expect(page.getByText("Pending support access request not found")).toBeVisible();
    await expect(page.getByTestId("support-access-request-row")).toContainText("Pending");
  });
});
