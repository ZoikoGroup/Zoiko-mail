import { test, expect, type Page } from "@playwright/test";

/**
 * Where a sign-in lands, and whether it stays there.
 *
 * The bugs this covers were all invisible from the server: the API answered
 * 200 and the client then dead-ended, so the logs showed a clean sign-in
 * while the user was looking at the login form.
 *
 * The API is stubbed rather than run, because the subject here is the client's
 * routing decision for a given auth state, not whether the server produces
 * that state — the backend suite covers the second. Sign-in is driven through
 * the password form because Google's button is a cross-origin iframe that
 * cannot be clicked from a test; both paths share routeAuthState, which is
 * the code under test either way.
 */

const API = "**/api/v1";

/** A SIGNED_IN payload shaped the way /auth/login actually returns one. */
function signedIn(role: string) {
  const session = {
    accessToken: "stub-access-token",
    refreshToken: "stub-refresh-token",
    expiresIn: "12h",
    user: { id: "u1", email: "someone@zoiko.test", displayName: "Someone" },
    tenant: { id: "t1", name: "Stub Workspace", planCode: "starter" },
    membership: { id: "m1", role },
  };
  return {
    success: true,
    data: { state: "SIGNED_IN", session, ...session },
  };
}

async function stubLogin(page: Page, body: unknown, status = 200) {
  await page.route(`${API}/auth/login`, (route) =>
    route.fulfill({
      status,
      contentType: "application/json",
      body: JSON.stringify(body),
    })
  );
}

/**
 * Everything the shells fetch once a session exists. Without these the shell
 * would hit the real API with a stub token, get a 401, and redirect to
 * /login — which would look exactly like the bug under test.
 */
async function stubSessionReads(page: Page, role: string) {
  await page.route(`${API}/auth/me`, (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        success: true,
        data: {
          id: "u1",
          email: "someone@zoiko.test",
          displayName: "Someone",
          tenant: { id: "t1", name: "Stub Workspace", planCode: "starter" },
          membership: { id: "m1", role },
       },
      }),
    })
  );

  // Anything else the dashboards ask for: an empty success keeps the page
  // rendering instead of erroring, without pretending to be real data.
  await page.route(`${API}/**`, (route) => {
    if (route.request().url().includes("/auth/")) return route.fallback();
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ success: true, data: [] }),
    });
  });
}

async function signIn(page: Page) {
  await page.getByPlaceholder("john@example.com").fill("someone@zoiko.test");
  await page.getByPlaceholder("Enter your password").fill("Password123!");
  await page.getByRole("button", { name: "Sign In", exact: true }).click();
}

test.describe("a sign-in lands in the workspace its role allows", () => {
  for (const [role, path] of [
    ["OWNER", "/owner"],
    ["ADMIN", "/admin"],
    ["MEMBER", "/inbox"],
  ] as const) {
    test(`${role} is routed to ${path}`, async ({ page }) => {
      await stubSessionReads(page, role);
      await stubLogin(page, signedIn(role));

      await page.goto("/login");
      await signIn(page);

      await expect(page).toHaveURL(new RegExp(`${path}$`));
      // And stays: a guard that bounces a moment later is the actual failure
      // people report, and a plain URL assertion passes right before it.
      await page.waitForTimeout(2500);
      await expect(page).toHaveURL(new RegExp(`${path}$`));
    });
  }
});

test.describe("a sign-in with no workspace reaches the create-workspace screen", () => {
  test("routes there and stays there", async ({ page }) => {
    await stubLogin(page, {
      success: true,
      data: {
        state: "NO_WORKSPACE",
        user: { id: "u1", email: "fresh@zoiko.test", displayName: "Fresh" },
        pendingToken: "stub-pending-token",
        expiresIn: "12h",
      },
    });

    await page.goto("/login");
    await signIn(page);

    await expect(page).toHaveURL(/\/create-workspace$/);
    await expect(
      page.getByRole("heading", { name: /create your workspace/i })
    ).toBeVisible();

    // The bug: the screen appeared and bounced back to /login about 400ms
    // later, because its mount effect consumed the token it had just read and
    // StrictMode ran the effect twice.
    await page.waitForTimeout(3000);
    await expect(page).toHaveURL(/\/create-workspace$/);
    await expect(
      page.getByRole("heading", { name: /create your workspace/i })
    ).toBeVisible();
  });

  test("survives a reload, so a mistyped name is recoverable", async ({ page }) => {
    await page.goto("/login");
    await page.evaluate(() => {
      sessionStorage.setItem("zoiko.workspace_token", "stub-pending-token");
      sessionStorage.setItem("zoiko.workspace_email", "fresh@zoiko.test");
    });

    await page.goto("/create-workspace");
    await expect(
      page.getByRole("heading", { name: /create your workspace/i })
    ).toBeVisible();

    await page.reload();
    await expect(
      page.getByRole("heading", { name: /create your workspace/i })
    ).toBeVisible();
    await expect(page).toHaveURL(/\/create-workspace$/);
  });

  test("sends someone who arrives with no pending token back to sign in", async ({
    page,
  }) => {
    await page.goto("/login");
    await page.evaluate(() => sessionStorage.clear());

    await page.goto("/create-workspace");
    // Fails closed: without a token there is nothing this screen can do.
    await expect(page).toHaveURL(/\/login$/);
  });
});

test.describe("a sign-in that needs a workspace picked goes to the picker", () => {
  test("routes to /select-workspace with the offered workspaces", async ({
    page,
  }) => {
    await stubLogin(page, {
      success: true,
      data: {
        state: "WORKSPACE_SELECTION",
        user: { id: "u1", email: "dual@zoiko.test", displayName: "Dual" },
        selectionToken: "stub-selection-token",
        workspaces: [
          {
            id: "t1",
            name: "First Workspace",
            planCode: "starter",
            role: "OWNER",
            membershipId: "m1",
            membershipStatus: "ACTIVE",
            tenantStatus: "ACTIVE",
            selectable: true,
          },
          {
            id: "t2",
            name: "Second Workspace",
            planCode: "starter",
            role: "MEMBER",
            membershipId: "m2",
            membershipStatus: "ACTIVE",
            tenantStatus: "ACTIVE",
            selectable: true,
          },
        ],
      },
    });

    await page.goto("/login");
    await signIn(page);

    await expect(page).toHaveURL(/\/select-workspace$/);
    await expect(page.getByText("First Workspace")).toBeVisible();
    await expect(page.getByText("Second Workspace")).toBeVisible();
  });
});

test.describe("a session ended elsewhere returns to sign-in and says why", () => {
  test("a superseded session lands on /login with an explanation", async ({
    page,
  }) => {
    await stubSessionReads(page, "ADMIN");
    await stubLogin(page, signedIn("ADMIN"));

    await page.goto("/login");
    await signIn(page);
    await expect(page).toHaveURL(/\/admin$/);

    // Now the workspace claim moves, which is what signing into the other
    // workspace does. Every tenant-scoped read starts refusing.
    await page.route(`${API}/auth/me`, (route) =>
      route.fulfill({
        status: 401,
        contentType: "application/json",
        body: JSON.stringify({
          success: false,
          error: {
            code: "SESSION_SUPERSEDED",
            message:
              "This session ended because you signed into another workspace. Sign in again to come back.",
          },
        }),
      })
    );

    await page.reload();

    await expect(page).toHaveURL(/\/login$/);
    // Silently reappearing at the login form is what makes this read as a
    // fault rather than as the rule it is.
    await expect(
      page.getByText(/signed into another workspace/i)
    ).toBeVisible();
  });
});
