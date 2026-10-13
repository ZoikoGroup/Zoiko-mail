import { test, expect, type Page } from "@playwright/test";
import { API, json, signInAsAdmin } from "./admin-harness";

/**
 * The Member sign-in, end to end in the browser.
 *
 * The API is stubbed: the server's side — that a MEMBER request opens the
 * Member workspace for any role, the console gate, the link's resolution —
 * is covered by Backend/tests/member-login.test.ts. What only a browser shows
 * is the client's half: the button on /login, the dedicated page, what it
 * sends, where it lands, the prefilled link, and the admin's copy of it.
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

test("a mailbox's link prefills the email and workspace, and still needs the password", async ({ page }) => {
  await stubMemberShell(page);
  const bodies = await captureLogin(page);
  await page.route(`${API}/auth/member-login/${LINK_KEY}`, (route) =>
    route.fulfill(
      json({ tenantId: "t-acme", workspaceName: "Acme", mailboxAddress: "sam@acme.test", shared: false, email: "sam@acme.test" })
    )
  );

  await page.goto(`/login/member/${LINK_KEY}`);
  await expect(page.getByPlaceholder("john@example.com")).toHaveValue("sam@acme.test", { timeout: 60_000 });
  await expect(page.getByText("Acme", { exact: true })).toBeVisible();

  // Nothing is sent until the password is given.
  await page.getByRole("button", { name: "Sign In to Member Workspace" }).click();
  await expect(page.getByText("Password is required.")).toBeVisible();
  expect(bodies).toHaveLength(0);

  await page.getByPlaceholder("Enter your password").fill("Password123!");
  await page.getByRole("button", { name: "Sign In to Member Workspace" }).click();
  await expect(page).toHaveURL(/\/mail$/, { timeout: 60_000 });
  expect(bodies[0]).toMatchObject({ email: "sam@acme.test", tenantId: "t-acme", workspace: "MEMBER" });
});

test("a replaced link says so and leaves a working form", async ({ page }) => {
  await page.route(`${API}/auth/member-login/${LINK_KEY}`, (route) =>
    route.fulfill({
      status: 404,
      contentType: "application/json",
      body: JSON.stringify({ success: false, error: { code: "MEMBER_LOGIN_LINK_INVALID", message: "not valid" } }),
    })
  );
  await page.goto(`/login/member/${LINK_KEY}`);
  await expect(page.getByText(/This sign-in link is no longer valid/)).toBeVisible({ timeout: 60_000 });
  await expect(page.getByPlaceholder("john@example.com")).toHaveValue("");
  await expect(page.getByRole("button", { name: "Sign In to Member Workspace" })).toBeEnabled();
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
      memberLoginUrl: `http://localhost:3000/login/member/${LINK_KEY}`,
    },
  ];

  test("shows each mailbox's Member login link and can replace it", async ({ page }) => {
    await signInAsAdmin(page, { capabilities: ["workspace.mailboxes.manage", "people.invite.member"] });
    let regenerated = 0;
    await page.route(`${API}/mail/admin/mailboxes`, (route) => route.fulfill(json(mailboxes)));
    await page.route(`${API}/mail/admin/mailboxes/mb-sam/member-login-link/regenerate`, (route) => {
      regenerated += 1;
      return route.fulfill(
        json({
          mailboxId: "mb-sam",
          memberLoginKey: "fedcba9876543210fedcba9876543210",
          memberLoginUrl: "http://localhost:3000/login/member/fedcba9876543210fedcba9876543210",
        })
      );
    });

    await page.goto("/admin/mailboxes");
    await page.getByRole("row", { name: /sam@acme\.test/ }).getByRole("button", { name: "Member login" }).click();
    const dialog = page.getByRole("dialog", { name: "Member login link" });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByLabel("Member login link for sam@acme.test")).toHaveValue(
      `http://localhost:3000/login/member/${LINK_KEY}`
    );

    await dialog.getByRole("button", { name: "Generate a new link" }).click();
    await dialog.getByRole("button", { name: "Replace link" }).click();
    await expect(dialog.getByLabel("Member login link for sam@acme.test")).toHaveValue(
      "http://localhost:3000/login/member/fedcba9876543210fedcba9876543210"
    );
    await expect(dialog.getByText("New link created. The previous link no longer works.")).toBeVisible();
    expect(regenerated).toBe(1);
  });
});
