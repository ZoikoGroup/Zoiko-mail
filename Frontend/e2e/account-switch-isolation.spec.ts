import { test, expect } from "@playwright/test";
import { API, ADMIN_CAPABILITIES, json } from "./admin-harness";

/**
 * A second account signing in must not see the first one's data.
 *
 * The server was never the problem: every list endpoint is tenant-scoped and
 * answers correctly, which a backend sweep across fifteen of them confirms.
 * The leak was in the tab.
 *
 * `useLogout` clears the QueryClient, so signing out deliberately was clean.
 * But that is not how sessions usually end — they expire, or somebody just
 * navigates to /login — and in both of those the client survived with the
 * previous account's rows in it. `useLogin` invalidated only `["me"]`, so
 * members, mailboxes, domains and the dashboard stayed cached. With
 * `staleTime: 60_000` and `refetchOnWindowFocus: false`, the next account
 * rendered them immediately and without a single request.
 *
 * So this test signs in twice without ever logging out, which is precisely
 * the case the old code missed.
 */

const ACME_MEMBER = "dana@acme.test";
const GLOBEX_MEMBER = "sam@globex.test";

function sessionFor(tenant: string, email: string) {
  return {
    accessToken: `stub-${tenant}`,
    refreshToken: `stub-refresh-${tenant}`,
    expiresIn: "12h",
    user: { id: `u-${tenant}`, email, displayName: tenant },
    tenant: { id: `t-${tenant}`, name: tenant, planCode: "starter" },
    membership: { id: `m-${tenant}`, role: "ADMIN" },
    workspace: "ADMIN",
  };
}

/**
 * Sign in as one workspace, answering every read with only that workspace's
 * member. Re-registering the routes is what makes the second sign-in serve
 * different data — so anything left on screen from the first is stale by
 * definition.
 */
async function signInAs(page: import("@playwright/test").Page, tenant: string, email: string) {
  const session = sessionFor(tenant, email);

  await page.route(`${API}/**`, (route) => route.fulfill(json({ items: [], count: 0 })));
  await page.route(`${API}/auth/login`, (route) =>
    route.fulfill(json({ state: "SIGNED_IN", session, ...session }))
  );
  await page.route(`${API}/auth/me`, (route) =>
    route.fulfill(
      json({ ...session.user, tenant: session.tenant, membership: session.membership, workspace: "ADMIN" })
    )
  );
  await page.route(`${API}/users/me/capabilities`, (route) =>
    route.fulfill(json({ capabilities: ADMIN_CAPABILITIES, decisions: [] }))
  );
  await page.route(`${API}/membership/members*`, (route) =>
    route.fulfill(
      json({
        members: [
          {
            id: `m-${tenant}`,
            role: "MEMBER",
            status: "ACTIVE",
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            user: { id: `u-${tenant}`, email, displayName: email.split("@")[0] },
          },
        ],
        nextCursor: null,
      })
    )
  );

  await page.goto("/login");
  await page.getByPlaceholder("john@example.com").fill(email);
  await page.getByPlaceholder("Enter your password").fill("Password123!");
  await page.getByRole("button", { name: "Sign In", exact: true }).click();
  await expect(page).toHaveURL(/\/admin$/, { timeout: 60_000 });
}

test.describe("switching accounts in one tab", () => {
  test("the second account never sees the first one's rows", async ({ page }) => {
    await signInAs(page, "acme", ACME_MEMBER);
    await page.goto("/admin/users");
    await expect(page.getByText(ACME_MEMBER).first()).toBeVisible({ timeout: 30_000 });

    // No logout. This is the case that leaked: the session simply ends, or
    // somebody navigates back to the sign-in page, and the cache survives.
    await signInAs(page, "globex", GLOBEX_MEMBER);
    await page.goto("/admin/users");

    await expect(page.getByText(GLOBEX_MEMBER).first()).toBeVisible({ timeout: 30_000 });
    // The assertion that matters. staleTime is 60s, so without a clear on
    // sign-in this row renders from cache with no request behind it.
    await expect(page.getByText(ACME_MEMBER)).toHaveCount(0);
  });

  test("a deliberate log out also leaves nothing behind", async ({ page }) => {
    await signInAs(page, "acme", ACME_MEMBER);
    await page.goto("/admin/users");
    await expect(page.getByText(ACME_MEMBER).first()).toBeVisible({ timeout: 30_000 });

    await page.getByRole("button", { name: /log out/i }).first().click();
    await expect(page).toHaveURL(/\/login/, { timeout: 30_000 });

    await signInAs(page, "globex", GLOBEX_MEMBER);
    await page.goto("/admin/users");
    await expect(page.getByText(ACME_MEMBER)).toHaveCount(0);
  });
});
