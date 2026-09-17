import { test, expect, type Page, type Route } from "@playwright/test";

/**
 * The admin controls that looked live and did nothing.
 *
 * Every screen below rendered a button, styled it, capability-gated it, and
 * wired it to nothing: Manage on a user row, Revoke on an invitation, Replay
 * on a dead-lettered provider event. Notifications went one worse — it marked
 * read into a local Set, so the alert cleared, the rail badge never moved, and
 * a refresh brought it back.
 *
 * None of that is visible to a type check or a backend test. The API was
 * correct and idle; the UI simply never called it. So the assertions here are
 * about requests actually leaving the browser, not about what the page shows
 * afterwards — a screen can look right and still be inert, which is the exact
 * failure being fixed.
 */

const API = "**/api/v1";

const ADMIN_CAPABILITIES = [
  "mail.own.rw",
  "commitments.own.manage",
  "people.read",
  "people.invite.member",
  "people.member.manage",
  "people.admin.manage",
  "workspace.settings.read",
  "workspace.settings.write",
  "workspace.mailboxes.manage",
  "workspace.domains.manage",
  "workspace.groups.manage",
  "policy.write",
  "audit.read",
];

const json = (data: unknown) => ({
  status: 200,
  contentType: "application/json",
  body: JSON.stringify({ success: true, data }),
});

interface MemberOverrides {
  id?: string;
  role?: string;
  status?: string;
  email?: string;
  name?: string;
}

function member(over: MemberOverrides = {}) {
  const id = over.id ?? "m2";
  return {
    id,
    role: over.role ?? "MEMBER",
    status: over.status ?? "ACTIVE",
    createdAt: "2026-09-01T09:00:00.000Z",
    updatedAt: "2026-09-01T09:00:00.000Z",
    user: {
      id: `u-${id}`,
      email: over.email ?? "dana@zoiko.test",
      displayName: over.name ?? "Dana Reed",
      mfaEnrolledAt: null,
    },
  };
}

/** Requests the page sent, so a control can be proven to reach the server. */
interface Calls {
  sent: Array<{ method: string; url: string; body: unknown }>;
}

interface SignInOptions {
  members?: unknown[];
  notifications?: unknown[];
  deadLetter?: unknown[];
  mailboxes?: unknown[];
  unread?: Record<string, number>;
}

async function signInAsAdmin(page: Page, opts: SignInOptions = {}): Promise<Calls> {
  const calls: Calls = { sent: [] };

  // Catch-all first: Playwright consults routes in reverse registration order,
  // so everything registered below wins over this.
  //
  // Every pattern below is anchored to /api/v1. An unanchored one also
  // matches the app's own URLs — /admin/notifications ends with
  // "/notifications" — and fulfils the page navigation with JSON, so the
  // browser renders the response body instead of the screen under test.
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
    route.fulfill(json({ capabilities: ADMIN_CAPABILITIES, decisions: [] }))
  );
  await page.route(`${API}/tenants/current`, (route) =>
    route.fulfill(
      json({
        id: "t1",
        name: "Acme Corp",
        status: "ACTIVE",
        planCode: "starter",
        timezone: "Europe/London",
        allowedDomains: ["acme.test"],
      })
    )
  );

  const members = opts.members ?? [
    member({ id: "m1", role: "ADMIN", email: "admin@zoiko.test", name: "Admin" }),
    member(),
  ];

  // Writes are recorded and answered, so the assertions can be about the call.
  const record = (route: Route) => {
    const request = route.request();
    calls.sent.push({
      method: request.method(),
      url: request.url(),
      body: request.postDataJSON?.() ?? null,
    });
    return route.fulfill(json({ ok: true }));
  };

  await page.route(/\/api\/v1\/membership\/members(\?|$)/, (route) =>
    route.request().method() === "GET" ? route.fulfill(json({ members })) : record(route)
  );
  await page.route(/\/api\/v1\/membership\/members\/[^/]+$/, record);
  await page.route(/\/api\/v1\/membership\/invitations\/[^/]+$/, record);
  await page.route(/\/api\/v1\/notifications\/[^/]+\/read$/, record);
  await page.route(/\/api\/v1\/connectors\/dead-letter\/[^/]+\/replay$/, record);

  await page.route(/\/api\/v1\/notifications(\?|$)/, (route) =>
    route.fulfill(json({ notifications: opts.notifications ?? [] }))
  );
  await page.route(/\/api\/v1\/connectors\/dead-letter$/, (route) =>
    route.fulfill(json({ events: opts.deadLetter ?? [] }))
  );
  await page.route(/\/api\/v1\/connectors\/admin/, (route) => route.fulfill(json({ accounts: [] })));
  await page.route(/\/api\/v1\/mail\/unread-counts/, (route) =>
    route.fulfill(json({ counts: opts.unread ?? {} }))
  );
  await page.route(/\/api\/v1\/mail\/admin\/mailboxes(\?|$)/, (route) =>
    route.fulfill(json({ mailboxes: opts.mailboxes ?? [] }))
  );
  await page.route(/\/api\/v1\/domains(\?|$)/, (route) => route.fulfill(json({ domains: [] })));

  await page.goto("/login");
  await page.getByPlaceholder("john@example.com").fill("admin@zoiko.test");
  await page.getByPlaceholder("Enter your password").fill("Password123!");
  await page.getByRole("button", { name: "Sign In", exact: true }).click();
  await expect(page).toHaveURL(/\/admin$/, { timeout: 60_000 });

  return calls;
}

const wrote = (calls: Calls, method: string, fragment: string) =>
  calls.sent.find((call) => call.method === method && call.url.includes(fragment));

async function openManage(page: Page, name: RegExp) {
  await page.goto("/admin/users");
  await page.getByRole("row", { name }).getByRole("button", { name: "Manage" }).click();
}

test.describe("managing a member", () => {
  test("changing a role sends the new role to the server", async ({ page }) => {
    const calls = await signInAsAdmin(page);
    await openManage(page, /Dana Reed/);
    await expect(page.getByText("Manage Dana Reed")).toBeVisible();

    await page.getByLabel("Role").selectOption("ADMIN");
    await page.getByRole("button", { name: "Save role" }).click();

    await expect
      .poll(() => wrote(calls, "PATCH", "/membership/members/m2")?.body)
      .toEqual({ role: "ADMIN" });
  });

  test("save stays disabled until the role actually changes", async ({ page }) => {
    await signInAsAdmin(page);
    await openManage(page, /Dana Reed/);

    // Saving an unchanged role would write a no-op and leave an audit event
    // for a change nobody made.
    await expect(page.getByRole("button", { name: "Save role" })).toBeDisabled();
  });

  test("suspending sends a status, not a role", async ({ page }) => {
    const calls = await signInAsAdmin(page);
    await openManage(page, /Dana Reed/);

    await page.getByRole("button", { name: "Suspend", exact: true }).click();

    await expect
      .poll(() => wrote(calls, "PATCH", "/membership/members/m2")?.body)
      .toEqual({ status: "SUSPENDED" });
  });

  test("removal asks first, and says it is not a suspension", async ({ page }) => {
    const calls = await signInAsAdmin(page);
    await openManage(page, /Dana Reed/);

    await page.getByRole("button", { name: "Remove", exact: true }).click();
    await expect(page.getByText("Remove Dana Reed?")).toBeVisible();
    await expect(page.getByText(/Suspend instead/)).toBeVisible();

    // Nothing is sent until the confirmation is answered.
    expect(wrote(calls, "DELETE", "/membership/members/m2")).toBeUndefined();

    await page.getByRole("button", { name: "Remove member" }).click();
    await expect
      .poll(() => Boolean(wrote(calls, "DELETE", "/membership/members/m2")))
      .toBe(true);
  });

  test("Manage is refused on an Owner", async ({ page }) => {
    await signInAsAdmin(page, {
      members: [
        member({ id: "m1", role: "ADMIN", email: "admin@zoiko.test", name: "Admin" }),
        member({ id: "m9", role: "OWNER", email: "owner@zoiko.test", name: "Olive Owner" }),
      ],
    });
    await page.goto("/admin/users");

    await expect(
      page.getByRole("row", { name: /Olive Owner/ }).getByRole("button", { name: "Manage" })
    ).toBeDisabled();
  });

  test("the inert Export button is gone", async ({ page }) => {
    await signInAsAdmin(page);
    await page.goto("/admin/users");

    // It was wired to nothing and there is no roster export endpoint to wire
    // it to. An absent control is honest; a dead one is not.
    await expect(page.getByRole("button", { name: "Export" })).toHaveCount(0);
  });
});

test.describe("revoking an invitation", () => {
  test("asks first, then deletes the membership the invitation is", async ({ page }) => {
    const calls = await signInAsAdmin(page, {
      members: [
        member({ id: "m1", role: "ADMIN", email: "admin@zoiko.test", name: "Admin" }),
        member({ id: "inv1", status: "INVITED", email: "newcomer@zoiko.test", name: "Newcomer" }),
      ],
    });
    await page.goto("/admin/invitations");

    await page.getByRole("button", { name: "Revoke" }).click();
    await expect(page.getByText("Revoke this invitation?")).toBeVisible();
    expect(wrote(calls, "DELETE", "/membership/invitations/inv1")).toBeUndefined();

    await page.getByRole("button", { name: "Revoke invitation" }).click();
    await expect
      .poll(() => Boolean(wrote(calls, "DELETE", "/membership/invitations/inv1")))
      .toBe(true);
  });

  test("the dead second invite form is gone", async ({ page }) => {
    await signInAsAdmin(page);
    await page.goto("/admin/invitations");

    // An email box, a role select and a Send invitation button sat under the
    // dialog that actually works, wired to nothing.
    await expect(page.getByRole("button", { name: "Send invitation" })).toHaveCount(0);
    await expect(page.getByPlaceholder("name@acme.test")).toHaveCount(0);
  });
});

test.describe("notifications", () => {
  const alert = {
    id: "n1",
    title: "Domain verification failed",
    body: "acme.test could not be verified.",
    severity: "WARNING",
    readAt: null,
    createdAt: "2026-09-01T09:00:00.000Z",
  };

  test("mark read reaches the server rather than a local Set", async ({ page }) => {
    const calls = await signInAsAdmin(page, { notifications: [alert] });
    await page.goto("/admin/notifications");

    await page.getByRole("button", { name: "Mark read" }).click();

    await expect
      .poll(() => Boolean(wrote(calls, "PATCH", "/notifications/n1/read")))
      .toBe(true);
  });

  test("mark all read sends one call per unread notification", async ({ page }) => {
    const calls = await signInAsAdmin(page, {
      notifications: [alert, { ...alert, id: "n2", title: "Connector needs re-auth" }],
    });
    await page.goto("/admin/notifications");

    await page.getByRole("button", { name: "Mark all read" }).click();

    await expect
      .poll(() => Boolean(wrote(calls, "PATCH", "/notifications/n1/read")))
      .toBe(true);
    await expect
      .poll(() => Boolean(wrote(calls, "PATCH", "/notifications/n2/read")))
      .toBe(true);
  });
});

test.describe("provider sync", () => {
  test("replay re-queues the dead-lettered event", async ({ page }) => {
    const calls = await signInAsAdmin(page, {
      deadLetter: [
        {
          id: "ev1",
          provider: "GMAIL",
          eventType: "TEMPORARY_FAILURE",
          errorCode: "PROVIDER_UNAVAILABLE",
          receivedAt: "2026-09-01T09:00:00.000Z",
        },
      ],
    });
    await page.goto("/admin/provider-sync");

    await page.getByRole("button", { name: "Replay" }).click();

    await expect
      .poll(() => Boolean(wrote(calls, "POST", "/connectors/dead-letter/ev1/replay")))
      .toBe(true);
  });
});

test.describe("rail badges", () => {
  test("Groups and Inbox do not show a template default", async ({ page }) => {
    // Neither had an entry in the counts hook, so both kept the numbers
    // written into the nav template: Groups read 4 and Inbox read 12 in every
    // workspace, forever.
    await signInAsAdmin(page, { mailboxes: [], unread: {} });

    const rail = page.getByRole("navigation", { name: "Admin sections" });
    await expect(rail.getByRole("link", { name: /Groups/ })).not.toContainText("4");
    await expect(rail.getByRole("link", { name: /Inbox/ })).not.toContainText("12");
  });

  test("a real unread count is shown when there is one", async ({ page }) => {
    await signInAsAdmin(page, { unread: { INBOX: 3 } });

    const rail = page.getByRole("navigation", { name: "Admin sections" });
    await expect(rail.getByRole("link", { name: /Inbox/ })).toContainText("3");
  });
});
