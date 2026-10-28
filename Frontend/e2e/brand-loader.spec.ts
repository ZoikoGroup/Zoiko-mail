import { test, expect, type Locator, type Page } from "@playwright/test";
import { ADMIN_CAPABILITIES, json } from "./admin-harness";

/**
 * The loading screen (components/ui/BrandLoader.tsx), in every workspace.
 *
 * The session check (/auth/me) is held open for as long as each test wants,
 * so the loader is seen while it should be, gone once the workspace is known,
 * and offering a way out when the API is slow — without the page freezing.
 */

type Workspace = "MEMBER" | "ADMIN" | "OWNER" | "SUPPORT";

const ROLE: Record<Workspace, string> = { MEMBER: "MEMBER", ADMIN: "ADMIN", OWNER: "OWNER", SUPPORT: "SUPPORT" };

/**
 * Endpoints whose screen reads fields straight off the answer, so the generic
 * `{ items: [], count: 0 }` stub would crash it after the handover.
 */
const SHAPED: Record<string, unknown> = {
  // Without it the admin console's permission check fails and retries, which
  // is real waiting: the activity bar would rightly show.
  "/users/me/capabilities": { capabilities: ADMIN_CAPABILITIES, decisions: [] },
  "/tenants/onboarding-status": {
    steps: {
      workspaceCreated: true,
      domainAdded: true,
      domainVerified: true,
      mailboxCreated: true,
      providerConnected: true,
      teamInvited: true,
    },
    completedCount: 6,
    totalSteps: 6,
    isComplete: true,
  },
};

/**
 * Stubs the API, signs in as `workspace`, and holds /auth/me until released.
 * With `holdData`, every other call (the workspace's own data) is held too,
 * until `releaseData()`.
 */
async function stubSession(page: Page, workspace: Workspace, opts: { theme?: "dark" | "light"; holdData?: boolean } = {}) {
  let release!: () => void;
  const released = new Promise<void>((resolve) => (release = resolve));
  let releaseData!: () => void;
  const dataReleased = opts.holdData ? new Promise<void>((resolve) => (releaseData = resolve)) : Promise.resolve();
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));

  await page.addInitScript(
    ({ theme }) => {
      localStorage.setItem("zoiko.access_token", "stub-access-token");
      localStorage.setItem("zoiko.refresh_token", "stub-refresh-token");
      if (theme) localStorage.setItem("theme", theme);
    },
    { theme: opts.theme ?? "light" }
  );
  await page.route(
    (url) => url.pathname.startsWith("/api/v1/"),
    async (route) => {
      const path = new URL(route.request().url()).pathname.replace("/api/v1", "");
      if (path === "/events/stream") return route.fulfill({ status: 200, contentType: "text/event-stream", body: "" });
      if (path === "/auth/me") {
        await released;
        return route.fulfill(
          json({
            id: "u1",
            email: "pat@acme.test",
            displayName: "Pat Example",
            tenant: { id: "t1", name: "Acme Corp", planCode: "business" },
            membership: { id: "m1", role: ROLE[workspace] },
            workspace,
          })
        );
      }
      await dataReleased;
      if (path in SHAPED) return route.fulfill(json(SHAPED[path]));
      return route.fulfill(json({ items: [], count: 0 }));
    }
  );
  return { release, releaseData: () => releaseData?.(), errors };
}

const loader = (page: Page) => page.getByTestId("brand-loader");

/**
 * The dev server compiles a route on its first visit, which can take longer
 * than the loader's 10-second slow notice. Compile it before the timed visit,
 * so a test about "not slow yet" is not measuring the compiler.
 */
async function warm(page: Page, path: string) {
  await page.request.get(path, { timeout: 120_000 });
}

/**
 * `landmark` is something only that workspace renders once it has taken over,
 * so a session the shell turned away (a redirect to /login) cannot pass.
 * /account rather than /inbox for AppShell: /inbox, /ai, /digest and
 * /notifications redirect to /mail on mount.
 */
const WORKSPACES: { name: string; workspace: Workspace; path: string; label: RegExp; landmark: (page: Page) => Locator }[] = [
  { name: "member home", workspace: "MEMBER", path: "/account", label: /Loading your workspace/, landmark: (p) => p.getByText("Acme Corp").first() },
  { name: "member mail", workspace: "MEMBER", path: "/mail", label: /Loading Zoiko Mail/, landmark: (p) => p.getByText("Work Graph").first() },
  { name: "admin", workspace: "ADMIN", path: "/admin", label: /Opening the admin workspace/, landmark: (p) => p.getByText("Admin workspace") },
  { name: "owner", workspace: "OWNER", path: "/owner", label: /Opening the owner workspace/, landmark: (p) => p.getByText("Users & Roles").first() },
  { name: "support", workspace: "SUPPORT", path: "/support", label: /Opening the support workspace/, landmark: (p) => p.getByRole("button", { name: /Workspace Overview/ }) },
];

for (const w of WORKSPACES) {
  test(`${w.name}: shows the logo loader while the session loads, then hands over to the workspace`, async ({ page }) => {
    const { release, errors } = await stubSession(page, w.workspace);
    await warm(page, w.path);
    await page.goto(w.path);

    const l = loader(page);
    await expect(l).toBeVisible();
    await expect(l).toHaveAttribute("role", "status");
    await expect(l).toHaveAttribute("aria-live", "polite");
    // No aria-busy: screen readers may hold back a busy region's updates,
    // which would swallow the slow-load notice.
    await expect(l).not.toHaveAttribute("aria-busy", /.*/);
    await expect(l.locator('img[src*="zoiko-icon"]')).toBeVisible();
    await expect(l.getByRole("img", { name: "Zoiko Mail" }).first()).toBeVisible();
    await expect(l).toContainText(w.label);
    // A normal wait never shows the slow-load notice.
    await expect(l.getByTestId("brand-loader-slow")).toBeHidden();

    // Nothing broke while the loader was up. (Errors after the handover come
    // from the workspace's own screens reading this spec's generic API stubs,
    // which are not the loader's to answer for.)
    expect(errors).toEqual([]);
    release();
    await expect(loader(page)).toHaveCount(0, { timeout: 60_000 });
    await expect(w.landmark(page)).toBeVisible({ timeout: 30_000 });
    await expect(page).toHaveURL(new RegExp(`${w.path}$`));
  });
}

test("a slow session check offers Reload instead of freezing, and recovers once the API answers", async ({ page }) => {
  test.setTimeout(120_000);
  const { release } = await stubSession(page, "ADMIN");
  await warm(page, "/admin");
  await page.goto("/admin");
  const l = loader(page);
  await expect(l).toBeVisible();

  // The page stays responsive while waiting: the notice arrives on its own at ~10s.
  const slow = l.getByTestId("brand-loader-slow");
  await expect(slow).toBeHidden();
  await expect(slow).toBeVisible({ timeout: 20_000 });
  await expect(slow).toContainText("Taking longer than usual.");

  // Reload really reloads: the loader starts over, with the notice hidden again.
  await Promise.all([page.waitForEvent("load"), slow.getByRole("button", { name: "Reload" }).click()]);
  await expect(loader(page)).toBeVisible();
  await expect(loader(page).getByTestId("brand-loader-slow")).toBeHidden();

  release();
  await expect(loader(page)).toHaveCount(0, { timeout: 60_000 });
  await expect(page.getByText("Admin workspace")).toBeVisible();
});

test("API calls the user is waiting on show the slim top bar, which leaves when they answer", async ({ page }) => {
  const { release, releaseData } = await stubSession(page, "ADMIN", { holdData: true });
  release();
  await warm(page, "/admin");
  await page.goto("/admin");
  await expect(page.getByText("Admin workspace")).toBeVisible({ timeout: 60_000 });

  // The dashboard's first loads are held: the bar shows (after its 300ms grace).
  const bar = page.getByTestId("api-activity");
  await expect(bar).toBeVisible();
  // Not a full-screen loader: the console stays on screen around it.
  await expect(page.getByText("Admin workspace")).toBeVisible();

  releaseData();
  await expect(bar).toHaveCount(0, { timeout: 15_000 });
});

test("quick API calls never show the top bar", async ({ page }) => {
  const { release } = await stubSession(page, "ADMIN");
  release();
  await warm(page, "/admin");
  await page.goto("/admin");
  await expect(page.getByText("Admin workspace")).toBeVisible({ timeout: 60_000 });
  // Watch for a while: every call answers at once, so the bar must never appear.
  const seen = await page.evaluate(
    () =>
      new Promise<boolean>((resolve) => {
        const observer = new MutationObserver(() => {
          if (document.querySelector('[data-testid="api-activity"]')) resolve(true);
        });
        observer.observe(document.body, { childList: true, subtree: true });
        setTimeout(() => resolve(Boolean(document.querySelector('[data-testid="api-activity"]'))), 2500);
      })
  );
  expect(seen).toBe(false);
});

test("follows the dark theme: the light wordmark is swapped for the dark one", async ({ page }) => {
  const { release } = await stubSession(page, "OWNER", { theme: "dark" });
  await page.goto("/owner");
  const l = loader(page);
  await expect(l.locator('img[src*="zoiko-wordmark-dark"]')).toBeVisible();
  await expect(l.locator('img[src*="zoiko-wordmark.png"]')).toBeHidden();
  release();
  await expect(loader(page)).toHaveCount(0, { timeout: 60_000 });
});

test("is in the server-rendered HTML, so it shows before any script has run", async ({ request }) => {
  const html = await (await request.get("/admin")).text();
  expect(html).toContain('data-testid="brand-loader"');
  expect(html).toContain("zoiko-icon");
});
