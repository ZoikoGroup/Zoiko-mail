import { test, expect, type Page, type Route } from "@playwright/test";
import { API, json } from "./admin-harness";

/**
 * Opening a setup or invitation link: /invitation/accept?token=…, and the
 * older /accept-invitation?token=… that links already sent still point at.
 *
 * Every API call is stubbed. What these protect is what the person sees for
 * each state of the link, that the password rules are checked before anything
 * is sent, that one click sends one request, and that the token travels in a
 * request body and is never written to browser storage.
 */

const TOKEN = "Xk3F9aQ2mP7rT1vB8nW4zL";
const PASSWORD = "A-strong-Passw0rd";

const found = (over: Record<string, unknown> = {}) => ({
  email: "john@acme.test",
  tenantName: "Acme Corp",
  role: "MEMBER",
  needsPassword: true,
  alreadyAccepted: false,
  ...over,
});

const failure = (status: number, code: string, message: string, details?: unknown) => ({
  status,
  contentType: "application/json",
  body: JSON.stringify({ success: false, error: { code, message, details }, requestId: "e2e" }),
});

interface Seen {
  lookups: Array<{ method: string; url: string; body: unknown }>;
  claims: unknown[];
}

async function stub(
  page: Page,
  lookup: (route: Route) => Promise<void> | void,
  claim?: (route: Route) => Promise<void> | void
): Promise<Seen> {
  const seen: Seen = { lookups: [], claims: [] };
  await page.route(`${API}/membership/invitations/lookup**`, (route) => {
    seen.lookups.push({ method: route.request().method(), url: route.request().url(), body: route.request().postDataJSON() });
    return lookup(route);
  });
  await page.route(`${API}/membership/invitations/claim`, (route) => {
    seen.claims.push(route.request().postDataJSON());
    return claim ? claim(route) : route.fulfill(json({ email: "john@acme.test" }));
  });
  // The sign-in page this hands over to.
  await page.route(`${API}/auth/**`, (route) => route.fulfill(json({})));
  return seen;
}

test.describe("setting a password from a setup link", () => {
  for (const url of [`/invitation/accept?token=${TOKEN}`, `/accept-invitation?token=${TOKEN}`]) {
    test(`shows the invitation, checks the password, and signs them in next (${url.split(/[?/]/)[1]})`, async ({ page }) => {
      let release!: () => void;
      const gate = new Promise<void>((resolve) => (release = resolve));
      const seen = await stub(
        page,
        (route) => route.fulfill(json(found())),
        async (route) => {
          await gate;
          await route.fulfill(json({ email: "john@acme.test" }));
        }
      );
      await page.goto(url);

      await expect(page.getByRole("heading", { name: "You're invited to Zoiko Mail" })).toBeVisible();
      const email = page.getByLabel("Email address");
      await expect(email).toHaveValue("john@acme.test");
      await expect(email).toHaveAttribute("readonly", "");

      // The token went in a POST body, not a query string.
      expect(seen.lookups).toHaveLength(1);
      expect(seen.lookups[0]!.method).toBe("POST");
      expect(seen.lookups[0]!.url).not.toContain("token=");
      expect(seen.lookups[0]!.body).toEqual({ token: TOKEN });

      // Rules are checked here first; nothing is sent while they fail.
      const button = page.getByRole("button", { name: "Set Password" });
      await page.getByLabel("Password", { exact: true }).fill("short");
      await button.click();
      const rules = page.getByRole("list", { name: "Password requirements" });
      await expect(rules).toContainText("At least 8 characters (not met yet)");
      // The eye shows and hides what was typed.
      const passwordField = page.getByLabel("Password", { exact: true });
      await expect(passwordField).toHaveAttribute("type", "password");
      await page.getByRole("button", { name: "Show password" }).click();
      await expect(passwordField).toHaveAttribute("type", "text");
      await page.getByRole("button", { name: "Hide password" }).click();
      await expect(passwordField).toHaveAttribute("type", "password");
      await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
      await page.getByLabel("Confirm password").fill(`${PASSWORD}x`);
      await expect(page.getByText("Passwords do not match.")).toBeVisible();
      await button.click();
      expect(seen.claims).toHaveLength(0);

      await page.getByLabel("Confirm password").fill(PASSWORD);
      await button.click();
      // One click, one request, however impatient they are.
      await expect(page.getByRole("button", { name: "Setting password…" })).toBeDisabled();
      await page.getByRole("button", { name: "Setting password…" }).click({ force: true }).catch(() => undefined);
      release();

      await expect(page.getByRole("heading", { name: "Your password is set" })).toBeVisible();
      expect(seen.claims).toEqual([{ invitationToken: TOKEN, password: PASSWORD }]);
      // A Member signs in on the Member page.
      await expect(page).toHaveURL(/\/login\/member$/);

      const stored = await page.evaluate(() => JSON.stringify({ ...localStorage }) + JSON.stringify({ ...sessionStorage }));
      expect(stored).not.toContain(TOKEN);
    });
  }

  test("an expired link says so and how to get a new one", async ({ page }) => {
    await stub(page, (route) => route.fulfill(failure(410, "INVITATION_EXPIRED", "Invitation has expired")));
    await page.goto(`/invitation/accept?token=${TOKEN}`);
    await expect(page.getByRole("heading", { name: "This link has expired" })).toBeVisible();
    await expect(page.getByText("generate a new link")).toBeVisible();
  });

  test("a replaced, withdrawn or unknown link is refused", async ({ page }) => {
    await stub(page, (route) => route.fulfill(failure(401, "INVITATION_INVALID", "Invitation is invalid")));
    await page.goto(`/invitation/accept?token=${TOKEN}`);
    await expect(page.getByRole("heading", { name: "This link is no longer valid" })).toBeVisible();
    await expect(page.getByLabel("Password", { exact: true })).toHaveCount(0);
  });

  test("a link already used sends them to sign in", async ({ page }) => {
    await stub(page, (route) => route.fulfill(json(found({ alreadyAccepted: true }))));
    await page.goto(`/invitation/accept?token=${TOKEN}`);
    await expect(page.getByRole("heading", { name: "This link has already been used" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Sign in" })).toHaveAttribute("href", "/login/member");
  });

  test("someone invited as Admin is sent to the main sign-in page", async ({ page }) => {
    await stub(page, (route) => route.fulfill(json(found({ role: "ADMIN", alreadyAccepted: true }))));
    await page.goto(`/invitation/accept?token=${TOKEN}`);
    await expect(page.getByRole("link", { name: "Sign in" })).toHaveAttribute("href", "/login");
  });

  test("a link used in another tab meanwhile is reported as used, not as an error", async ({ page }) => {
    await stub(
      page,
      (route) => route.fulfill(json(found())),
      (route) => route.fulfill(failure(409, "CONFLICT", "This invitation has already been accepted. Sign in to continue.", { reason: "ALREADY_ACCEPTED" }))
    );
    await page.goto(`/invitation/accept?token=${TOKEN}`);
    await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
    await page.getByLabel("Confirm password").fill(PASSWORD);
    await page.getByRole("button", { name: "Set Password" }).click();
    await expect(page.getByRole("heading", { name: "This link has already been used" })).toBeVisible();
  });

  test("a password the server refuses keeps them on the form with its reason", async ({ page }) => {
    await stub(
      page,
      (route) => route.fulfill(json(found())),
      (route) => route.fulfill(failure(400, "VALIDATION_ERROR", "Password is too common"))
    );
    await page.goto(`/invitation/accept?token=${TOKEN}`);
    await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
    await page.getByLabel("Confirm password").fill(PASSWORD);
    await page.getByRole("button", { name: "Set Password" }).click();
    await expect(page.getByText("Password is too common")).toBeVisible();
    await expect(page.getByRole("button", { name: "Set Password" })).toBeEnabled();
  });

  test("a link with no token says it is incomplete, and asks nothing of the server", async ({ page }) => {
    const seen = await stub(page, (route) => route.fulfill(json(found())));
    await page.goto("/invitation/accept");
    await expect(page.getByRole("heading", { name: "Invalid link" })).toBeVisible();
    expect(seen.lookups).toHaveLength(0);
  });

  test("an address that already has an account is asked to sign in, not to set a password", async ({ page }) => {
    await stub(page, (route) => route.fulfill(json(found({ needsPassword: false }))));
    await page.goto(`/invitation/accept?token=${TOKEN}`);
    await expect(page.getByRole("heading", { name: "Sign in to accept" })).toBeVisible();
    await expect(page.getByLabel("Password", { exact: true })).toHaveCount(0);
  });

  test("the page tells the browser not to pass the link on", async ({ page }) => {
    await stub(page, (route) => route.fulfill(json(found())));
    await page.goto(`/invitation/accept?token=${TOKEN}`);
    await expect(page.locator('meta[name="referrer"]')).toHaveAttribute("content", "no-referrer");
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);
  });
});
