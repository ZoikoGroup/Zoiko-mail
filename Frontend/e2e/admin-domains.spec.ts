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

/** A server record in the shape GET /domains returns. */
function dnsRecord(purpose: string, name: string, value: string, legacy: string, extra: Record<string, unknown> = {}) {
  const state = legacy === "VALID" || legacy === "VERIFIED" ? "VERIFIED" : legacy === "PENDING" ? "PENDING" : "MISSING";
  return {
    id: `r-${purpose}`,
    recordKey: purpose,
    purpose,
    type: purpose === "MX" ? "MX" : "TXT",
    name,
    fqdn: name === "@" ? "acme.test" : `${name}.acme.test`,
    value,
    priority: purpose === "MX" ? 10 : null,
    ttl: 3600,
    required: true,
    state,
    status: state === "VERIFIED" ? "VALID" : state === "PENDING" ? "PENDING" : "INVALID",
    observed: null,
    diagnosis: null,
    lastErrorCode: null,
    lastCheckedAt: "2026-09-01T09:00:00.000Z",
    lastVerifiedAt: null,
    publishState: "NOT_APPLICABLE",
    publishedAt: null,
    publishError: null,
    ...extra,
  };
}

function domain(over: DomainOverrides = {}) {
  const verificationStatus = over.verificationStatus ?? "PENDING";
  const spfStatus = over.spfStatus ?? "PENDING";
  const dkimStatus = over.dkimStatus ?? "PENDING";
  const dmarcStatus = over.dmarcStatus ?? "PENDING";
  const sendingEnabled = over.sendingEnabled ?? false;
  const sendReady = verificationStatus === "VERIFIED" && spfStatus === "VALID" && dkimStatus === "VALID" && dmarcStatus === "VALID";
  return {
    id: over.id ?? "d1",
    domainName: over.domainName ?? "acme.test",
    type: "CUSTOM",
    status: sendingEnabled ? "ACTIVE" : sendReady ? "VERIFIED" : "PENDING_VERIFICATION",
    verificationStatus,
    mxStatus: "VALID",
    spfStatus,
    dkimStatus,
    dmarcStatus,
    lastCheckedAt: "2026-09-01T09:00:00.000Z",
    nextCheckAt: "2026-09-01T09:02:00.000Z",
    sendingEnabled,
    verificationToken: "zoiko-mail-verification=abc123",
    dnsProvider: "MANUAL",
    dnsCredentialId: null,
    dnsCredential: null,
    receivingEnabled: true,
    replaceExistingMx: false,
    autoActivateSending: true,
    dmarcPolicy: "NONE",
    dmarcReportEmail: null,
    configVersion: 1,
    consecutiveFailures: 0,
    graceUntil: null,
    sendingSuspendedAt: null,
    suspensionReason: null,
    lastSyncError: null,
    errorDetails: {},
    records: [
      dnsRecord("OWNERSHIP", "@", "zoiko-mail-verification=abc123", verificationStatus),
      dnsRecord("MX", "@", "mx1.zoikomail.com", "VALID"),
      dnsRecord("SPF", "@", "v=spf1 include:_spf.zoikomail.com ~all", spfStatus),
      dnsRecord("DKIM", "zm202609._domainkey", "v=DKIM1; k=rsa; p=MIIB", dkimStatus),
      dnsRecord("DMARC", "_dmarc", "v=DMARC1; p=none; adkim=r; aspf=r", dmarcStatus),
    ],
    dkimKeys: [{ id: "k1", selector: "zm202609", keyBits: 2048, status: "ACTIVE", activatedAt: null, retiringAt: null, createdAt: "2026-09-01T09:00:00.000Z" }],
    readiness: { sendReady, fullyReady: sendReady, blocking: sendReady ? [] : ["OWNERSHIP", "SPF", "DKIM", "DMARC"] },
    createdAt: "2026-09-01T09:00:00.000Z",
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
            trigger: "SCHEDULED",
            resultStatus: "PENDING_VERIFICATION",
            durationMs: 120,
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
  await page.route(/\/api\/v1\/domains\/dns-providers$/, (route) =>
    route.request().method() === "GET" ? route.fulfill(json({ credentials: [] })) : record(route)
  );
  await page.route(/\/api\/v1\/domains\/[^/]+\/(diagnostics|activate|deactivate|publish|dkim\/rotate)$/, record);
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

    // Manual publishing is the default, so no provider fields are sent.
    await expect
      .poll(() => wrote(calls, "POST", "/domains")?.body)
      .toEqual({ domainName: "acme.example", receivingEnabled: true });
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
    await page.getByRole("tab", { name: "history" }).click();

    // Older rows stored bare strings; they still read as the resolver's words.
    await expect(page.getByText("DKIM: NXDOMAIN")).toBeVisible();
  });

  test("says so when nothing has been checked yet", async ({ page }) => {
    await openDomains(page, { checks: [] });

    await page.getByRole("tab", { name: "history" }).click();

    await expect(page.getByText("No checks recorded yet")).toBeVisible();
  });
});

test.describe("DNS records", () => {
  test("shows the server's generated records, not a hardcoded template", async ({ page }) => {
    await openDomains(page);

    // The values come from the API response. The old screen printed
    // mail.zoiko.dev and a "<provided by Zoiko support>" placeholder here.
    await expect(page.getByText("v=spf1 include:_spf.zoikomail.com ~all")).toBeVisible();
    await expect(page.getByText("zm202609._domainkey")).toBeVisible();
    await expect(page.getByText("mail.zoiko.dev")).toHaveCount(0);
  });

  test("downloads the zone file from the server", async ({ page }) => {
    await openDomains(page);
    // Registered after openDomains: Playwright tries the newest route first,
    // and openDomains ends with a catch-all for the rest of the API.
    await page.route(/\/api\/v1\/domains\/[^/]+\/zone-file$/, (route) =>
      route.fulfill({
        status: 200,
        contentType: "text/plain",
        headers: { "Content-Disposition": 'attachment; filename="acme.test.zone"' },
        body: "$ORIGIN acme.test.\n",
      })
    );

    const download = page.waitForEvent("download");
    await page.getByRole("button", { name: "Zone file" }).click();
    expect((await download).suggestedFilename()).toBe("acme.test.zone");
  });
});
