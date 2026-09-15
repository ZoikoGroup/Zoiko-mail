import { test, expect, type Page, type Route } from "@playwright/test";

/**
 * Dedicated Connected Accounts coverage: listing, status/re-sync state, watch
 * expiry, REAUTH_REQUIRED reconnect, on-demand Sync Now (incl. failure) and
 * disconnect. Driven against a stubbed API like action-inbox.spec.ts — the
 * subject is client wiring, not the server.
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
  await expect(page).toHaveURL(/\/inbox$/, { timeout: 60_000 });
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

test("Connected account lists status, email, last sync and watch expiry, and Sync Now works", async ({ page }) => {
  const accounts = [connector()];
  await stubConnectors(page, accounts);
  let syncCount = 0;
  await page.route(`${API}/connectors/*/sync`, async (route) => {
    syncCount += 1;
    await new Promise((resolve) => setTimeout(resolve, 600));
    return json(route, { synced: true, provider: "GMAIL", result: { fetched: 0, imported: 0, deleted: 0, checkpointHistoryId: 42 } });
  });

  await signIn(page);
  await page.goto("/connected-accounts");

  await expect(page.getByRole("heading", { name: "Connected accounts" })).toBeVisible();
  await expect(page.getByText("Gmail", { exact: true })).toBeVisible();
  await expect(page.getByText("someone@zoiko.test")).toBeVisible();
  await expect(page.getByText("ACTIVE", { exact: true })).toBeVisible();
  await expect(page.getByText(/Last synced: Sep 1,/)).toBeVisible();
  await expect(page.getByText(/Watch expires: Sep 5,/)).toBeVisible();

  const syncResponse = page.waitForResponse((r) => r.url().includes("/connectors/c1/sync") && r.request().method() === "POST");
  await page.getByRole("button", { name: /Sync now/ }).click();
  await expect(page.getByText(/Syncing latest messages/)).toBeVisible();
  await syncResponse;
  await expect(page.getByText(/Syncing latest messages/)).not.toBeVisible({ timeout: 10_000 });
  expect(syncCount).toBe(1);
});

test("Sync Now surfaces a friendly error when the provider call fails", async ({ page }) => {
  const accounts = [connector()];
  await stubConnectors(page, accounts);
  await page.route(`${API}/connectors/*/sync`, (route) =>
    route.fulfill({
      status: 502,
      contentType: "application/json",
      body: JSON.stringify({ success: false, error: { code: "PROVIDER_ERROR", message: "Sync failed \u2014 the provider may be unavailable or needs reauthorization" } }),
    })
  );

  await signIn(page);
  await page.goto("/connected-accounts");
  await page.getByRole("button", { name: /Sync now/ }).click();
  await expect(page.getByText(/Gmail sync failed/)).toBeVisible({ timeout: 15_000 });
});

test("REAUTH_REQUIRED account invites a reconnect that restarts OAuth", async ({ page }) => {
  const accounts = [
    connector({ status: "REAUTH_REQUIRED", lastErrorCode: "NO_REFRESH_TOKEN" }),
  ];
  await stubConnectors(page, accounts);

  // Reconnect fetches the existing backend OAuth URL, then navigates there.
  // Pointing it at the local connected-accounts path simulates the provider
  // callback landing the user back — no external network needed.
  let authFetched = 0;
  await page.route(`${API}/connectors/auth/google`, (route) => {
    authFetched += 1;
    return json(route, { url: "/connected-accounts?connected=true&provider=GMAIL" });
  });

  await signIn(page);
  await page.goto("/connected-accounts");

  await expect(page.getByText("REAUTH_REQUIRED", { exact: true })).toBeVisible();
  await expect(page.getByText(/Reauthorization needed/)).toBeVisible();

  const connectResponse = page.waitForResponse((r) => r.url().includes("/connectors/auth/google"));
  await page.getByRole("button", { name: /Reconnect/ }).click();
  await connectResponse;
  await expect(page).toHaveURL(/connected=true&provider=GMAIL/, { timeout: 15_000 });
  await expect(page.getByText(/Gmail connected successfully/)).toBeVisible();
  expect(authFetched).toBe(1);
});

test("Disconnect requires confirmation and removes the account after refetch", async ({ page }) => {
  const accounts: unknown[] = [connector()];
  await stubConnectors(page, accounts);

  await signIn(page);
  await page.goto("/connected-accounts");
  await expect(page.getByText("Gmail", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Disconnect", exact: true }).click();
  await expect(page.getByText(/Disconnect someone@zoiko.test/)).toBeVisible();
  const deleteResponse = page.waitForResponse((r) => r.url().endsWith("/connectors/c1") && r.request().method() === "DELETE");
  await page.getByRole("button", { name: "Disconnect", exact: true }).last().click();
  await deleteResponse;
  await expect(page.getByText("No accounts connected")).toBeVisible({ timeout: 15_000 });
});