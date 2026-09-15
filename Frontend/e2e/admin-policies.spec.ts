import { test, expect, type Page, type Route } from "@playwright/test";

/**
 * Policies, which showed a list of toggles that could not exist.
 *
 * The screen built its toggles by filtering a policy's rules object for
 * boolean values. `policyRulesSchema` is `{ defaultEffect, conditions[] }` —
 * no rule is ever a boolean — so the list was empty in every workspace and
 * always had been. Behind them sat optimistic local state, so had one ever
 * appeared, flipping it would have changed nothing and reverted on refresh.
 *
 * The screen now shows what a policy is and offers the one write the model
 * supports in a single control: the default effect, which decides everything
 * the conditions do not.
 */

const API = "**/api/v1";

const ADMIN_CAPABILITIES = [
  "mail.own.rw",
  "commitments.own.manage",
  "people.read",
  "workspace.settings.read",
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

function policy(over: Record<string, unknown> = {}) {
  return {
    id: "p1",
    type: "AI",
    name: "AI governance",
    description: "What the assistant may act on",
    version: 3,
    status: "ACTIVE",
    rules: {
      defaultEffect: "DENY",
      conditions: [
        { field: "mailbox.eligible", operator: "EQUALS", value: true, effect: "ALLOW" },
      ],
    },
    ...over,
  };
}

interface Calls {
  sent: Array<{ method: string; url: string; body: unknown }>;
}

async function openPolicies(
  page: Page,
  opts: { policies?: unknown[]; capabilities?: string[] } = {}
): Promise<Calls> {
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
    route.fulfill(
      json({ capabilities: opts.capabilities ?? ADMIN_CAPABILITIES, decisions: [] })
    )
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
    // The create returns the new version's id, which the activate then uses.
    return route.fulfill(json({ id: "p2" }));
  };

  await page.route(/\/api\/v1\/policies\/[^/]+\/activate$/, record);
  await page.route(/\/api\/v1\/policies(\?|$)/, (route) =>
    route.request().method() === "GET"
      ? route.fulfill(json({ policies: opts.policies ?? [policy()] }))
      : record(route)
  );

  await page.goto("/login");
  await page.getByPlaceholder("john@example.com").fill("admin@zoiko.test");
  await page.getByPlaceholder("Enter your password").fill("Password123!");
  await page.getByRole("button", { name: "Sign In", exact: true }).click();
  await expect(page).toHaveURL(/\/admin$/, { timeout: 60_000 });

  await page.goto("/admin/policies");
  await expect(page.getByRole("heading", { name: "Policies" })).toBeVisible();
  return calls;
}

const wrote = (calls: Calls, method: string, fragment: string) =>
  calls.sent.find((call) => call.method === method && call.url.includes(fragment));

test.describe("what a policy actually is", () => {
  test("shows the default effect and the conditions, not an empty toggle list", async ({
    page,
  }) => {
    await openPolicies(page);

    await expect(page.getByText("Default effect")).toBeVisible();
    await expect(page.getByText("mailbox.eligible")).toBeVisible();
    await expect(page.getByText("is one of")).toHaveCount(0);
    await expect(page.getByText("v3")).toBeVisible();
  });

  test("a tenant with no policy says evaluation fails closed", async ({ page }) => {
    await openPolicies(page, { policies: [] });

    await expect(page.getByText(/fails closed/)).toBeVisible();
  });

  test("a policy that is not the active version is labelled", async ({ page }) => {
    await openPolicies(page, { policies: [policy({ status: "DRAFT" })] });

    await expect(page.getByText("Draft")).toBeVisible();
  });
});

test.describe("editing a policy", () => {
  test("saves the default effect and carries the conditions across", async ({ page }) => {
    const calls = await openPolicies(page);

    await page.getByRole("button", { name: "Edit" }).click();
    await page.getByLabel(/Default effect/).selectOption("ALLOW");
    await page.getByRole("button", { name: /Save as v4/ }).click();

    // Superseded rather than edited, which is what the model does.
    await expect.poll(() => wrote(calls, "POST", "/policies")?.body).toMatchObject({
      type: "AI",
      name: "AI governance",
      rules: {
        defaultEffect: "ALLOW",
        // Sending only the changed field would drop every condition the
        // policy had, which is the difference between narrowing a policy
        // and removing it.
        conditions: [
          { field: "mailbox.eligible", operator: "EQUALS", value: true, effect: "ALLOW" },
        ],
      },
    });

    await expect
      .poll(() => Boolean(wrote(calls, "POST", "/policies/p2/activate")))
      .toBe(true);
  });

  test("adds a condition", async ({ page }) => {
    const calls = await openPolicies(page);

    await page.getByRole("button", { name: "Edit" }).click();
    await page.getByRole("button", { name: "Add condition" }).click();
    await page.getByLabel("Condition 2 field").fill("actor.role");
    await page.getByLabel("Condition 2 operator").selectOption("IN");
    await page.getByLabel("Condition 2 value").fill("OWNER, ADMIN");
    await page.getByLabel("Condition 2 effect").selectOption("DENY");
    await page.getByRole("button", { name: /Save as/ }).click();

    await expect
      .poll(() => (wrote(calls, "POST", "/policies")?.body as { rules?: { conditions?: unknown[] } })?.rules?.conditions)
      .toEqual([
        { field: "mailbox.eligible", operator: "EQUALS", value: true, effect: "ALLOW" },
        // A list operator takes a list. Sending "OWNER, ADMIN" as one string
        // would make a condition that matches a literal with a comma in it,
        // so it would never fire and nothing would say why.
        { field: "actor.role", operator: "IN", value: ["OWNER", "ADMIN"], effect: "DENY" },
      ]);
  });

  test("removes a condition", async ({ page }) => {
    const calls = await openPolicies(page);

    await page.getByRole("button", { name: "Edit" }).click();
    await page.getByRole("button", { name: "Remove condition 1" }).click();
    await page.getByRole("button", { name: /Save as/ }).click();

    await expect
      .poll(() => (wrote(calls, "POST", "/policies")?.body as { rules?: { conditions?: unknown[] } })?.rules?.conditions)
      .toEqual([]);
  });

  test("refuses a field that is not a path, without asking the server", async ({ page }) => {
    const calls = await openPolicies(page);

    await page.getByRole("button", { name: "Edit" }).click();
    await page.getByLabel("Condition 1 field").fill("9 not a field");
    await page.getByRole("button", { name: /Save as/ }).click();

    await expect(page.getByText(/a dotted path like mailbox.eligible/)).toBeVisible();
    expect(wrote(calls, "POST", "/policies")).toBeUndefined();
  });

  test("an abandoned edit does not become the next starting point", async ({ page }) => {
    const calls = await openPolicies(page);

    await page.getByRole("button", { name: "Edit" }).click();
    await page.getByLabel(/Default effect/).selectOption("ALLOW");
    await page.getByRole("button", { name: "Cancel" }).click();

    await page.getByRole("button", { name: "Edit" }).click();
    await page.getByRole("button", { name: /Save as/ }).click();

    // Re-seeded from the server, so the discarded ALLOW is not silently saved.
    await expect
      .poll(() => (wrote(calls, "POST", "/policies")?.body as { rules?: { defaultEffect?: string } })?.rules?.defaultEffect)
      .toBe("DENY");
  });

  test("is not offered without policy.write", async ({ page }) => {
    await openPolicies(page, {
      capabilities: ADMIN_CAPABILITIES.filter((c) => c !== "policy.write"),
    });

    await expect(page.getByRole("button", { name: "Edit" })).toHaveCount(0);
    await expect(page.getByText(/You can read policy but not change it/)).toBeVisible();
  });
});
