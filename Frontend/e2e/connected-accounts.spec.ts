import { test, expect, type Page, type Route } from "@playwright/test";

/**
 * Settings → Connected Mailboxes: listing, the connection's detail (status,
 * permission scope, last sync), REAUTH_REQUIRED reconnect through the
 * provider's return address (/connected-accounts), on-demand Sync now (incl.
 * failure) and disconnect. Driven against a stubbed API like
 * action-inbox.spec.ts — the subject is client wiring, not the server.
 *
 * Route precedence: the catch-all is registered FIRST and specific stubs after
 * it (most-recently-registered wins).
 */

const API = "**/api/v1";

function signedIn(workspace: string, role: string = workspace) {
  const session = {
    accessToken: "stub-access-token",
    refreshToken: "stub-refresh-token",
    expiresIn: "12h",
    user: { id: "u1", email: "someone@zoiko.test", displayName: "Someone" },
    tenant: { id: "t1", name: "Stub Workspace", planCode: "starter" },
    membership: { id: "m1", role },
    workspace,
  };
  return { success: true, data: { state: "SIGNED_IN", session, ...session } };
}

function connector(overrides: Record<string, unknown> = {}) {
  return {
    id: "c1",
    provider: "GMAIL",
    email: "someone@zoiko.test",
    scopes: ["https://www.googleapis.com/auth/gmail.readonly"],
    status: "ACTIVE",
    watchExpiresAt: "2026-09-05T09:00:00.000Z",
    lastSyncedAt: "2026-09-01T10:00:00.000Z",
    lastErrorCode: null,
    disconnectedAt: null,
    createdAt: "2026-09-01T09:00:00.000Z",
    updatedAt: "2026-09-01T09:00:00.000Z",
    ...overrides,
  };
}

function json(route: Route, data: unknown, status = 200) {
  return route.fulfill({
    status,
    contentType: "application/json",
    body: JSON.stringify({ success: true, data }),
  });
}

function stubSessionReads(page: Page) {
  return page.route(`${API}/**`, (route) => {
    if (route.request().url().includes("/auth/")) return route.fallback();
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ success: true, data: { items: [], count: 0 } }),
    });
  });
}

async function signIn(page: Page) {
  await page.route(`${API}/auth/login`, (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(signedIn("MEMBER")),
    })
  );
  await page.route(`${API}/auth/me`, (route) =>
    json(route, {
      id: "u1",
      email: "someone@zoiko.test",
      displayName: "Someone",
      tenant: { id: "t1", name: "Stub Workspace", planCode: "starter" },
      membership: { id: "m1", role: "MEMBER" },
      workspace: "MEMBER",
    })
  );

  await page.goto("/login");
  await page.getByPlaceholder("john@example.com").fill("someone@zoiko.test");
  await page.getByPlaceholder("Enter your password").fill("Password123!");
  await page.getByRole("button", { name: "Sign In", exact: true }).click();
  await expect(page).toHaveURL(/\/mail$/, { timeout: 60_000 });
}

async function stubConnectors(page: Page, accounts: unknown[]) {
  await page.route(`${API}/connectors`, (route) => json(route, { accounts }));
  await page.route(`${API}/connectors/*`, (route) => {
    const url = route.request().url();
    const method = route.request().method();
    if (method === "DELETE") {
      const id = url.split("/").pop();
      const idx = accounts.findIndex((a: any) => a.id === id);
      if (idx >= 0) accounts.splice(idx, 1);
      return json(route, { ok: true });
    }
    return route.fallback();
  });
}

test.beforeEach(async ({ page }) => {
  await stubSessionReads(page);
});

const PAGE = "/mail/settings/connected-mailboxes";

test("a connection shows its status, read-only scope and last sync, and Sync now works", async ({ page }) => {
  const accounts = [connector()];
  await stubConnectors(page, accounts);
  let syncCount = 0;
  await page.route(`${API}/connectors/*/sync`, async (route) => {
    syncCount += 1;
    await new Promise((resolve) => setTimeout(resolve, 600));
    return json(route, { synced: true, provider: "GMAIL", result: { fetched: 0, imported: 0, deleted: 0, checkpointHistoryId: 42 } });
  });

  await signIn(page);
  await page.goto(PAGE);

  const list = page.getByTestId("connection-list");
  await expect(list.getByText("someone@zoiko.test")).toBeVisible({ timeout: 60_000 });
  await expect(list.getByText("Connected", { exact: true })).toBeVisible();

  const detail = page.getByTestId("connection-detail");
  await expect(detail.getByRole("heading", { name: "Gmail" })).toBeVisible();
  const scope = detail.getByTestId("permission-scope");
  await expect(scope.getByText("Read messages and labels in this account")).toBeVisible();
  await expect(scope.getByText("Not granted")).toHaveCount(2);
  await expect(detail.getByText(/Sep 1/).first()).toBeVisible();

  const syncResponse = page.waitForResponse((r) => r.url().includes("/connectors/c1/sync") && r.request().method() === "POST");
  await detail.getByRole("button", { name: "Sync now" }).click();
  await expect(detail.getByRole("button", { name: "Syncing…" })).toBeVisible();
  await syncResponse;
  await expect(detail.getByRole("button", { name: "Sync now" })).toBeVisible({ timeout: 10_000 });
  expect(syncCount).toBe(1);
});

test("Sync now says so when the provider call fails", async ({ page }) => {
  const accounts = [connector()];
  await stubConnectors(page, accounts);
  await page.route(`${API}/connectors/*/sync`, (route) =>
    route.fulfill({
      status: 502,
      contentType: "application/json",
      body: JSON.stringify({ success: false, error: { code: "PROVIDER_ERROR", message: "Sync failed — the provider may be unavailable or needs reauthorization" } }),
    })
  );

  await signIn(page);
  await page.goto(PAGE);
  await page.getByTestId("connection-detail").getByRole("button", { name: "Sync now" }).click({ timeout: 60_000 });
  await expect(page.getByText(/Sync failed: Sync failed/)).toBeVisible({ timeout: 15_000 });
});

test("a connection that needs review reconnects through the provider's return address", async ({ page }) => {
  const accounts = [connector({ status: "REAUTH_REQUIRED", lastErrorCode: "NO_REFRESH_TOKEN" })];
  await stubConnectors(page, accounts);

  // Reconnect fetches the backend's OAuth URL, then navigates there. Pointing
  // it at /connected-accounts — where the real callbacks land — simulates the
  // provider sending the user back, with no external network.
  let authFetched = 0;
  await page.route(`${API}/connectors/auth/google`, (route) => {
    authFetched += 1;
    return json(route, { url: "/connected-accounts?connected=true&provider=GMAIL" });
  });

  await signIn(page);
  await page.goto(PAGE);

  await expect(page.getByTestId("needs-review")).toContainText("1 connection needs review", { timeout: 60_000 });
  const detail = page.getByTestId("connection-detail");
  await expect(detail.getByText(/needs you to sign in again/)).toBeVisible();

  const connectResponse = page.waitForResponse((r) => r.url().includes("/connectors/auth/google"));
  await detail.getByRole("button", { name: "Reconnect" }).click();
  await connectResponse;
  await expect(page).toHaveURL(/\/mail\/settings\/connected-mailboxes$/, { timeout: 30_000 });
  await expect(page.getByText("Gmail connected. Mail will start syncing shortly.")).toBeVisible({ timeout: 30_000 });
  expect(authFetched).toBe(1);
});

test("disconnect asks first, then removes the connection", async ({ page }) => {
  const accounts = [connector()];
  await stubConnectors(page, accounts);

  await signIn(page);
  await page.goto(PAGE);
  const detail = page.getByTestId("connection-detail");
  await detail.getByRole("button", { name: "Disconnect" }).click({ timeout: 60_000 });
  await expect(page.getByText(/Syncing from someone@zoiko.test stops/)).toBeVisible();

  await page.getByRole("button", { name: "Disconnect", exact: true }).last().click();
  await expect(page.getByText("No mailboxes connected")).toBeVisible({ timeout: 15_000 });
});

test("the old address keeps a failed sign-in's reason", async ({ page }) => {
  await stubConnectors(page, []);
  await signIn(page);
  await page.goto("/connected-accounts?error=access_denied");
  await expect(page).toHaveURL(/\/mail\/settings\/connected-mailboxes$/, { timeout: 60_000 });
  await expect(page.getByRole("alert").filter({ hasText: "The connection did not complete: Access denied." })).toBeVisible({ timeout: 30_000 });
});
