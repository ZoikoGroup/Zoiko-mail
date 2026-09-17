import { test, expect, type Page, type Route } from "@playwright/test";

/**
 * Managing your own second factor from the account screen.
 *
 * The server had a complete TOTP implementation and enforced it at sign-in for
 * Owners, Admins and Support. The account screen showed "Two-factor
 * authentication · Not configured · Set up" with the status hardcoded and the
 * button disabled behind a "Soon" pill — so a privileged user was made to
 * enrol during sign-in and then told by their own settings that they had not,
 * with no way to see remaining recovery codes or replace a lost authenticator.
 *
 * The distinction these tests protect is between what the account *is* and
 * what the screen *says*. A hardcoded status passes every test that only
 * checks the page renders.
 */

const API = "**/api/v1";

const json = (data: unknown) => ({
  status: 200,
  contentType: "application/json",
  body: JSON.stringify({ success: true, data }),
});

interface StatusOverrides {
  enrolled?: boolean;
  enrolmentPending?: boolean;
  required?: boolean;
  requiredBecause?: string | null;
  remainingRecoveryCodes?: number;
}

function mfaStatus(over: StatusOverrides = {}) {
  return {
    enrolled: over.enrolled ?? false,
    enrolledAt: over.enrolled ? "2026-09-01T09:00:00.000Z" : null,
    enrolmentPending: over.enrolmentPending ?? false,
    required: over.required ?? false,
    requiredBecause: over.requiredBecause ?? null,
    remainingRecoveryCodes: over.remainingRecoveryCodes ?? 0,
  };
}

interface Calls {
  sent: Array<{ method: string; url: string; body: unknown }>;
}

async function openAccount(
  page: Page,
  opts: { status?: ReturnType<typeof mfaStatus>; statusFails?: boolean } = {}
): Promise<Calls> {
  const calls: Calls = { sent: [] };

  await page.route(`${API}/**`, (route) => route.fulfill(json({ items: [], count: 0 })));

  const session = {
    accessToken: "stub-access-token",
    refreshToken: "stub-refresh-token",
    expiresIn: "12h",
    user: { id: "u1", email: "member@zoiko.test", displayName: "Member" },
    tenant: { id: "t1", name: "Acme Corp", planCode: "starter" },
    membership: { id: "m1", role: "MEMBER" },
    workspace: "MEMBER",
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
        workspace: "MEMBER",
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
    if (request.url().includes("/mfa/enroll")) {
      return route.fulfill(
        json({ secret: "JBSWY3DPEHPK3PXP", uri: "otpauth://totp/Zoiko%20Mail:member" })
      );
    }
    if (request.url().includes("/mfa/confirm") || request.url().includes("/recovery-codes")) {
      return route.fulfill(json({ recoveryCodes: ["aaaa-1111", "bbbb-2222"] }));
    }
    return route.fulfill(json({ disabled: true }));
  };

  await page.route(/\/api\/v1\/auth\/mfa\/(enroll|confirm|disable|recovery-codes)$/, record);
  await page.route(/\/api\/v1\/auth\/mfa$/, (route) =>
    opts.statusFails
      ? route.fulfill({
          status: 500,
          contentType: "application/json",
          body: JSON.stringify({
            success: false,
            error: { code: "INTERNAL", message: "Upstream unavailable" },
          }),
        })
      : route.fulfill(json(opts.status ?? mfaStatus()))
  );

  await page.goto("/login");
  await page.getByPlaceholder("john@example.com").fill("member@zoiko.test");
  await page.getByPlaceholder("Enter your password").fill("Password123!");
  await page.getByRole("button", { name: "Sign In", exact: true }).click();
  await expect(page).toHaveURL(/\/inbox$/, { timeout: 60_000 });

  await page.goto("/account");
  await expect(page.getByText("Two-factor authentication")).toBeVisible();
  return calls;
}

const wrote = (calls: Calls, fragment: string) =>
  calls.sent.find((call) => call.url.includes(fragment));

test.describe("what the screen says about the account", () => {
  test("an enrolled account is not told it has nothing configured", async ({ page }) => {
    await openAccount(page, {
      status: mfaStatus({ enrolled: true, remainingRecoveryCodes: 7 }),
    });

    await expect(page.getByText(/your authenticator is required at sign-in/)).toBeVisible();
    await expect(page.getByText("7 recovery codes left")).toBeVisible();
    await expect(page.getByText("Not configured")).toHaveCount(0);
  });

  test("an unenrolled account is offered setup", async ({ page }) => {
    await openAccount(page);

    await expect(page.getByRole("button", { name: "Set up" })).toBeEnabled();
  });

  test("a role that compels it says so", async ({ page }) => {
    await openAccount(page, {
      status: mfaStatus({ required: true, requiredBecause: "ADMIN" }),
    });

    await expect(page.getByText(/Required for your role/)).toBeVisible();
  });

  test("a failed read says so rather than reporting 'off'", async ({ page }) => {
    await openAccount(page, { statusFails: true });

    // A read that failed and "not enrolled" are different facts. Reporting the
    // second for the first is what the hardcoded screen did to everybody.
    await expect(page.getByText(/Could not read your two-factor status/)).toBeVisible();
  });
});

test.describe("enrolling", () => {
  test("asks the server for a secret, then confirms with a code", async ({ page }) => {
    const calls = await openAccount(page);

    await page.getByRole("button", { name: "Set up" }).click();
    await expect(page.getByText("JBSWY3DPEHPK3PXP")).toBeVisible();
    await expect.poll(() => Boolean(wrote(calls, "/mfa/enroll"))).toBe(true);

    await page.getByLabel(/Code from your authenticator/).fill("123456");
    await page.getByRole("button", { name: "Confirm" }).click();

    await expect.poll(() => wrote(calls, "/mfa/confirm")?.body).toEqual({ code: "123456" });
  });

  test("shows the recovery codes once, and says they are shown once", async ({ page }) => {
    await openAccount(page);

    await page.getByRole("button", { name: "Set up" }).click();
    await page.getByLabel(/Code from your authenticator/).fill("123456");
    await page.getByRole("button", { name: "Confirm" }).click();

    await expect(page.getByText("aaaa-1111")).toBeVisible();
    await expect(page.getByText("bbbb-2222")).toBeVisible();
    await expect(page.getByText(/only time they are shown/)).toBeVisible();
  });
});

test.describe("recovery codes and turning it off", () => {
  test("regenerating requires a current code and warns the old ones stop working", async ({
    page,
  }) => {
    const calls = await openAccount(page, {
      status: mfaStatus({ enrolled: true, remainingRecoveryCodes: 2 }),
    });

    await page.getByRole("button", { name: "New recovery codes" }).click();
    await expect(page.getByText(/existing recovery codes stop working/)).toBeVisible();

    await page.getByLabel(/Confirm with a current code/).fill("654321");
    await page.getByRole("button", { name: "Replace codes" }).click();

    await expect.poll(() => wrote(calls, "/recovery-codes")?.body).toEqual({ code: "654321" });
  });

  test("turning it off requires a current code", async ({ page }) => {
    const calls = await openAccount(page, { status: mfaStatus({ enrolled: true }) });

    await page.getByRole("button", { name: "Turn off" }).click();
    await page.getByLabel(/Confirm with a current code/).fill("111222");
    await page.getByRole("button", { name: "Turn off" }).last().click();

    await expect.poll(() => wrote(calls, "/mfa/disable")?.body).toEqual({ code: "111222" });
  });

  test("is not offered when the role requires it", async ({ page }) => {
    await openAccount(page, {
      status: mfaStatus({ enrolled: true, required: true, requiredBecause: "OWNER" }),
    });

    // The server refuses outright for a required account, so a button here
    // would only ever produce a refusal.
    await expect(page.getByRole("button", { name: "Turn off" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "New recovery codes" })).toBeVisible();
  });
});
