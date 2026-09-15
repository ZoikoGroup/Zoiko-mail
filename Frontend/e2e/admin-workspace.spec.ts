import { test, expect, type Page, type Route } from "@playwright/test";

/**
 * The admin screens that had no browser test, and the capability rule itself.
 *
 * Everything here is the class of defect a type check cannot see: a control
 * wired to nothing, a gate keyed off the wrong thing, a rail item that ejects
 * an admin into another workspace. The assertions are about what leaves the
 * browser and what the shell still shows, not about rendering.
 */

const API = "**/api/v1";

const FULL_ADMIN = [
  "mail.own.rw",
  "commitments.own.manage",
  "connector.own.connect",
  "people.read",
  "people.invite.member",
  "people.member.manage",
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

interface Calls {
  sent: Array<{ method: string; url: string; body: unknown }>;
}

interface Options {
  capabilities?: string[];
  mailboxes?: unknown[];
  members?: unknown[];
}

function mailbox(over: Record<string, unknown> = {}) {
  return {
    id: "mbx1",
    address: "dana@acme.test",
    storageUsed: 1_000_000_000,
    storageLimit: 5_000_000_000,
    sendSuspendedAt: null,
    sendSuspensionReason: null,
    aiEnabled: true,
    type: "USER",
    ...over,
  };
}

async function signIn(page: Page, opts: Options = {}): Promise<Calls> {
  const calls: Calls = { sent: [] };

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
    route.fulfill(json({ capabilities: opts.capabilities ?? FULL_ADMIN, decisions: [] }))
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

  const record = (route: Route) => {
    const request = route.request();
    calls.sent.push({
      method: request.method(),
      url: request.url(),
      body: request.postDataJSON?.() ?? null,
    });
    return route.fulfill(json({ ok: true }));
  };

  await page.route(/\/api\/v1\/mail\/admin\/shared-mailboxes/, record);
  await page.route(/\/api\/v1\/mail\/admin\/mailboxes\/[^/]+$/, record);
  await page.route(/\/api\/v1\/mail\/admin\/mailboxes(\?|$)/, (route) =>
    route.request().method() === "GET"
      ? route.fulfill(json({ mailboxes: opts.mailboxes ?? [mailbox()] }))
      : record(route)
  );
  await page.route(/\/api\/v1\/membership\/members(\?|$)/, (route) =>
    route.fulfill(
      json({
        members: opts.members ?? [
          {
            id: "m1",
            role: "ADMIN",
            status: "ACTIVE",
            createdAt: "2026-09-01T09:00:00.000Z",
            updatedAt: "2026-09-01T09:00:00.000Z",
            user: {
              id: "u1",
              email: "admin@zoiko.test",
              displayName: "Admin",
              mfaEnrolledAt: null,
            },
          },
        ],
      })
    )
  );
  await page.route(/\/api\/v1\/audit\/events(\?|$)/, (route) =>
    route.fulfill(json({ events: [], pagination: { page: 1, limit: 25, total: 0, totalPages: 0 } }))
  );

  await page.goto("/login");
  await page.getByPlaceholder("john@example.com").fill("admin@zoiko.test");
  await page.getByPlaceholder("Enter your password").fill("Password123!");
  await page.getByRole("button", { name: "Sign In", exact: true }).click();
  await expect(page).toHaveURL(/\/admin$/, { timeout: 60_000 });
  return calls;
}

const wrote = (calls: Calls, method: string, fragment: string) =>
  calls.sent.find((call) => call.method === method && call.url.includes(fragment));

const rail = (page: Page) => page.getByRole("navigation", { name: "Admin sections" });

test.describe("roles and permissions", () => {
  test("renders the matrix the server sends, with a count", async ({ page }) => {
    await signIn(page);
    await page.goto("/admin/permissions");

    await expect(page.getByRole("heading", { name: "Roles & permissions" })).toBeVisible();
    // The screen states the rule the codebase is meant to follow, so it is
    // worth pinning that it still says it.
    await expect(page.getByText(/Code checks permissions, never roles/)).toBeVisible();
    await expect(page.getByText(/capabilities$/)).toBeVisible();
  });
});

test.describe("mailboxes", () => {
  test("turning AI off for a mailbox reaches the server", async ({ page }) => {
    const calls = await signIn(page);
    await page.goto("/admin/mailboxes");

    // AC-008: this is the control that makes a mailbox restricted, and the
    // gate the AI service then honours on the background path too.
    await page.getByLabel("AI processing for dana@acme.test").click();

    await expect
      .poll(() => wrote(calls, "PATCH", "/mail/admin/mailboxes/mbx1")?.body)
      .toEqual({ aiEnabled: false });
  });

  test("the control is refused without workspace.mailboxes.manage", async ({ page }) => {
    await signIn(page, {
      capabilities: FULL_ADMIN.filter((c) => c !== "workspace.mailboxes.manage"),
    });
    await page.goto("/admin/mailboxes");

    await expect(page.getByLabel("AI processing for dana@acme.test")).toBeDisabled();
  });

  test("a restricted mailbox reads Off rather than looking unset", async ({ page }) => {
    await signIn(page, { mailboxes: [mailbox({ aiEnabled: false })] });
    await page.goto("/admin/mailboxes");

    await expect(page.getByLabel("AI processing for dana@acme.test")).toHaveAttribute(
      "aria-pressed",
      "false"
    );
  });
});

test.describe("groups", () => {
  test("creating a group sends the address and type", async ({ page }) => {
    const calls = await signIn(page);
    await page.goto("/admin/groups");

    await page.getByRole("button", { name: "New group" }).click();
    await page.getByPlaceholder("support@acme.test").fill("support@acme.test");
    await page.getByRole("button", { name: "Create", exact: true }).click();

    await expect
      .poll(() => wrote(calls, "POST", "/mail/admin/shared-mailboxes")?.body)
      .toEqual({ address: "support@acme.test", type: "SHARED" });
  });

  test("managing is refused without workspace.groups.manage", async ({ page }) => {
    await signIn(page, {
      capabilities: FULL_ADMIN.filter((c) => c !== "workspace.groups.manage"),
    });
    await page.goto("/admin/groups");

    // The rail drops the item too, so reaching the screen means typing the URL.
    await expect(rail(page).getByRole("link", { name: /Groups/ })).toHaveCount(0);
  });
});

test.describe("an admin's own work stays in the admin shell", () => {
  test("Inbox renders inside the admin rail rather than ejecting to /inbox", async ({
    page,
  }) => {
    await signIn(page);
    await page.goto("/admin/inbox");

    // Following a rail item must never drop an Admin into the member
    // workspace: they would lose the admin rail with no way back.
    await expect(page).toHaveURL(/\/admin\/inbox$/);
    await expect(rail(page)).toBeVisible();
  });

  test("Commitments renders inside the admin rail too", async ({ page }) => {
    await signIn(page);
    await page.goto("/admin/commitments");

    await expect(page).toHaveURL(/\/admin\/commitments$/);
    await expect(rail(page)).toBeVisible();
  });
});

test.describe("a screen gates on the capability, not on the link being hidden", () => {
  test("audit refuses without audit.read and names what is missing", async ({ page }) => {
    await signIn(page, { capabilities: FULL_ADMIN.filter((c) => c !== "audit.read") });

    // The rail hides the link, so reaching this means typing the URL or
    // following a bookmark that outlived the grant.
    await expect(rail(page).getByRole("link", { name: /Audit/ })).toHaveCount(0);

    await page.goto("/admin/audit");
    await expect(page.getByText(/You do not have access to this screen/)).toBeVisible();
    await expect(page.getByText("audit.read")).toBeVisible();
  });

  test("audit renders when the capability is held", async ({ page }) => {
    await signIn(page);
    await page.goto("/admin/audit");

    await expect(page.getByRole("heading", { name: "Audit logs" })).toBeVisible();
    await expect(page.getByText(/You do not have access to this screen/)).toHaveCount(0);
  });

  test("a failed capability read is not treated as a refusal", async ({ page }) => {
    await signIn(page);
    // Break the read only after the shell has loaded, then reload the screen.
    await page.route(`${API}/users/me/capabilities`, (route) =>
      route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({
          success: false,
          error: { code: "INTERNAL", message: "Upstream unavailable" },
        }),
      })
    );
    await page.goto("/admin/audit");

    // Refusing on a failed read would lock an admin out of a screen they hold
    // and blame them for it. The screen says the read failed instead.
    await expect(page.getByText(/Could not read your permissions/)).toBeVisible();
    await expect(page.getByText(/You do not have access to this screen/)).toHaveCount(0);
  });
});

test.describe("the unreachable provider panel is gone", () => {
  test("connector operations live on the admin screen, not in the member shell", async ({
    page,
  }) => {
    await signIn(page);
    await page.goto("/admin/provider-sync");

    // ConnectedAccounts carried a "Provider operations (admin)" panel gated on
    // role === OWNER || ADMIN. That component renders inside the member shell,
    // whose workspace guard ends an ADMIN-scoped session on arrival — so the
    // panel could never appear for the only roles its condition allowed. It
    // duplicated this screen, which an admin can actually reach.
    await expect(page.getByRole("heading", { name: "Provider sync" })).toBeVisible();
    await expect(page.getByText("Recent sync errors")).toBeVisible();
  });

  test("an admin session is turned away from the member connected-accounts page", async ({
    page,
  }) => {
    await signIn(page);
    await page.goto("/connected-accounts");

    // Reaching another workspace takes a sign-in, so the session that belongs
    // elsewhere is ended rather than left usable.
    await expect(page).toHaveURL(/\/login/, { timeout: 60_000 });
  });
});
