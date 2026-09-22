import { test, expect, type Page } from "@playwright/test";

/**
 * Asking for support access, and deciding on it — Runbook §7.
 *
 * The enforcement landed before the screens did: support cannot read a
 * workspace without an approved, unexpired grant. For a while nothing in the
 * product could create one, so a real control was reachable only by calling
 * the API directly. These two tests cover the halves that fixed that — the
 * seat asking, and the owner deciding.
 *
 * Asserted through what leaves the browser rather than what is drawn: the
 * request must carry the attribution §7 demands, and approving must send a
 * step-up token, because RBAC §2 marks approving support access high-risk.
 */

const API = "**/api/v1";

const json = (data: unknown) => ({
  status: 200,
  contentType: "application/json",
  body: JSON.stringify({ success: true, data }),
});

interface Calls {
  sent: Array<{ method: string; url: string; body: unknown; stepUp: string | null }>;
}

async function signIn(page: Page, workspace: "SUPPORT" | "OWNER"): Promise<Calls> {
  const calls: Calls = { sent: [] };
  const session = {
    accessToken: "stub-access-token",
    refreshToken: "stub-refresh-token",
    expiresIn: "12h",
    user: { id: "u1", email: `${workspace.toLowerCase()}@zoiko.test`, displayName: "Test" },
    tenant: { id: "t1", name: "Acme Corp", planCode: "starter" },
    membership: { id: "m1", role: workspace },
    workspace,
  };

  await page.route(`${API}/**`, (route) => route.fulfill(json({ items: [], count: 0 })));
  await page.route(`${API}/auth/login`, (route) =>
    route.fulfill(json({ state: "SIGNED_IN", session, ...session }))
  );
  await page.route(`${API}/auth/me`, (route) =>
    route.fulfill(
      json({ ...session.user, tenant: session.tenant, membership: session.membership, workspace })
    )
  );
  await page.route(`${API}/users/me/capabilities`, (route) =>
    route.fulfill(
      json({
        capabilities: ["support.grant.read", "support.grant.create", "support.grant.end"],
        decisions: [],
      })
    )
  );

  await page.goto("/login");
  await page.getByPlaceholder("john@example.com").fill(session.user.email);
  await page.getByPlaceholder("Enter your password").fill("Password123!");
  await page.getByRole("button", { name: "Sign In", exact: true }).click();
  await expect(page).toHaveURL(workspace === "OWNER" ? /\/owner$/ : /\/support$/, {
    timeout: 60_000,
  });
  return calls;
}

test.describe("a support seat with no grant is offered a way to ask", () => {
  test("sends the attribution the server insists on", async ({ page }) => {
    const calls = await signIn(page, "SUPPORT");

    // What a seat holding no live grant actually gets from every panel.
    await page.route(`${API}/support/overview`, (route) =>
      route.fulfill({
        status: 403,
        contentType: "application/json",
        body: JSON.stringify({
          success: false,
          error: {
            code: "FORBIDDEN",
            message:
              "This workspace needs an approved support access grant. Ask the workspace owner to approve one.",
            details: { capability: "support.console.read", requiresSupportGrant: true },
          },
        }),
      })
    );
    await page.route(`${API}/support/access-requests`, (route) => {
      const request = route.request();
      calls.sent.push({
        method: request.method(),
        url: request.url(),
        body: request.postDataJSON?.() ?? null,
        stepUp: request.headers()["x-step-up-token"] ?? null,
      });
      return route.fulfill(json({ id: "r1", status: "PENDING" }));
    });

    await page.goto("/support");

    // The console lands on Tickets, which needs no grant — that is what
    // makes the console/investigate split workable rather than a wall of
    // refusals. The request panel belongs to the tab that was refused.
    await page.getByRole("button", { name: /Workspace Overview/i }).first().click({
      timeout: 60_000,
    });

    // The refusal turns into something to do, rather than a load error with
    // no next step.
    await expect(page.getByRole("heading", { name: /Ask for access/i })).toBeVisible({
      timeout: 60_000,
    });

    await page
      .getByPlaceholder(/INC-1234/)
      .fill("INC-4471 customer reports external mail bouncing since 09:00");
    await page.getByRole("button", { name: "Request access" }).click();

    await expect.poll(() => calls.sent.length).toBeGreaterThan(0);
    const body = calls.sent[0]?.body as { reason: string; scopes: string[]; requestedMinutes: number };
    expect(body.reason).toMatch(/INC-4471/);
    expect(body.scopes.length).toBeGreaterThan(0);
    expect(body.requestedMinutes).toBeGreaterThan(0);

    await expect(page.getByText("Request sent")).toBeVisible();
  });
});

test.describe("the owner decides, and approving takes a step-up", () => {
  test("re-authenticates before the grant is written", async ({ page }) => {
    const calls = await signIn(page, "OWNER");
    let approved = false;

    await page.route(`${API}/support/access-requests*`, (route) => {
      if (route.request().method() !== "GET") return route.fallback();
      return route.fulfill(
        json({
          requests: [
            {
              id: "r1",
              reason: "INC-4471 delivery failures reported by the customer",
              scopes: ["TENANT_DIAGNOSTICS"],
              requestedMinutes: 60,
              status: approved ? "APPROVED" : "PENDING",
              createdAt: new Date().toISOString(),
              decidedAt: null,
              grantId: null,
              supportMembership: {
                id: "sm1",
                user: { id: "u9", email: "agent@zoikosupport.test", displayName: "Agent" },
              },
              decidedBy: null,
              ticket: null,
            },
          ],
        })
      );
    });

    // First attempt answers the way requireCapability does for a STEP_UP
    // capability; the retry carries the token.
    await page.route(`${API}/support/access-requests/r1/approve`, (route) => {
      const request = route.request();
      const token = request.headers()["x-step-up-token"] ?? null;
      calls.sent.push({ method: request.method(), url: request.url(), body: null, stepUp: token });
      if (!token) {
        return route.fulfill({
          status: 403,
          contentType: "application/json",
          body: JSON.stringify({
            success: false,
            error: {
              code: "FORBIDDEN",
              message: "Confirm your password to continue.",
              details: { capability: "support.grant.create", requiresStepUp: true },
            },
          }),
        });
      }
      approved = true;
      return route.fulfill(json({ request: { id: "r1", status: "APPROVED" }, grant: { id: "g1" } }));
    });
    await page.route(`${API}/auth/step-up`, (route) =>
      route.fulfill(json({ stepUpToken: "fresh-step-up-token" }))
    );

    await page.goto("/owner/support-access");
    await expect(page.getByText(/agent@zoikosupport.test/)).toBeVisible({ timeout: 60_000 });

    await page.getByRole("button", { name: "Approve" }).click();

    // The dialog appears because the first call was refused, not because the
    // screen guessed it would be.
    await page.getByLabel("Password", { exact: true }).fill("Password123!");
    await page.getByRole("button", { name: "Confirm and continue" }).click();

    await expect.poll(() => calls.sent.filter((c) => c.stepUp).length).toBeGreaterThan(0);
    // Two attempts: one refused without a token, one carrying it.
    expect(calls.sent.filter((c) => c.url.includes("/approve")).length).toBeGreaterThanOrEqual(2);
  });
});
