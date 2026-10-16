import { test, expect, type Page } from "@playwright/test";
import { API, json, signInAsAdmin } from "./admin-harness";

/**
 * Tabs share one session (localStorage), so signing in from one tab replaces
 * it for all of them.
 *
 * The failure this guards: an Admin tab left open on Mailboxes while another
 * tab signed in as a member kept showing the Admin console — cached name and
 * role — while its requests went out on the member session, and the page read
 * "This action requires the workspace.mailboxes.manage capability". The open
 * tab now follows the session the browser holds instead.
 */

const ACCESS_KEY = "zoiko.access_token";

/** /auth/me answers for whichever token the request carries, like the API does. */
async function identityByToken(page: Page) {
  await page.route(`${API}/auth/me`, (route) => {
    const member = route.request().headers()["authorization"] === "Bearer member-token";
    return route.fulfill(
      json({
        id: member ? "u2" : "u1",
        email: member ? "member@zoiko.test" : "admin@zoiko.test",
        displayName: member ? "Member" : "Admin",
        tenant: { id: "t1", name: "Acme Corp", planCode: "starter" },
        membership: { id: member ? "m2" : "m1", role: member ? "MEMBER" : "ADMIN" },
        workspace: member ? "MEMBER" : "ADMIN",
      })
    );
  });
}

test("an open Admin tab follows a member sign-in made in another tab, instead of showing the wrong console", async ({ page, context }) => {
  await signInAsAdmin(page);
  await identityByToken(page);
  await page.goto("/admin/mailboxes");
  await expect(page.getByRole("heading", { name: "Mailboxes", exact: true }).first()).toBeVisible({ timeout: 60_000 });

  // Another tab signs in as a member: the shared token is replaced.
  const other = await context.newPage();
  await other.goto("/login");
  await other.evaluate((key) => {
    localStorage.removeItem(key);
    localStorage.setItem(key, "member-token");
  }, ACCESS_KEY);

  // The Admin tab moves to the member's workspace rather than staying on a
  // console it no longer holds — and does not sign the other tab out.
  await expect(page).toHaveURL(/\/mail$/, { timeout: 30_000 });
  expect(await other.evaluate((key) => localStorage.getItem(key), ACCESS_KEY)).toBe("member-token");
});

test("an open workspace tab goes to sign-in when another tab signs out", async ({ page, context }) => {
  await signInAsAdmin(page);
  await page.goto("/admin/mailboxes");
  await expect(page.getByRole("heading", { name: "Mailboxes", exact: true }).first()).toBeVisible({ timeout: 60_000 });

  const other = await context.newPage();
  await other.goto("/login");
  await other.evaluate(() => localStorage.clear());

  await expect(page).toHaveURL(/\/login$/, { timeout: 30_000 });
});

test("a tab on the sign-in page is left alone when another tab signs in", async ({ page, context }) => {
  await page.route(`${API}/**`, (route) => route.fulfill(json({ items: [], count: 0 })));
  await page.goto("/login");
  const other = await context.newPage();
  await other.goto("/login");
  await other.evaluate((key) => localStorage.setItem(key, "member-token"), ACCESS_KEY);
  await page.waitForTimeout(1500);
  await expect(page).toHaveURL(/\/login$/);
});
