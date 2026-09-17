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
  // Refuses anything but the token it issued, exactly as the server does. A
  // stub that answered 200 regardless would hide the whole class of defect
  // these tests are for — a client that routes to a console without having
  // stored the session looks identical to one that stored it, until the
  // guard runs.
  //
  // Checking the value and not merely the header's presence is the part that
  // bites: setTokens writes `String(undefined)`, so a client that stored
  // nothing still sends "Bearer undefined" and a presence check waves it
  // through while the real server rejects it as a malformed JWT.
  await page.route(`${API}/auth/me`, (route) => {
    if (route.request().headers()["authorization"] !== "Bearer stub-access-token") {
      return route.fulfill({
        status: 401,
        contentType: "application/json",
        body: JSON.stringify({
          success: false,
          error: { code: "UNAUTHORIZED", message: "Authentication required" },
        }),
      });
    }
    return route.fulfill({
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
    });
  });

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
  // Generous on the first assertion for the same reason as expectSentToLogin:
  // the destination route has to compile before the browser can arrive, and a
  // cold route in dev takes tens of seconds on its own. The second assertion
  // below keeps the default budget, because by then the page is warm and a
  // late bounce is exactly what it is looking for.
  await expect(page).toHaveURL(new RegExp(`${path}$`), { timeout: 60_000 });
  // A guard that bounces a moment later passes a URL assertion taken
  // immediately, which is how the create-workspace bounce stayed hidden.
  await page.waitForTimeout(2500);
  await expect(page).toHaveURL(new RegExp(`${path}$`));
}

/**
 * Waits for a guard to turn the browser away.
 *
 * A longer budget than the default on purpose. The guard cannot run until the
 * target route has compiled, and in dev a cold route can take twenty seconds
 * on its own — nothing to do with the guard being tested. A tight timeout
 * made this assertion fail intermittently, and an intermittent security test
 * is worse than none: people learn to re-run it rather than read it.
 */
async function expectSentToLogin(page: Page) {
  await expect(page).toHaveURL(/\/login$/, { timeout: 60_000 });
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

    await expectSentToLogin(page);
    await expect(page.getByText(/needs its own sign-in/i)).toBeVisible();
  });

  test("an owner session typing /admin is sent back to sign in", async ({ page }) => {
    // Seniority is not the question. An owner outranks an admin and still has
    // to sign in for the admin console.
    await signInThenVisit(page, "OWNER", "/admin");
    await expectSentToLogin(page);
  });

  test("an admin session typing /inbox is sent back to sign in", async ({ page }) => {
    await signInThenVisit(page, "ADMIN", "/inbox");
    await expectSentToLogin(page);
  });

  test("a member session typing /admin is sent back to sign in", async ({ page }) => {
    await signInThenVisit(page, "MEMBER", "/admin");
    await expectSentToLogin(page);
  });

  test("a member session typing /owner is sent back to sign in", async ({ page }) => {
    await signInThenVisit(page, "MEMBER", "/owner");
    await expectSentToLogin(page);
  });

  test("the discarded session cannot be walked back into", async ({ page }) => {
    await signInThenVisit(page, "ADMIN", "/owner");
    await expectSentToLogin(page);

    // The tokens were destroyed, not merely navigated away from, so returning
    // to the workspace that did match starts at the login form again.
    await page.goto("/admin");
    await expectSentToLogin(page);
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
    await expectSentToLogin(page);
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

    await expectSentToLogin(page);
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

    await expectSentToLogin(page);
    // Named as a server problem, so the next person does not spend the round
    // re-testing their own sign-in.
    await expect(page.getByText(/did not say which workspace/i)).toBeVisible();
  });
});

/**
 * The second factor — AC-002.
 *
 * A privileged sign-in returns a challenge instead of a session, and the
 * client has to take the user somewhere they can answer it. Getting this wrong
 * is invisible in unit tests and total in the browser: the sign-in succeeds,
 * no session exists, and every shell bounces back to /login in a loop.
 */
test.describe("a privileged sign-in stops for a second factor", () => {
  test("routes an MFA challenge to the verification screen", async ({ page }) => {
    await stubLogin(page, {
      success: true,
      data: {
        state: "MFA_REQUIRED",
        user: { id: "u1", email: "owner@zoiko.test", displayName: "Owner" },
        mfaToken: "stub-mfa-token",
        expiresIn: "10m",
        remainingRecoveryCodes: 10,
      },
    });

    await page.goto("/login");
    await signIn(page);

    await expect(page).toHaveURL(/\/verify-mfa/);
    await expect(page.getByText(/authenticator code/i)).toBeVisible();
  });

  test("walks an account with no authenticator through enrolment", async ({ page }) => {
    await stubLogin(page, {
      success: true,
      data: {
        state: "MFA_ENROLLMENT_REQUIRED",
        user: { id: "u1", email: "owner@zoiko.test", displayName: "Owner" },
        mfaToken: "stub-mfa-token",
        expiresIn: "10m",
        requiredBecause: "OWNER",
      },
    });
    await page.route(`${API}/auth/mfa/challenge/enroll`, (route) =>
      route.fulfill({
        status: 201,
        contentType: "application/json",
        body: JSON.stringify({
          success: true,
          data: {
            secret: "JBSWY3DPEHPK3PXP",
            uri: "otpauth://totp/Zoiko%20Mail:owner@zoiko.test?secret=JBSWY3DPEHPK3PXP",
          },
        }),
      })
    );

    await page.goto("/login");
    await signIn(page);

    await expect(page).toHaveURL(/\/verify-mfa/);
    // The key has to be on screen: an enrolment screen with nothing to scan
    // is a dead end for the account it is protecting.
    await expect(page.getByText("JBSWY3DPEHPK3PXP")).toBeVisible();
    await expect(page.getByText(/required for owner accounts/i)).toBeVisible();
  });

  test("sends someone who lands there with no challenge back to sign in", async ({ page }) => {
    await page.goto("/verify-mfa");
    await expectSentToLogin(page);
  });
});

test.describe("an invited account lands in the workspace it was invited to", () => {
  /**
   * The join response is `{ state, session: { accessToken, ... } }` and is NOT
   * flattened the way /auth/login is. joinWorkspace read `data.accessToken`
   * off the top level and stored the string "undefined" as the session, so
   * the new joiner was redirected to their workspace and then turned away
   * from it having done everything right.
   *
   * Both roles are covered because the same broken session fails differently
   * in each shell — /admin bounces to sign-in, /inbox spins — and a test
   * written against only one of those symptoms would have called the other
   * fixed.
   *
   * Driven through the real forms rather than by seeding tokens, because the
   * defect is in what the client does with the response. A test that stored
   * the tokens itself would pass with the bug still in place.
   */
  async function stubInvitedSignUp(page: Page, role: Scope) {
    const session = {
      accessToken: "stub-access-token",
      refreshToken: "stub-refresh-token",
      expiresIn: "12h",
      user: { id: "u1", email: "someone@zoiko.test", displayName: "Someone" },
      tenant: { id: "t1", name: "Stub Workspace", planCode: "starter" },
      membership: { id: "m1", role },
      workspace: role,
    };

    await page.route(`${API}/auth/register`, (route) =>
      route.fulfill({
        status: 201,
        contentType: "application/json",
        body: JSON.stringify({
          success: true,
          data: { user: { id: "u1" }, pendingToken: "pending-1" },
        }),
      })
    );
    await page.route(`${API}/auth/verify-otp`, (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          success: true,
          data: {
            pendingToken: "pending-2",
            // Keyed by membershipId, as PendingInvitationSummary is — the
            // join button stays disabled without it, which is the shape the
            // form selects on.
            pendingInvitations: [
              {
                membershipId: "m1",
                tenantId: "t1",
                tenantName: "Stub Workspace",
                role,
              },
            ],
          },
        }),
      })
    );
    // Nested only — exactly what the server sends, and the shape that broke it.
    await page.route(`${API}/auth/join-workspace`, (route) =>
      route.fulfill({
        status: 201,
        contentType: "application/json",
        body: JSON.stringify({ success: true, data: { state: "SIGNED_IN", session } }),
      })
    );
  }

  for (const role of ["ADMIN", "MEMBER"] as const) {
    test(`a joiner invited as ${role} settles on ${HOME[role]}`, async ({ page }) => {
      await stubSessionReads(page, role);
      await stubInvitedSignUp(page, role);

      await page.goto("/login");
      await page.getByRole("button", { name: "Create one" }).click();

      await page.getByPlaceholder("John Doe").fill("Someone");
      await page.getByPlaceholder("john@example.com").fill("someone@zoiko.test");
      await page.getByPlaceholder("Create password").fill("Password123!");
      await page.getByPlaceholder("Confirm password").fill("Password123!");
      // exact: the Google button renders as "Continue with Google" once its
      // iframe loads, and collides with this one when it wins the race.
      await page.getByRole("button", { name: "Continue", exact: true }).click();

      // Six single-character boxes rather than one field.
      const digits = page.locator('input[maxlength="1"]');
      await expect(digits.first()).toBeVisible({ timeout: 30_000 });
      for (let i = 0; i < 6; i += 1) await digits.nth(i).fill(String(i + 1));
      await page.getByRole("button", { name: "Verify Code" }).click();

      await page.getByRole("button", { name: /Join Stub Workspace/ }).click();

      // Settles, because the bug looked like a working redirect for an
      // instant before the guard undid it.
      await settlesOn(page, HOME[role]);

      // And the console is actually on screen. The URL alone is not enough:
      // the two shells fail differently on a missing session — the admin one
      // bounces to /login, the member one sits on /inbox showing its loading
      // spinner for ever, because isLoggedIn() reads the literal string
      // "undefined" as a token and only /auth/me knows better.
      await expect(page.getByRole("navigation").first()).toBeVisible({ timeout: 30_000 });
    });
  }
});
