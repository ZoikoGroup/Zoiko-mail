import { test, expect, type Page } from "@playwright/test";

/**
 * Where a sign-in lands, and whether the session stays inside the workspace
 * it was opened for.
 *
 * These failures leave no server trace: the API answers 200 and the client
 * then dead-ends or renders a console it should not, so the logs show a clean
 * sign-in while the user is somewhere they should not be. A browser is the
 * only place to see it.
 *
 * The API is stubbed, because the subject is the client's routing and guard
 * decisions for a given session, not whether the server produces it — the
 * backend suite covers that, including forcing MEMBER scope on Google.
 * Sign-in is driven through the password form because Google's button is a
 * cross-origin iframe a test cannot click; both paths share routeAuthState.
 */

const API = "**/api/v1";

type Scope = "OWNER" | "ADMIN" | "MEMBER" | "SUPPORT";

const HOME: Record<Scope, string> = {
  OWNER: "/owner",
  ADMIN: "/admin",
  MEMBER: "/inbox",
  SUPPORT: "/support",
};

/**
 * A SIGNED_IN payload shaped the way /auth/login returns one: the session
 * nested, and also flattened onto the top level.
 *
 * `role` is the acting role and `workspace` the console the session was
 * opened for. They are separate on purpose — a Google sign-in by an owner is
 * MEMBER/MEMBER, which is the case the scope exists for.
 */
function signedIn(workspace: Scope, role: string = workspace) {
  const session = {
    accessToken: "stub-access-token",
    refreshToken: "stub-refresh-token",
    expiresIn: "12h",
    user: { id: "u1", email: "someone@zoiko.test", displayName: "Someone" },
    tenant: { id: "t1", name: "Stub Workspace", planCode: "starter" },
    membership: { id: "m1", role },
    workspace,
  };
  return { success: true, data: { state: "SIGNED_IN", session, ...session } };
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
 * Everything a shell reads once a session exists. /auth/me has to report the
 * workspace, because that is what every shell now gates on.
 */
async function stubSessionReads(
  page: Page,
  workspace: Scope,
  role: string = workspace
) {
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
          workspace,
        },
      }),
    })
  );

  // Anything else a dashboard asks for. Shaped as an object rather than a
  // bare array: an array made the admin dashboard throw inside its error
  // boundary and redirect to /login, which is indistinguishable from the bug
  // these tests exist to catch.
  await page.route(`${API}/**`, (route) => {
    if (route.request().url().includes("/auth/")) return route.fallback();
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ success: true, data: { items: [], count: 0 } }),
    });
  });
}

async function signIn(page: Page) {
  await page.getByPlaceholder("john@example.com").fill("someone@zoiko.test");
  await page.getByPlaceholder("Enter your password").fill("Password123!");
  await page.getByRole("button", { name: "Sign In", exact: true }).click();
}

/** Asserts a destination, and that it is still the destination a moment later. */
async function settlesOn(page: Page, path: string) {
  await expect(page).toHaveURL(new RegExp(`${path}$`));
  // A guard that bounces a moment later passes a URL assertion taken
  // immediately, which is how the create-workspace bounce stayed hidden.
  await page.waitForTimeout(2500);
  await expect(page).toHaveURL(new RegExp(`${path}$`));
}

/** Signs in for one workspace, then navigates to another workspace's URL. */
async function signInThenVisit(page: Page, scope: Scope, target: string) {
  await stubSessionReads(page, scope);
  await stubLogin(page, signedIn(scope));

  await page.goto("/login");
  await signIn(page);
  await expect(page).toHaveURL(new RegExp(`${HOME[scope]}$`));

  await page.goto(target);
}

test.describe("a sign-in lands in the workspace it was opened for", () => {
  for (const workspace of ["OWNER", "ADMIN", "MEMBER"] as const) {
    test(`${workspace} lands on ${HOME[workspace]} and stays`, async ({ page }) => {
      await stubSessionReads(page, workspace);
      await stubLogin(page, signedIn(workspace));

      await page.goto("/login");
      await signIn(page);

      await settlesOn(page, HOME[workspace]);
    });
  }

  test("an owner signing in with Google lands in the member workspace", async ({
    page,
  }) => {
    // The server issues MEMBER scope for every Google sign-in however senior
    // the account. The client follows the scope, not the role — routing on
    // the role here would open the owner console.
    await stubSessionReads(page, "MEMBER");
    await stubLogin(page, signedIn("MEMBER"));

    await page.goto("/login");
    await signIn(page);

    await settlesOn(page, "/inbox");
  });
});

test.describe("a session cannot be carried into another workspace", () => {
  test("an admin session typing /owner is sent back to sign in", async ({ page }) => {
    // This is the recording: signed into the admin console, typed
    // localhost:3000/owner, and the owner console rendered.
    await signInThenVisit(page, "ADMIN", "/owner");

    await expect(page).toHaveURL(/\/login$/);
    await expect(page.getByText(/needs its own sign-in/i)).toBeVisible();
  });

  test("an owner session typing /admin is sent back to sign in", async ({ page }) => {
    // Seniority is not the question. An owner outranks an admin and still has
    // to sign in for the admin console.
    await signInThenVisit(page, "OWNER", "/admin");
    await expect(page).toHaveURL(/\/login$/);
  });

  test("an admin session typing /inbox is sent back to sign in", async ({ page }) => {
    await signInThenVisit(page, "ADMIN", "/inbox");
    await expect(page).toHaveURL(/\/login$/);
  });

  test("a member session typing /admin is sent back to sign in", async ({ page }) => {
    await signInThenVisit(page, "MEMBER", "/admin");
    await expect(page).toHaveURL(/\/login$/);
  });

  test("a member session typing /owner is sent back to sign in", async ({ page }) => {
    await signInThenVisit(page, "MEMBER", "/owner");
    await expect(page).toHaveURL(/\/login$/);
  });

  test("the discarded session cannot be walked back into", async ({ page }) => {
    await signInThenVisit(page, "ADMIN", "/owner");
    await expect(page).toHaveURL(/\/login$/);

    // The tokens were destroyed, not merely navigated away from, so returning
    // to the workspace that did match starts at the login form again.
    await page.goto("/admin");
    await expect(page).toHaveURL(/\/login$/);
  });
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

    // The bug: the screen appeared then bounced to /login about 400ms later,
    // because its mount effect consumed the token it had just read and
    // StrictMode ran the effect twice.
    await page.waitForTimeout(3000);
    await expect(page).toHaveURL(/\/create-workspace$/);
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
  });

  test("sends someone who arrives with no pending token back to sign in", async ({
    page,
  }) => {
    await page.goto("/login");
    await page.evaluate(() => sessionStorage.clear());

    await page.goto("/create-workspace");
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

    // Signing into another workspace moves the claim, and every tenant-scoped
    // read then refuses.
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
    // Reappearing at the login form with nothing said is what makes this read
    // as a fault rather than as the rule it is.
    await expect(page.getByText(/another workspace/i)).toBeVisible();
  });
});

test.describe("a server that does not report the workspace says so", () => {
  test("an unscoped session explains itself instead of looping", async ({ page }) => {
    // The failure this covers: the API was an older build that did not put a
    // workspace on the session, the guards refused it, and the browser went
    // back to the login form with nothing said. Signing in again produced the
    // same unscoped session, so it looked like Google sign-in was broken.
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
            membership: { id: "m1", role: "MEMBER" },
            // No `workspace`: the whole point of this case.
          },
        }),
      })
    );
    await page.route(`${API}/**`, (route) => {
      if (route.request().url().includes("/auth/")) return route.fallback();
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ success: true, data: { items: [], count: 0 } }),
      });
    });
    await stubLogin(page, signedIn("MEMBER"));

    await page.goto("/login");
    await signIn(page);

    await expect(page).toHaveURL(/\/login$/);
    // Named as a server problem, so the next person does not spend the round
    // re-testing their own sign-in.
    await expect(page.getByText(/did not say which workspace/i)).toBeVisible();
  });
});
