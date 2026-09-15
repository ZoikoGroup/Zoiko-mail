import { test, expect, type Page, type Route } from "@playwright/test";

/**
 * Domains, which could be read and not managed.
 *
 * Five endpoints existed and none were wired: add, diagnostics, checks,
 * activate, delete. "Re-check now" was a styled button with no handler, so an
 * admin who published a TXT record had no way to tell the server to look
 * again — the screen could only report a check somebody else had triggered.
 *
 * As elsewhere, the assertions are about the request leaving the browser. A
 * button that renders and calls nothing looks exactly like one that works.
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

interface DomainOverrides {
  id?: string;
  domainName?: string;
  verificationStatus?: string;
  spfStatus?: string;
  dkimStatus?: string;
  dmarcStatus?: string;
  sendingEnabled?: boolean;
}

function domain(over: DomainOverrides = {}) {
  return {
    id: over.id ?? "d1",
    domainName: over.domainName ?? "acme.test",
    type: "CUSTOM",
    verificationStatus: over.verificationStatus ?? "PENDING",
    mxStatus: "VALID",
    spfStatus: over.spfStatus ?? "PENDING",
    dkimStatus: over.dkimStatus ?? "PENDING",
    dmarcStatus: over.dmarcStatus ?? "PENDING",
    lastCheckedAt: "2026-09-01T09:00:00.000Z",
    sendingEnabled: over.sendingEnabled ?? false,
    verificationToken: "zoiko-mail-verification=abc123",
  };
}

/** A domain with every check passing, so activation is offered. */
const verified = (over: DomainOverrides = {}) =>
  domain({
    verificationStatus: "VERIFIED",
    spfStatus: "VALID",
    dkimStatus: "VALID",
    dmarcStatus: "VALID",
    ...over,
  });

interface Calls {
  sent: Array<{ method: string; url: string; body: unknown }>;
}

async function openDomains(
  page: Page,
  opts: {
    domains?: unknown[];
    checks?: unknown[];
    failWith?: { status: number; message: string };
  } = {}
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

  const record = (route: Route) => {
    const request = route.request();
    calls.sent.push({
      method: request.method(),
      url: request.url(),
      body: request.postDataJSON?.() ?? null,
    });
    if (opts.failWith) {
      return route.fulfill({
        status: opts.failWith.status,
        contentType: "application/json",
        body: JSON.stringify({
          success: false,
          error: { code: "CONFLICT", message: opts.failWith.message },
        }),
      });
    }
    return route.fulfill(json({ ok: true }));
  };

  // Anchored to /api/v1 — /admin/domains ends with "/domains", and an
  // unanchored pattern would fulfil the page navigation itself with JSON.
  await page.route(/\/api\/v1\/domains\/[^/]+\/checks$/, (route) =>
    route.fulfill(
      json({
        checks: opts.checks ?? [
          {
            id: "c1",
            checkedAt: "2026-09-01T09:00:00.000Z",
            verificationStatus: "FAILED",
            mxStatus: "VALID",
            spfStatus: "VALID",
            dkimStatus: "INVALID",
            dmarcStatus: "PENDING",
            errorDetails: { dkim: "NXDOMAIN" },
          },
        ],
      })
    )
  );
  await page.route(/\/api\/v1\/domains\/[^/]+\/(diagnostics|activate)$/, record);
  await page.route(/\/api\/v1\/domains\/[^/]+$/, record);
  await page.route(/\/api\/v1\/domains(\?|$)/, (route) =>
    route.request().method() === "GET"
      ? route.fulfill(json({ domains: opts.domains ?? [domain()] }))
      : record(route)
  );

  await page.goto("/login");
  await page.getByPlaceholder("john@example.com").fill("admin@zoiko.test");
  await page.getByPlaceholder("Enter your password").fill("Password123!");
  await page.getByRole("button", { name: "Sign In", exact: true }).click();
  await expect(page).toHaveURL(/\/admin$/, { timeout: 60_000 });

  await page.goto("/admin/domains");
  await expect(page.getByRole("heading", { name: "Domains" })).toBeVisible();
  return calls;
}

const wrote = (calls: Calls, method: string, fragment: string) =>
  calls.sent.find((call) => call.method === method && call.url.includes(fragment));

test.describe("adding a domain", () => {
  test("sends the domain name, lower-cased", async ({ page }) => {
    const calls = await openDomains(page);

    await page.getByRole("button", { name: "Add domain", exact: true }).first().click();
    await page.getByLabel("Domain name").fill("ACME.Example");
    await page.getByRole("button", { name: "Add domain", exact: true }).last().click();

    await expect
      .poll(() => wrote(calls, "POST", "/domains")?.body)
      .toEqual({ domainName: "acme.example" });
  });

  test("refuses something that is not a domain without asking the server", async ({
    page,
  }) => {
    const calls = await openDomains(page);

    await page.getByRole("button", { name: "Add domain", exact: true }).first().click();
    await page.getByLabel("Domain name").fill("https://acme.test/mail");
    await page.getByRole("button", { name: "Add domain", exact: true }).last().click();

    await expect(page.getByText(/Enter a domain like acme.com/)).toBeVisible();
    expect(wrote(calls, "POST", "/domains")).toBeUndefined();
  });
});

test.describe("re-checking DNS", () => {
  test("asks the server to resolve the records again", async ({ page }) => {
    const calls = await openDomains(page);

    await page.getByRole("button", { name: "Re-check now" }).click();

    await expect
      .poll(() => Boolean(wrote(calls, "POST", "/domains/d1/diagnostics")))
      .toBe(true);
  });
});

test.describe("enabling sending", () => {
  test("is not offered while a check is still failing", async ({ page }) => {
    await openDomains(page, { domains: [domain()] });

    // The server refuses activation unless ownership, SPF, DKIM and DMARC all
    // pass, so offering it would be inviting a refusal.
    await expect(page.getByRole("button", { name: "Enable sending" })).toBeDisabled();
  });

  test("is offered once every check passes, and calls activate", async ({ page }) => {
    const calls = await openDomains(page, { domains: [verified()] });

    const button = page.getByRole("button", { name: "Enable sending" });
    await expect(button).toBeEnabled();
    await button.click();

    await expect
      .poll(() => Boolean(wrote(calls, "POST", "/domains/d1/activate")))
      .toBe(true);
  });

  test("shows the server's refusal rather than a generic failure", async ({ page }) => {
    await openDomains(page, {
      domains: [verified()],
      failWith: {
        status: 409,
        message: "Domain cannot send until these checks pass: DKIM",
      },
    });

    await page.getByRole("button", { name: "Enable sending" }).click();

    await expect(page.getByText(/Domain cannot send until these checks pass: DKIM/)).toBeVisible();
  });

  test("a sending domain says so and is not offered activation again", async ({ page }) => {
    await openDomains(page, { domains: [verified({ sendingEnabled: true })] });

    // Exact, or it also matches "Authorises sending infrastructure".
    await expect(page.getByText("Sending", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Enable sending" })).toHaveCount(0);
  });
});

test.describe("removing a domain", () => {
  test("asks first, then deletes", async ({ page }) => {
    const calls = await openDomains(page);

    await page.getByRole("button", { name: "Remove" }).click();
    await expect(page.getByText("Remove acme.test?")).toBeVisible();
    expect(wrote(calls, "DELETE", "/domains/d1")).toBeUndefined();

    await page.getByRole("button", { name: "Remove domain" }).click();
    await expect.poll(() => Boolean(wrote(calls, "DELETE", "/domains/d1"))).toBe(true);
  });

  test("is refused while the domain is sending", async ({ page }) => {
    await openDomains(page, { domains: [verified({ sendingEnabled: true })] });

    // Deleting a domain that is actively sending would strand mail; the server
    // refuses it, so the screen does not offer it.
    await expect(page.getByRole("button", { name: "Remove" })).toBeDisabled();
  });
});

test.describe("check history", () => {
  test("shows past checks with the resolver's own error", async ({ page }) => {
    await openDomains(page);

    // The domain row carries only the latest result, so it answers "is it
    // failing" and not "since when" — which is the difference between DNS that
    // has not propagated and a record that was never published.
    await page.getByRole("button", { name: "History" }).click();

    await expect(page.getByRole("heading", { name: "Check history" })).toBeVisible();
    await expect(page.getByText("DKIM: NXDOMAIN")).toBeVisible();
  });

  test("says so when nothing has been checked yet", async ({ page }) => {
    await openDomains(page, { checks: [] });

    await page.getByRole("button", { name: "History" }).click();

    await expect(page.getByText("No checks recorded yet")).toBeVisible();
  });
});
