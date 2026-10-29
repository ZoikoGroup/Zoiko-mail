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
  // Contacts reads these shapes directly; an empty workspace's answers.
  "/contacts": { items: [], pagination: { page: 1, limit: 25, total: 0, totalPages: 0 } },
  "/contacts/summary": { all: 0, mine: 0, personal: 0, shared: 0, favorites: 0, directory: 0, groups: [] },
  "/contacts/tags": [],
  "/contacts/directory": [],
  "/contacts/other": [],
  // Without it the admin console's permission check fails and retries, which
  // is real waiting: the loading screen would rightly stay.
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

/**
 * The loader in view. On a first load the navigation loading screen waits,
 * invisible, under the page's own full-screen loader, so only visible ones count.
 */
const loader = (page: Page) => page.locator('[data-testid="brand-loader"]:visible');

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
 * /contacts rather than /inbox for AppShell: /inbox, /ai, /digest and
 * /notifications redirect to /mail on mount, and /account and /settings to
 * Settings in Mail.
 */
const WORKSPACES: { name: string; workspace: Workspace; path: string; label: RegExp; landmark: (page: Page) => Locator }[] = [
  { name: "member home", workspace: "MEMBER", path: "/contacts", label: /Loading your workspace/, landmark: (p) => p.getByText("Acme Corp").first() },
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
  const reloadStarted = Date.now();
  await Promise.all([page.waitForEvent("load"), slow.getByRole("button", { name: "Reload" }).click()]);
  await expect(loader(page)).toBeVisible();
  // Only meaningful if the reload itself was quicker than the notice's 10s:
  // a dev server busy recompiling can take longer, and then the notice is
  // rightly back by the time the page has loaded.
  if (Date.now() - reloadStarted < 9_000) {
    await expect(loader(page).getByTestId("brand-loader-slow")).toBeHidden();
  }

  release();
  await expect(loader(page)).toHaveCount(0, { timeout: 60_000 });
  await expect(page.getByText("Admin workspace")).toBeVisible();
});

/** Holds every API call whose path starts with `prefix` until the returned function is called. */
async function holdPrefix(page: Page, prefix: string) {
  let release!: () => void;
  const released = new Promise<void>((resolve) => (release = resolve));
  await page.route(
    (url) => url.pathname.startsWith(`/api/v1${prefix}`),
    async (route) => {
      await released;
      await route.fallback();
    }
  );
  return release;
}

/** How long (ms) the navigation loading screen was actually visible during `ms`: 0 if never. */
function navLoaderVisibleMs(page: Page, ms: number) {
  return page.evaluate(
    (wait) =>
      new Promise<number>((resolve) => {
        let firstSeen = 0;
        let lastSeen = 0;
        const tick = () => {
          const el = document.querySelector('[data-testid="navigation-loader"] [data-testid="brand-loader"]');
          if (el && Number(getComputedStyle(el).opacity) > 0.05 && el.getBoundingClientRect().height > 0) {
            const now = performance.now();
            firstSeen ||= now;
            lastSeen = now;
          }
        };
        const timer = setInterval(tick, 16);
        setTimeout(() => {
          clearInterval(timer);
          resolve(firstSeen ? lastSeen - firstSeen : 0);
        }, wait);
      }),
    ms
  );
}

test("moving to another page shows the loading screen until that page's data is ready", async ({ page }) => {
  const { release } = await stubSession(page, "MEMBER");
  release();
  await warm(page, "/mail");
  await warm(page, "/mail/contacts");
  await page.setViewportSize({ width: 1500, height: 900 });
  await page.goto("/mail");
  const sections = page.getByRole("navigation", { name: "Workspace sections" });
  await expect(sections).toBeVisible({ timeout: 60_000 });

  // The contacts' data is slow: the loading screen covers the move...
  const releaseContacts = await holdPrefix(page, "/contacts");
  await sections.locator('a[href="/mail/contacts"]').first().click();
  const navLoader = page.getByTestId("navigation-loader");
  await expect(navLoader.getByTestId("brand-loader")).toBeVisible();
  await expect(page).toHaveURL(/\/mail\/contacts$/, { timeout: 30_000 });
  // ...and is still there once the page has rendered, while its data loads.
  await page.waitForTimeout(1500);
  await expect(navLoader).toBeVisible();

  // The data answers: the loading screen leaves, the contacts page is there.
  releaseContacts();
  await expect(navLoader).toHaveCount(0, { timeout: 15_000 });
  await expect(page.getByRole("heading", { name: /Contacts & People Directory/ })).toBeVisible();
});

test("going back to a page that is already loaded never flickers the loading screen", async ({ page }) => {
  const { release } = await stubSession(page, "MEMBER");
  release();
  await warm(page, "/mail");
  await warm(page, "/mail/contacts");
  await page.setViewportSize({ width: 1500, height: 900 });
  await page.goto("/mail/contacts");
  const sections = page.getByRole("navigation", { name: "Workspace sections" });
  await expect(sections).toBeVisible({ timeout: 60_000 });
  // Load Mail once, then come back to Contacts and return to Mail: both are cached.
  await sections.locator('a[href="/mail"]').first().click();
  await expect(page).toHaveURL(/\/mail$/, { timeout: 30_000 });
  await expect(page.getByTestId("navigation-loader")).toHaveCount(0, { timeout: 30_000 });
  await sections.locator('a[href="/mail/contacts"]').first().click();
  await expect(page.getByTestId("navigation-loader")).toHaveCount(0, { timeout: 30_000 });

  // Its data is cached, so there is little or nothing to wait for. Either the
  // loader never shows, or (when fetching the page itself takes over 140ms, as
  // on a dev server) it shows for its full minimum and fades: never a flicker.
  const visibleMs = navLoaderVisibleMs(page, 4000);
  await sections.locator('a[href="/mail"]').first().click();
  const shown = await visibleMs;
  expect(shown === 0 || shown >= 250, `visible for ${Math.round(shown)}ms`).toBe(true);
  await expect(page).toHaveURL(/\/mail$/);
  await expect(page.getByTestId("navigation-loader")).toHaveCount(0, { timeout: 15_000 });
});

test("admin: moving between console pages shows the loading screen until the page is ready", async ({ page }) => {
  const { release } = await stubSession(page, "ADMIN");
  release();
  await warm(page, "/admin");
  await warm(page, "/admin/audit");
  await page.goto("/admin");
  await expect(page.getByText("Admin workspace")).toBeVisible({ timeout: 60_000 });

  const releaseAudit = await holdPrefix(page, "/audit");
  await page.locator('a[href="/admin/audit"]').first().click();
  const navLoader = page.getByTestId("navigation-loader");
  await expect(navLoader.getByTestId("brand-loader")).toBeVisible();
  await expect(page).toHaveURL(/\/admin\/audit$/, { timeout: 30_000 });
  await page.waitForTimeout(1500);
  await expect(navLoader).toBeVisible();
  releaseAudit();
  await expect(navLoader).toHaveCount(0, { timeout: 15_000 });
});

test("there is no top progress bar: a page move shows the full-screen loading screen and nothing else", async ({ page }) => {
  const { release } = await stubSession(page, "MEMBER");
  release();
  await warm(page, "/mail");
  await warm(page, "/mail/contacts");
  await page.setViewportSize({ width: 1500, height: 900 });
  await page.goto("/mail");
  const sections = page.getByRole("navigation", { name: "Workspace sections" });
  await expect(sections).toBeVisible({ timeout: 60_000 });

  const releaseContacts = await holdPrefix(page, "/contacts");
  await sections.locator('a[href="/mail/contacts"]').first().click();
  const navLoader = page.getByTestId("navigation-loader");
  await expect(navLoader.getByTestId("brand-loader")).toBeVisible();
  await expect(page).toHaveURL(/\/mail\/contacts$/, { timeout: 30_000 });
  await page.waitForTimeout(1000);
  // One loader in view, the full-screen one, and no bar.
  await expect(loader(page)).toHaveCount(1);
  await expect(navLoader.getByTestId("brand-loader")).toHaveAttribute("data-variant", "screen");
  await expect(page.locator(".route-progress")).toHaveCount(0);
  releaseContacts();
  await expect(navLoader).toHaveCount(0, { timeout: 15_000 });
  await expect(page.locator(".route-progress")).toHaveCount(0);
});

test("a page move started from code (router.push) shows the loading screen too", async ({ page }) => {
  const { release } = await stubSession(page, "MEMBER");
  release();
  await warm(page, "/mail");
  await warm(page, "/mail/contacts");
  await page.setViewportSize({ width: 1500, height: 900 });
  await page.goto("/mail");
  await expect(page.getByRole("navigation", { name: "Workspace sections" })).toBeVisible({ timeout: 60_000 });

  // The same router object every component's useRouter() returns: what a
  // notification click, a redirect or a "View commitments" button calls.
  const releaseContacts = await holdPrefix(page, "/contacts");
  await page.evaluate(() => (window as unknown as { next: { router: { push(href: string): void } } }).next.router.push("/mail/contacts"));
  const navLoader = page.getByTestId("navigation-loader");
  await expect(navLoader.getByTestId("brand-loader")).toBeVisible();
  await expect(page).toHaveURL(/\/mail\/contacts$/, { timeout: 30_000 });
  await page.waitForTimeout(1000);
  await expect(navLoader).toBeVisible();
  releaseContacts();
  await expect(navLoader).toHaveCount(0, { timeout: 15_000 });
  await expect(page.getByRole("heading", { name: /Contacts & People Directory/ })).toBeVisible();

  // A query-only change (an in-page tab) is not a page move: no loading screen.
  await page.evaluate(() => (window as unknown as { next: { router: { push(href: string): void } } }).next.router.push("/mail/contacts?view=mine"));
  await expect(page).toHaveURL(/view=mine/);
  await expect(navLoader).toHaveCount(0);
});

test("first load: one full-screen loading screen from the session check until the page's data is in", async ({ page }) => {
  const { release } = await stubSession(page, "MEMBER");
  const releaseContacts = await holdPrefix(page, "/contacts");
  await warm(page, "/mail/contacts");
  await page.setViewportSize({ width: 1500, height: 900 });
  await page.goto("/mail/contacts");
  // The session check: the page's own full-screen loader, the only one in view.
  await expect(loader(page)).toHaveCount(1);
  await expect(loader(page)).toHaveAttribute("data-variant", "screen");

  // The session answers but the contacts are slow: the full-screen loading
  // screen stays (continuing the same one) instead of handing over to the
  // smaller loaders inside the page.
  release();
  const navLoader = page.getByTestId("navigation-loader");
  await expect(navLoader.getByTestId("brand-loader")).toBeVisible({ timeout: 30_000 });
  // It faded in while waiting underneath, so it takes over at full strength:
  // no blank frame and no second fade-in.
  await expect(navLoader.getByTestId("brand-loader")).toHaveCSS("opacity", "1");
  await page.waitForTimeout(1500);
  await expect(loader(page)).toHaveCount(1);
  await expect(navLoader.getByTestId("brand-loader")).toBeVisible();

  releaseContacts();
  await expect(navLoader).toHaveCount(0, { timeout: 15_000 });
  await expect(loader(page)).toHaveCount(0);
  await expect(page.getByRole("heading", { name: /Contacts & People Directory/ })).toBeVisible();
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
