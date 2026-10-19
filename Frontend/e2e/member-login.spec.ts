import { test, expect, type Page } from "@playwright/test";
import { API, json, signInAsAdmin } from "./admin-harness";

/**
 * The Member sign-in, end to end in the browser.
 *
 * The API is stubbed: the server's side — that a MEMBER request opens the
 * Member workspace for any role, the console gate — is covered by
 * Backend/tests/member-login.test.ts. What only a browser shows is the
 * client's half: the button on /login, the dedicated page, what it sends,
 * where it lands, retired per-mailbox links, and the admin's copy of the link.
 */

const LINK_KEY = "0123456789abcdef0123456789abcdef";

function signedIn(workspace: string, role = workspace) {
  const session = {
    accessToken: "stub-access-token",
    refreshToken: "stub-refresh-token",
    expiresIn: "12h",
    user: { id: "u1", email: "sam@acme.test", displayName: "Sam" },
    tenant: { id: "t-acme", name: "Acme", planCode: "starter" },
    membership: { id: "m1", role },
    workspace,
  };
  return { state: "SIGNED_IN", session, ...session };
}

/** What a Member-scoped shell reads once the session exists. */
async function stubMemberShell(page: Page) {
  await page.route(`${API}/**`, (route) => {
    if (route.request().url().includes("/auth/")) return route.fallback();
    return route.fulfill(json({ items: [], count: 0 }));
  });
  await page.route(`${API}/auth/me`, (route) =>
    route.fulfill(
      json({
        id: "u1",
        email: "sam@acme.test",
        displayName: "Sam",
        tenant: { id: "t-acme", name: "Acme", planCode: "starter" },
        membership: { id: "m1", role: "MEMBER" },
        workspace: "MEMBER",
      })
    )
  );
}

/** Captures every /auth/login body and answers with a Member session. */
async function captureLogin(page: Page): Promise<Array<Record<string, unknown>>> {
  const bodies: Array<Record<string, unknown>> = [];
  await page.route(`${API}/auth/login`, (route) => {
    bodies.push(route.request().postDataJSON() as Record<string, unknown>);
    return route.fulfill(json(signedIn("MEMBER")));
  });
  return bodies;
}

test("the login page offers a clearly labelled Member sign-in", async ({ page }) => {
  await page.goto("/login");
  const button = page.getByRole("link", { name: "Login as Member/User" });
  await expect(button).toBeVisible({ timeout: 60_000 });
  await button.click();
  await expect(page).toHaveURL(/\/login\/member$/, { timeout: 60_000 });
  await expect(page.getByRole("heading", { name: "Member Sign In" })).toBeVisible();
  await expect(page.getByText("Member workspace", { exact: true })).toBeVisible();
});

test("the Member login is email and password only, while the standard login keeps Google", async ({ page }) => {
  await page.goto("/login/member");
  await expect(page.getByRole("heading", { name: "Member Sign In" })).toBeVisible({ timeout: 60_000 });
  await expect(page.getByPlaceholder("john@example.com")).toBeVisible();
  await expect(page.getByPlaceholder("Enter your password")).toBeVisible();
  await expect(page.getByText("Continue with Google")).toHaveCount(0);
  await expect(page.getByText("OR", { exact: true })).toHaveCount(0);
  // Google's sign-in client is not even loaded on this page.
  await expect(page.locator('script[src*="accounts.google.com/gsi/client"]')).toHaveCount(0);

  // Our painted label, with Google's own transparent button over it.
  await page.goto("/login");
  await expect(page.getByText("Continue with Google").first()).toBeVisible({ timeout: 60_000 });
});

test("signs in for the Member workspace and lands in webmail", async ({ page }) => {
  await stubMemberShell(page);
  const bodies = await captureLogin(page);

  await page.goto("/login/member");
  await page.getByPlaceholder("john@example.com").fill("sam@acme.test");
  await page.getByPlaceholder("Enter your password").fill("Password123!");
  await page.getByRole("button", { name: "Sign In to Member Workspace" }).click();

  await expect(page).toHaveURL(/\/mail$/, { timeout: 60_000 });
  expect(bodies).toHaveLength(1);
  expect(bodies[0]).toMatchObject({ email: "sam@acme.test", workspace: "MEMBER" });
  expect(bodies[0]!.tenantId).toBeUndefined();
});

test("checks the form before sending anything", async ({ page }) => {
  const bodies = await captureLogin(page);
  await page.goto("/login/member");
  await page.getByRole("button", { name: "Sign In to Member Workspace" }).click();
  await expect(page.getByText("Email is required.")).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText("Password is required.")).toBeVisible();
  expect(bodies).toHaveLength(0);
});

test("a retired per-mailbox link lands on the plain Member login, without the key", async ({ page }) => {
  let resolved = 0;
  await page.route(`${API}/auth/member-login/**`, (route) => {
    resolved += 1;
    return route.abort();
  });

  await page.goto(`/login/member/${LINK_KEY}`);
  await expect(page).toHaveURL(/\/login\/member$/, { timeout: 60_000 });
  await expect(page.getByRole("heading", { name: "Member Sign In" })).toBeVisible();
  await expect(page.getByPlaceholder("john@example.com")).toHaveValue("");
  expect(resolved).toBe(0);
});

test("a console removed by an admin signs the session out with the reason", async ({ page }) => {
  await page.route(`${API}/auth/login`, (route) => route.fulfill(json(signedIn("ADMIN"))));
  await page.route(`${API}/**`, (route) => {
    if (route.request().url().includes("/auth/")) return route.fallback();
    return route.fulfill(json({ items: [], count: 0 }));
  });
  await page.route(`${API}/auth/me`, (route) =>
    route.fulfill({
      status: 403,
      contentType: "application/json",
      body: JSON.stringify({
        success: false,
        error: {
          code: "WORKSPACE_ACCESS_NOT_ASSIGNED",
          message:
            "Your access to this workspace was removed by an administrator. Sign in again to continue in the Member workspace.",
        },
      }),
    })
  );

  await page.goto("/login");
  await page.getByPlaceholder("john@example.com").fill("sam@acme.test");
  await page.getByPlaceholder("Enter your password").fill("Password123!");
  await page.getByRole("button", { name: "Sign In", exact: true }).click();

  await expect(page).toHaveURL(/\/login$/, { timeout: 60_000 });
  await expect(page.getByText(/Your access to this workspace was removed by an administrator/)).toBeVisible();
});

test.describe("admin Mailboxes page", () => {
  const mailboxes = [
    {
      id: "mb-sam",
      membershipId: "m-sam",
      address: "sam@acme.test",
      type: "USER",
      storageUsed: 0,
      storageLimit: 1_073_741_824,
      sendSuspendedAt: null,
      sendSuspensionReason: null,
      aiEnabled: true,
      workspaces: ["MEMBER"],
    },
  ];

  test("shows the one plain Member login link, with nothing to replace", async ({ page }) => {
    await signInAsAdmin(page, { capabilities: ["workspace.mailboxes.manage", "people.invite.member"] });
    await page.route(`${API}/mail/admin/mailboxes`, (route) => route.fulfill(json(mailboxes)));

    await page.goto("/admin/mailboxes");
    await page.getByRole("row", { name: /sam@acme\.test/ }).getByRole("button", { name: "Member login" }).click();
    const dialog = page.getByRole("dialog", { name: "Member login link" });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByLabel("Member login link")).toHaveValue(/^https?:\/\/[^/]+\/login\/member$/);
    await expect(dialog.getByText("sam@acme.test")).toBeVisible();
    await expect(dialog.getByRole("button", { name: "Generate a new link" })).toHaveCount(0);
  });
});
