import { test, expect, type Page } from "@playwright/test";

/**
 * The support console itself — P2-6.
 *
 * The workspace holding the platform's most sensitive screens had two browser
 * tests, both about polling. Nothing covered the console rendering, the
 * boundary around it, or the two RBAC §2 controls that reach furthest into a
 * customer's workspace.
 *
 * Written against what the browser does rather than what it draws where that
 * is the thing at risk: which request leaves, whether a refusal turns into
 * something the agent can act on, whether a screen that should not exist for
 * this role is absent. A test asserting on layout would pass a redesign that
 * quietly widened access, which is the failure worth catching here.
 */

const API = "**/api/v1";

const json = (data: unknown) => ({
  status: 200,
  contentType: "application/json",
  body: JSON.stringify({ success: true, data }),
});

const forbidden = (message: string, details: Record<string, unknown> = {}) => ({
  status: 403,
  contentType: "application/json",
  body: JSON.stringify({ success: false, error: { code: "FORBIDDEN", message, details } }),
});

interface Sent {
  method: string;
  url: string;
  body: unknown;
}

async function signIn(
  page: Page,
  role: "SUPPORT" | "OWNER" | "ADMIN",
  capabilities: string[] = []
): Promise<Sent[]> {
  const sent: Sent[] = [];
  const workspace = role === "SUPPORT" ? "SUPPORT" : role;
  const session = {
    accessToken: "stub-access-token",
    refreshToken: "stub-refresh-token",
    expiresIn: "12h",
    user: { id: "u1", email: `${role.toLowerCase()}@zoiko.test`, displayName: "Test" },
    tenant: { id: "t1", name: "Acme Corp", planCode: "starter" },
    membership: { id: "m1", role },
    workspace,
  };

  await page.route(`${API}/**`, (route) => {
    const request = route.request();
    sent.push({
      method: request.method(),
      url: request.url(),
      body: request.postDataJSON?.() ?? null,
    });
    return route.fulfill(json({ items: [], count: 0 }));
  });
  await page.route(`${API}/auth/login`, (route) =>
    route.fulfill(json({ state: "SIGNED_IN", session, ...session }))
  );
  await page.route(`${API}/auth/me`, (route) =>
    route.fulfill(
      json({ ...session.user, tenant: session.tenant, membership: session.membership, workspace })
    )
  );
  await page.route(`${API}/users/me/capabilities`, (route) =>
    route.fulfill(json({ capabilities, decisions: [] }))
  );

  await page.goto("/login");
  await page.getByPlaceholder("john@example.com").fill(session.user.email);
  await page.getByPlaceholder("Enter your password").fill("Password123!");
  await page.getByRole("button", { name: "Sign In", exact: true }).click();
  await expect(page).toHaveURL(role === "SUPPORT" ? /\/support$/ : /\/owner/, { timeout: 60_000 });
  return sent;
}

/** A granted seat: the console answers, and the overview has something in it. */
async function grantConsole(page: Page, over: Record<string, unknown> = {}) {
  await page.route(`${API}/support/overview`, (route) =>
    route.fulfill(
      json({
        stats: {
          members: 12,
          mailboxes: 9,
          domains: 2,
          activeGrants: 1,
          openCommitments: 0,
          issues: 0,
          failedMessages24h: 3,
          failedDeliveries24h: 1,
          retryJobs: 0,
          failedJobs: 0,
          deliveryEvents24h: 41,
        },
        // The overview view reads every one of these with `.length`, so an
        // incomplete fixture crashes the console rather than failing an
        // assertion — which looks exactly like a product bug until you read
        // the page errors.
        members: [],
        team: [],
        issues: [],
        audit: [],
        grants: [
          {
            id: "g1",
            tenantId: "t1",
            supportMembershipId: "sm1",
            approvedByUserId: "u9",
            reason: "INC-4471 delivery failures",
            scopes: ["TENANT_DIAGNOSTICS"],
            expiresAt: new Date(Date.now() + 45 * 60_000).toISOString(),
            revokedAt: null,
            createdAt: new Date().toISOString(),
          },
        ],
        ...over,
      })
    )
  );
}

test.describe("the console renders for a granted seat", () => {
  test("shows the workspace it was granted, and the grant's own clock", async ({ page }) => {
    await signIn(page, "SUPPORT", ["support.console.read", "support.workspace.investigate"]);
    await grantConsole(page);

    await page.goto("/support");

    // The overview, not the request form — the difference between a seat
    // that holds access and one that does not.
    await expect(page.getByRole("heading", { name: "Workspace Overview" })).toBeVisible({ timeout: 60_000 });
    await expect(page.getByRole("heading", { name: /Ask for access/i })).toHaveCount(0);

    // §7 requires every grant to expire. A console that does not say when
    // leaves the agent to discover it by being cut off mid-investigation.
    await expect(page.getByText(/\d+\s*m|expires|ends/i).first()).toBeVisible();
  });

  test("offers the tabs the console is for, including the two recovered controls", async ({
    page,
  }) => {
    await signIn(page, "SUPPORT", ["support.console.read", "support.workspace.investigate"]);
    await grantConsole(page);
    await page.goto("/support");
    await expect(page.getByRole("heading", { name: "Workspace Overview" })).toBeVisible({ timeout: 60_000 });

    for (const label of ["Configuration", "Mailboxes", "Domains", "Audit Logs"]) {
      await expect(page.getByRole("button", { name: new RegExp(label, "i") }).first()).toBeVisible();
    }
  });
});

test.describe("the boundary around it", () => {
  test("a seat with no grant is refused everything and offered a way to ask", async ({ page }) => {
    await signIn(page, "SUPPORT", ["support.console.read", "support.workspace.investigate"]);

    for (const path of ["overview", "configuration", "tenant", "mailboxes"]) {
      await page.route(`${API}/support/${path}*`, (route) =>
        route.fulfill(
          forbidden("This workspace needs an approved support access grant.", {
            capability: "support.workspace.investigate",
            requiresSupportGrant: true,
          })
        )
      );
    }

    await page.goto("/support");

    // The console still opens: tickets need no grant, and landing a seat on
    // a wall of 403s would hide the work the Owner's invitation authorized.
    await expect(page.getByRole("button", { name: /Tickets/i }).first()).toBeVisible({
      timeout: 60_000,
    });

    // The diagnostics tab is where the refusal lives, and it has to become
    // a next step rather than a load error — otherwise the only route to a
    // first grant is somebody calling the API by hand.
    await page.getByRole("button", { name: /Workspace Overview/i }).first().click();
    await expect(page.getByRole("heading", { name: /Ask for access/i })).toBeVisible({
      timeout: 60_000,
    });
  });

  test("the console asks only about its own workspace", async ({ page }) => {
    const sent = await signIn(page, "SUPPORT", ["support.console.read", "support.workspace.investigate"]);
    await grantConsole(page);
    await page.goto("/support");
    await expect(page.getByRole("heading", { name: "Workspace Overview" })).toBeVisible({ timeout: 60_000 });

    // Tenant scoping is the server's job, but the tenant console must not be
    // reaching for the fleet-wide routes in the first place — those are
    // staff-only and mounted before this router precisely so they never
    // enter it. A request to one from here is a bug wherever it is refused.
    const platform = sent.filter((s) => s.url.includes("/support/platform"));
    expect(platform).toEqual([]);

    // And nothing carries another workspace's id.
    const crossTenant = sent.filter(
      (s) => /[?&]tenantId=/.test(s.url) && !s.url.includes("tenantId=t1")
    );
    expect(crossTenant).toEqual([]);
  });

  test("a grant that expires mid-session takes the data off the screen", async ({ page }) => {
    test.setTimeout(180_000);
    await signIn(page, "SUPPORT", ["support.console.read", "support.workspace.investigate"]);
    await grantConsole(page);

    let granted = true;
    await page.route(`${API}/support/jobs*`, (route) =>
      granted
        ? route.fulfill(
            json({
              jobs: [
                {
                  id: "j1",
                  type: "MAILBOX_SYNC",
                  tenantId: "t1",
                  status: "FAILED",
                  attempts: 3,
                  maxAttempts: 3,
                  runAt: new Date().toISOString(),
                  lockedAt: null,
                  completedAt: null,
                  lastError: "PROVIDER_TIMEOUT",
                  createdAt: new Date().toISOString(),
                  updatedAt: new Date().toISOString(),
                },
              ],
            })
          )
        : route.fulfill(
            forbidden("This workspace needs an approved support access grant.", {
              capability: "support.workspace.investigate",
              requiresSupportGrant: true,
            })
          )
    );

    await page.goto("/support");
    await expect(page.getByRole("heading", { name: "Workspace Overview" })).toBeVisible({
      timeout: 60_000,
    });
    await page.getByRole("button", { name: /Jobs/i }).first().click();
    await expect(page.getByText("PROVIDER_TIMEOUT").first()).toBeVisible();

    granted = false;

    // A refetch of the *same* cache key, which is the case that strands
    // data: the cache keeps the last good result for a key when a later
    // read of it fails, so the rows outlive the refusal unless something
    // drops them. Changing a filter would not show this — that makes a new
    // key, which has nothing to strand.
    //
    // Driven through the visibility guard because that is what the live
    // refresh listens to, and a headless browser keeps every page visible,
    // so the property has to be overridden rather than the tab backgrounded.
    await page.evaluate(() => {
      Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "hidden" });
      document.dispatchEvent(new Event("visibilitychange"));
      Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "visible" });
      document.dispatchEvent(new Event("visibilitychange"));
    });

    // §7 makes the expiry the control, not a note about one. A console
    // holding the last good page under an error banner is still showing a
    // customer's data after the grant that allowed it has ended.
    await expect(page.getByText(/approved support access grant/i).first()).toBeVisible({
      timeout: 60_000,
    });
    await expect(page.getByText("PROVIDER_TIMEOUT")).toHaveCount(0);
  });

  test("an owner does not get the support console", async ({ page }) => {
    await signIn(page, "OWNER", ["support.grant.read", "support.grant.create"]);

    // /support admits exactly two actors: Zoiko staff, and a workspace's own
    // SUPPORT member. An Owner is neither — their console is /owner, and the
    // one thing that must not happen is the tenant support console rendering
    // for a session it was not built for.
    await page.goto("/support");

    await expect(page.getByText(/don.t have access to the Support Dashboard/i)).toBeVisible({
      timeout: 60_000,
    });
    await expect(page.getByRole("heading", { name: "Workspace Overview" })).toHaveCount(0);
  });
});

test.describe("reading inside a mailbox", () => {
  test("says why it was refused instead of looking empty", async ({ page }) => {
    await signIn(page, "SUPPORT", ["support.console.read", "support.workspace.investigate"]);
    await grantConsole(page);

    await page.route(`${API}/support/mailboxes?*`, (route) =>
      route.fulfill(
        json({
          mailboxes: [
            {
              id: "mb1",
              address: "devon@acme.test",
              tenantId: "t1",
              memberName: "Devon",
              memberEmail: "devon@acme.test",
              suspended: false,
              suspensionReason: null,
              createdAt: new Date().toISOString(),
              mailboxType: "USER",
              connectedAccounts: [],
            },
          ],
        })
      )
    );
    await page.route(`${API}/support/mailboxes/mb1/messages*`, (route) =>
      route.fulfill(
        forbidden(
          "Reading a mailbox needs a support access grant that covers mail content. Ask the workspace owner to approve one.",
          { capability: "mail.other.read", requiresSupportGrant: true }
        )
      )
    );

    await page.goto("/support");
    await expect(page.getByRole("heading", { name: "Workspace Overview" })).toBeVisible({ timeout: 60_000 });
    await page.getByRole("button", { name: /Mailboxes/i }).first().click();

    await expect(page.getByText("devon@acme.test").first()).toBeVisible();
    await page.getByRole("button", { name: "Open" }).first().click();

    // The distinction that matters on a support call: "I am not allowed to
    // look" is a different sentence to the customer than "there is nothing
    // there", and a screen that renders an empty table for both makes the
    // agent say the wrong one.
    await expect(page.getByText(/grant that covers mail content/i)).toBeVisible();
  });

  test("shows headers, and withholds subjects for a restricted mailbox", async ({ page }) => {
    await signIn(page, "SUPPORT", ["support.console.read", "support.workspace.investigate"]);
    await grantConsole(page);

    await page.route(`${API}/support/mailboxes?*`, (route) =>
      route.fulfill(
        json({
          mailboxes: [
            {
              id: "mb1",
              address: "devon@acme.test",
              tenantId: "t1",
              memberName: "Devon",
              memberEmail: "devon@acme.test",
              suspended: false,
              suspensionReason: null,
              createdAt: new Date().toISOString(),
              mailboxType: "USER",
              connectedAccounts: [],
            },
          ],
        })
      )
    );
    await page.route(`${API}/support/mailboxes/mb1/messages*`, (route) =>
      route.fulfill(
        json({
          mailbox: {
            id: "mb1",
            address: "devon@acme.test",
            type: "USER",
            // AC-008: the owner has turned processing off.
            aiEnabled: false,
            sendSuspendedAt: null,
            sendSuspensionReason: null,
            owner: { email: "devon@acme.test", displayName: "Devon" },
          },
          grant: { id: "g1", expiresAt: new Date(Date.now() + 45 * 60_000).toISOString() },
          messages: [
            {
              id: "m1",
              folder: "INBOX",
              isRead: false,
              receivedAt: new Date().toISOString(),
              subject: "[subject withheld — restricted mailbox]",
              from: "billing@supplier.test",
              to: ["devon@acme.test"],
              status: "DELIVERED",
              attachments: 1,
            },
          ],
        })
      )
    );

    await page.goto("/support");
    await expect(page.getByRole("heading", { name: "Workspace Overview" })).toBeVisible({ timeout: 60_000 });
    await page.getByRole("button", { name: /Mailboxes/i }).first().click();
    await page.getByRole("button", { name: "Open" }).first().click();

    // The metadata triage runs on is there.
    await expect(page.getByText("billing@supplier.test")).toBeVisible();
    // The subject is not, and the screen says so rather than showing a blank
    // cell the agent would read as "no subject".
    await expect(page.getByText(/withheld/i).first()).toBeVisible();
    // And the agent is told this read is on the record.
    await expect(page.getByText(/audit log/i).first()).toBeVisible();
  });
});
