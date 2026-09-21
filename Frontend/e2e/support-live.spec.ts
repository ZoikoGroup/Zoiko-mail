import { test, expect, type Page } from "@playwright/test";

/**
 * The support console keeps itself current.
 *
 * Runbook §5 sets a fifteen-minute initial response for a P0. A console that
 * loads once and then holds still cannot support that: whoever is on duty
 * would have to keep pressing refresh to discover anything had arrived, and
 * the one thing a duty screen must not do is look calm because it stopped
 * asking.
 *
 * This is the first browser test the support workspace has had. It is written
 * against the behaviour rather than the mechanism — the assertion is that new
 * server state reaches the screen without anyone touching it, which stays true
 * whether the screen polls, subscribes or is rewritten onto the query layer.
 */

const API = "**/api/v1";

const json = (data: unknown) => ({
  status: 200,
  contentType: "application/json",
  body: JSON.stringify({ success: true, data }),
});

/** A SUPPORT-scoped session, which is what /support renders the tenant console for. */
async function signInAsSupport(page: Page) {
  const session = {
    accessToken: "stub-access-token",
    refreshToken: "stub-refresh-token",
    expiresIn: "12h",
    user: { id: "u1", email: "support@zoiko.test", displayName: "Support" },
    tenant: { id: "t1", name: "Acme Corp", planCode: "starter" },
    membership: { id: "m1", role: "SUPPORT" },
    workspace: "SUPPORT",
  };

  // Anything not named below answers benignly, so an unstubbed read cannot
  // masquerade as the failure under test.
  await page.route(`${API}/**`, (route) => route.fulfill(json({ items: [], count: 0 })));

  await page.route(`${API}/auth/login`, (route) =>
    route.fulfill(json({ state: "SIGNED_IN", session, ...session }))
  );
  await page.route(`${API}/auth/me`, (route) =>
    route.fulfill(
      json({
        ...session.user,
        tenant: session.tenant,
        membership: session.membership,
        workspace: "SUPPORT",
      })
    )
  );

  await page.goto("/login");
  await page.getByPlaceholder("john@example.com").fill("support@zoiko.test");
  await page.getByPlaceholder("Enter your password").fill("Password123!");
  await page.getByRole("button", { name: "Sign In", exact: true }).click();
  await expect(page).toHaveURL(/\/support$/, { timeout: 60_000 });
}

test.describe("the support console does not go stale while it is being watched", () => {
  test("picks up a ticket change without anyone reloading", async ({ page }) => {
    let ticketCount = 2;
    let ticketReads = 0;

    await signInAsSupport(page);

    // The ticket list is the screen a duty operator leaves open. Its count
    // stands in for anything that can change underneath them.
    await page.route(`${API}/support/tickets*`, (route) => {
      ticketReads += 1;
      return route.fulfill(
        json({
          tickets: Array.from({ length: ticketCount }, (_, i) => ({
            id: `t${i}`,
            ticketNumber: i + 1,
            subject: `Ticket ${i + 1}`,
            description: "",
            category: "OTHER",
            severity: "LOW",
            status: "OPEN",
            tenantId: "t1",
            tenantName: "Acme Corp",
            openedBy: { id: "u1", email: "u1@test", displayName: "User" },
            openedByType: "MEMBER",
            assignedStaff: null,
            slaDueAt: null,
            slaOverdue: false,
            resolvedAt: null,
            closedAt: null,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            comments: [],
          })),
          ticketCounts: { OPEN: ticketCount, IN_PROGRESS: 0, WAITING_TENANT: 0, RESOLVED: 0, CLOSED: 0 },
        })
      );
    });

    await page.goto("/support");
    // Wait for the ticket list to render with initial count
    await expect(page.getByText("2", { exact: true }).first()).toBeVisible({ timeout: 60_000 });
    const readsAfterLoad = ticketReads;

    // Something happens on the server. Nobody touches the browser.
    ticketCount = 3;

    await expect
      .poll(() => ticketReads, { timeout: 120_000, intervals: [2_000] })
      .toBeGreaterThan(readsAfterLoad);
  });

  test("stops asking while the tab is in the background", async ({ page }) => {
    // Proving something does *not* happen costs real time: the interval is
    // 30s, so the quiet window has to outlast one. That plus a sign-in does
    // not fit the default 90s budget when the whole suite is competing for
    // the machine, which is how this passed alone and failed in a full run.
    test.setTimeout(180_000);

    let reads = 0;
    await signInAsSupport(page);
    await page.route(`${API}/support/tickets*`, (route) => {
      reads += 1;
      return route.fulfill(
        json({
          tickets: [
            {
              id: "t1",
              ticketNumber: 1,
              subject: "Test Ticket",
              description: "",
              category: "OTHER",
              severity: "LOW",
              status: "OPEN",
              tenantId: "t1",
              tenantName: "Acme Corp",
              openedBy: { id: "u1", email: "u1@test", displayName: "User" },
              openedByType: "MEMBER",
              assignedStaff: null,
              slaDueAt: null,
              slaOverdue: false,
              resolvedAt: null,
              closedAt: null,
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
              comments: [],
            },
          ],
          ticketCounts: { OPEN: 1, IN_PROGRESS: 0, WAITING_TENANT: 0, RESOLVED: 0, CLOSED: 0 },
        })
      );
    });

    await page.goto("/support");
    await expect.poll(() => reads, { timeout: 60_000 }).toBeGreaterThan(0);

    // Emulated rather than done by focusing another tab: a headless browser
    // keeps every page "visible", so bringing a second tab forward proves
    // nothing. Overriding the property and firing the event is what the
    // browser itself does, and is the input the guard actually reads.
    await page.evaluate(() => {
      Object.defineProperty(document, "visibilityState", {
        configurable: true,
        get: () => "hidden",
      });
      document.dispatchEvent(new Event("visibilitychange"));
    });

    // Polling a screen nobody is reading spends the operator's battery to
    // keep it current for no one.
    const readsWhenHidden = reads;
    // Comfortably past one 30s interval, without spending seventy seconds to
    // prove a thirty-second rule.
    await page.waitForTimeout(45_000);
    expect(reads).toBe(readsWhenHidden);

    // Coming back is the moment the contents are most likely to be both
    // stale and about to be read, so it refreshes at once rather than
    // waiting out the rest of the interval.
    await page.evaluate(() => {
      Object.defineProperty(document, "visibilityState", {
        configurable: true,
        get: () => "visible",
      });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await expect.poll(() => reads, { timeout: 30_000 }).toBeGreaterThan(readsWhenHidden);
  });
});