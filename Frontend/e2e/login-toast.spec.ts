import { test, expect, type BrowserContext, type Page } from "@playwright/test";
import { useRealWorkspace, signIn, signInStaff, answerMfa } from "./real-harness";

/**
 * The "Login Successful" toast (components/ui/Toast.tsx, raised by
 * routeAuthState in lib/auth-hooks.ts), against the real API and database:
 * every workspace's real sign-in, the Owner's through the workspace picker
 * and every staff one through its second factor.
 */

const getFixture = useRealWorkspace({ staff: true });

const loginToast = (page: Page) => page.getByTestId("toast-success");

interface ToastRecord {
  appearedAt: number;
  removedAt: number | null;
  /** Whether the full-screen loading screen was still in the page when the toast appeared. */
  loaderUp: boolean;
  path: string;
}

/**
 * Records, from before the first page loads, each "Login Successful" toast's
 * life (when it entered and left the page), whether the loading screen was up
 * when it appeared, and the most toasts ever on screen at once.
 */
async function recordToasts(context: BrowserContext) {
  await context.addInitScript(() => {
    const w = window as unknown as { __toasts: ToastRecord[]; __maxToasts: number };
    w.__toasts = [];
    w.__maxToasts = 0;
    const live = new Map<Element, ToastRecord>();
    new MutationObserver(() => {
      const now = performance.now();
      const all = Array.from(document.querySelectorAll('[data-testid="toast-success"]'));
      w.__maxToasts = Math.max(w.__maxToasts, all.length);
      for (const el of all) {
        if (live.has(el)) continue;
        const record = { appearedAt: now, removedAt: null, loaderUp: Boolean(document.querySelector(".nav-loader")), path: location.pathname };
        live.set(el, record);
        w.__toasts.push(record);
      }
      live.forEach((record, el) => {
        if (!el.isConnected && record.removedAt === null) record.removedAt = now;
      });
    }).observe(document, { childList: true, subtree: true });
  });
}

/**
 * Exactly one toast, "Login Successful" with its success icon, top-right just
 * below the workspace's header without overlapping it, shown once the
 * workspace is on screen, and gone on its own after 2 seconds.
 */
async function expectLoginToast(page: Page, workspacePath: RegExp) {
  const t = loginToast(page);
  await expect(t).toBeVisible({ timeout: 60_000 });
  await expect(t).toHaveCount(1);
  await expect(t).toHaveText("Login Successful");
  await expect(t).toHaveAttribute("role", "status");
  await expect(t.locator("svg").first()).toBeVisible();
  await expect(page).toHaveURL(workspacePath);

  // Placement: the stack's own box (the toast inside it slides), measured
  // once the entrance has finished.
  await page.waitForTimeout(400);
  const placement = await page.evaluate(() => {
    const stack = document.querySelector('[data-testid="toaster"]')!.getBoundingClientRect();
    const toastBox = document.querySelector('[data-testid="toast-success"]')!.getBoundingClientRect();
    const header = Array.from(document.querySelectorAll("[data-app-header]"))
      .map((el) => el.getBoundingClientRect())
      .find((r) => r.height > 0)!;
    return {
      stackTop: stack.top,
      toastTop: toastBox.top,
      headerBottom: header?.bottom ?? null,
      rightGap: window.innerWidth - toastBox.right,
      inUpperHalf: toastBox.bottom < window.innerHeight / 2,
    };
  });
  expect(placement.headerBottom, "the workspace's header is on screen").not.toBeNull();
  expect(placement.toastTop, "below the header, never over it").toBeGreaterThanOrEqual(placement.headerBottom!);
  expect(placement.stackTop - placement.headerBottom!, "just below the header").toBeLessThanOrEqual(16);
  expect(placement.rightGap, "against the right edge").toBeGreaterThanOrEqual(12);
  expect(placement.rightGap).toBeLessThanOrEqual(20);
  expect(placement.inUpperHalf).toBe(true);

  // Gone on its own: 2 s on screen plus its 0.3 s exit.
  await expect(t).toHaveCount(0, { timeout: 5_000 });
  const { toasts, max } = await page.evaluate(() => {
    const w = window as unknown as { __toasts: ToastRecord[]; __maxToasts: number };
    return { toasts: w.__toasts, max: w.__maxToasts };
  });
  expect(max, "never two at once").toBe(1);
  expect(toasts, "shown once").toHaveLength(1);
  const [record] = toasts;
  expect(record!.loaderUp, "shown once the loading screen has left, not under it").toBe(false);
  expect(record!.path).toMatch(workspacePath);
  const life = record!.removedAt! - record!.appearedAt;
  expect(life, `on the page for ${Math.round(life)}ms`).toBeGreaterThanOrEqual(2_000);
  expect(life, `on the page for ${Math.round(life)}ms`).toBeLessThanOrEqual(2_700);
}

test("member: a successful sign-in shows one toast below the mail header", async ({ browser }) => {
  const f = getFixture();
  const { page } = await signIn(browser, f.recipient.address, f.password, recordToasts);
  await expectLoginToast(page, /\/mail/);
  await expect(page.getByRole("navigation", { name: "Workspace sections" })).toBeVisible();
});

test("member: a wrong password shows no toast", async ({ browser }) => {
  const f = getFixture();
  const page = await (await browser.newContext()).newPage();
  await page.goto("/login/member");
  await page.getByPlaceholder("john@example.com").fill(f.recipient.address);
  await page.getByPlaceholder("Enter your password").fill(`${f.password}-wrong`);
  const answered = page.waitForResponse((r) => r.url().includes("/auth/login"), { timeout: 120_000 });
  await page.getByRole("button", { name: "Sign In to Member Workspace" }).click();
  expect((await answered).status()).toBeGreaterThanOrEqual(400);
  await page.waitForTimeout(2000);
  await expect(loginToast(page)).toHaveCount(0);
  await expect(page).toHaveURL(/\/login\/member/);
});

test("admin: no toast at the second-factor step, then one once the code is accepted", async ({ browser }) => {
  const f = getFixture();
  const account = f.staff!.ADMIN;
  const context = await browser.newContext();
  await recordToasts(context);
  const page = await context.newPage();
  await page.goto("/login");
  await page.getByPlaceholder("john@example.com").fill(account.email);
  await page.getByPlaceholder("Enter your password").fill(f.password);
  await page.getByRole("button", { name: "Sign In", exact: true }).click();
  // The password is right but there is no session yet: nothing to announce.
  await expect(page).toHaveURL(/\/verify-mfa/, { timeout: 120_000 });
  await page.waitForTimeout(1500);
  await expect(loginToast(page)).toHaveCount(0);

  await answerMfa(page, account.mfaSecret);
  await expectLoginToast(page, /\/admin/);
});

test("owner: through the workspace picker and the second factor, one toast", async ({ browser }) => {
  const { page } = await signInStaff(browser, getFixture(), "OWNER", recordToasts);
  await expectLoginToast(page, /\/owner/);
});

test("support: one toast below the support console's header", async ({ browser }) => {
  const { page } = await signInStaff(browser, getFixture(), "SUPPORT", recordToasts);
  await expectLoginToast(page, /\/support/);
});
