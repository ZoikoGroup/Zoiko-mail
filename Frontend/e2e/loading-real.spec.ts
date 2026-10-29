import { test, expect, type APIRequestContext, type Page } from "@playwright/test";
import path from "node:path";
import { readFileSync } from "node:fs";
import { API, answerMfa, signIn, signInStaff, useRealWorkspace } from "./real-harness";

/**
 * The loading experience on the real app: the real API and database, real
 * sign-ins (with second factors for staff), real mail with a real PDF.
 *
 * Nothing is stubbed. To make each loader observable, chosen requests are held
 * for a moment and then passed through to the real API unchanged (`slow`),
 * the way a slow network or a busy server would hold them.
 */

const getFixture = useRealWorkspace({ staff: true });
test.describe.configure({ mode: "serial" });

const SUBJECT = "Loader check: Q4 budget sign-off";
const key = (p: string) => `${p}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
const loader = (page: Page, text?: RegExp) =>
  text ? page.getByTestId("brand-loader").filter({ hasText: text }) : page.getByTestId("brand-loader");

/** Holds API calls that match, for `ms`, then lets them through to the real API. */
async function slow(page: Page, match: (path: string, url: URL, method: string) => boolean, ms: number) {
  await page.route(
    (url) => url.pathname.startsWith("/api/v1/"),
    async (route) => {
      const url = new URL(route.request().url());
      const apiPath = url.pathname.replace("/api/v1", "");
      if (match(apiPath, url, route.request().method())) await new Promise((r) => setTimeout(r, ms));
      await route.fallback();
    }
  );
}

async function memberToken(request: APIRequestContext, email: string) {
  const res = await request.post(`${API}/auth/login`, { data: { email, password: getFixture().password, workspace: "MEMBER" } });
  return (await res.json()).data.accessToken as string;
}

const isMessage = (p: string) => /^\/mail\/[0-9a-f-]{36}$/.test(p);

test("member: first load, inbox, an open email, search and an attachment preview each show the loader", async ({ browser, request }) => {
  const f = getFixture();
  // Real mail with a real PDF, from one member to the other.
  const sender = await memberToken(request, f.sender.address);
  const h = () => ({ Authorization: `Bearer ${sender}`, "Idempotency-Key": key("mail") });
  const draft = await (
    await request.post(`${API}/mail/drafts`, {
      headers: h(),
      data: { subject: SUBJECT, textBody: "Please approve the attached plan by Friday.", recipients: { to: [f.recipient.address] } },
    })
  ).json();
  await request.post(`${API}/mail/drafts/${draft.data.id}/attachments`, {
    headers: h(),
    multipart: { file: { name: "Quarterly Plan.pdf", mimeType: "application/pdf", buffer: readFileSync(path.join(__dirname, "fixtures", "Quarterly Plan.pdf")) } },
  });
  await request.post(`${API}/mail/drafts/${draft.data.id}/send`, { headers: h() });

  const { context } = await signIn(browser, f.recipient.address, f.password);
  const page = await context.newPage();
  await page.setViewportSize({ width: 1500, height: 900 });

  // 1. Initial load: the session check is slow. The full-screen loader shows
  //    first, then the mail workspace.
  await slow(page, (p) => p === "/auth/me", 2500);
  await page.goto("/mail");
  await expect(loader(page).first()).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Workspace sections" })).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText(SUBJECT).first()).toBeVisible({ timeout: 60_000 });
  await page.unrouteAll({ behavior: "wait" });

  // 2. Inbox loading: the list is slow. The list pane shows its own loader
  //    inside the shell, and the top bar says the app is waiting.
  await slow(page, (p, _u, m) => p === "/mail" && m === "GET", 3000);
  await page.reload();
  await expect(loader(page, /Loading messages/)).toBeVisible({ timeout: 60_000 });
  await expect(page.getByRole("navigation", { name: "Workspace sections" })).toBeVisible();
  await expect(page.getByTestId("api-activity")).toBeVisible();
  await expect(page.getByText(SUBJECT).first()).toBeVisible({ timeout: 60_000 });
  await expect(loader(page, /Loading messages/)).toHaveCount(0);
  await page.unrouteAll({ behavior: "wait" });

  // 3. Opening an email: the message is slow. The reading pane shows a loader,
  //    then the email. Its attachment is slower still (installed now: the
  //    tile downloads the file as soon as the email opens, and the viewer
  //    reuses that download).
  await slow(page, (p, _u, m) => isMessage(p) && m === "GET", 3000);
  await slow(page, (p) => /\/attachments\/[^/]+$/.test(p), 9000);
  await page.getByText(SUBJECT).first().click();
  await expect(loader(page, /Loading this email/)).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole("heading", { name: SUBJECT })).toBeVisible({ timeout: 60_000 });

  // 4. Attachment processing: the file is still downloading. The tile shows
  //    its small indicator, and the viewer opened meanwhile shows the loader,
  //    then the PDF.
  await expect(page.getByRole("status", { name: "Loading preview of Quarterly Plan.pdf" }).first()).toBeVisible();
  await page.getByRole("button", { name: "Preview Quarterly Plan.pdf" }).last().click();
  const viewer = page.getByRole("dialog", { name: "Preview of Quarterly Plan.pdf" });
  await expect(viewer.getByTestId("brand-loader").filter({ hasText: /Preparing preview/ })).toBeVisible({ timeout: 30_000 });
  await expect(viewer.locator("iframe")).toBeVisible({ timeout: 60_000 });
  await page.keyboard.press("Escape");
  await page.unrouteAll({ behavior: "wait" });

  // 5. Search: the search results are slow. The list says it is searching,
  //    then shows the match.
  await slow(page, (p, u, m) => p === "/mail" && m === "GET" && /budget/i.test(u.search), 3000);
  await page.getByRole("combobox", { name: /Search mail/ }).fill("budget");
  await page.getByRole("combobox", { name: /Search mail/ }).press("Enter");
  await expect(loader(page, /Searching/)).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(SUBJECT).first()).toBeVisible({ timeout: 60_000 });
  await expect(loader(page, /Searching/)).toHaveCount(0);
  await context.close();
});

test("member: moving between sections keeps the shell and shows each section's loader, never a blank page", async ({ browser }) => {
  const f = getFixture();
  const { context, page } = await signIn(browser, f.recipient.address, f.password);
  await page.setViewportSize({ width: 1500, height: 900 });
  // Every data request is slow; the session and live stream are not.
  await slow(page, (p, _u, m) => m === "GET" && p !== "/auth/me" && p !== "/events/stream", 2000);

  const sections = page.getByRole("navigation", { name: "Workspace sections" });
  for (const href of ["/mail/calendar", "/mail/tasks", "/mail/contacts", "/mail/work-graph"]) {
    await sections.locator(`a[href="${href}"]`).first().click();
    await expect(page).toHaveURL(new RegExp(`${href}(\\?|$)`), { timeout: 60_000 });
    // Something says it is loading, inside the shell: the brand loader, a
    // status, or a known layout's shimmer skeleton.
    await expect(page.locator('[data-testid="brand-loader"]:visible, [role="status"]:visible, .zoi-skeleton:visible').first()).toBeVisible({ timeout: 30_000 });
    await expect(sections).toBeVisible();
    // And the section finishes: no loader is left behind.
    await expect(loader(page)).toHaveCount(0, { timeout: 60_000 });
  }

  // Back to a section already loaded this session: it comes from the cache,
  // with nothing to wait for, so no loader, just the inbox at once.
  await sections.locator('a[href="/mail"]').first().click();
  await expect(page.getByText(SUBJECT).first()).toBeVisible({ timeout: 5_000 });
  await expect(loader(page, /Loading messages/)).toHaveCount(0);
  await context.close();
});

test("slow and failed requests: the slow notice offers Try again, and a failed load offers Retry", async ({ browser }) => {
  const f = getFixture();
  const { context, page } = await signIn(browser, f.recipient.address, f.password);
  await page.setViewportSize({ width: 1500, height: 900 });

  // Slow: the inbox takes 13s. At 10s the loader offers Try again, and the
  // page stays usable throughout.
  await slow(page, (p, _u, m) => p === "/mail" && m === "GET", 13_000);
  await page.reload();
  const list = loader(page, /Loading messages/);
  await expect(list).toBeVisible({ timeout: 60_000 });
  await expect(list.getByTestId("brand-loader-slow")).toBeVisible({ timeout: 15_000 });
  await expect(list.getByRole("button", { name: "Try again" })).toBeVisible();
  await page.getByRole("navigation", { name: "Workspace sections" }).locator('a[href="/mail/calendar"]').hover();
  await expect(page.getByText(SUBJECT).first()).toBeVisible({ timeout: 60_000 });
  await page.unrouteAll({ behavior: "wait" });

  // Failed: the inbox request fails. The pane says so, with a way to retry,
  // which then loads the real inbox.
  let fail = true;
  await page.route(
    (url) => url.pathname === "/api/v1/mail",
    async (route) => (fail && route.request().method() === "GET" ? route.abort("failed") : route.fallback())
  );
  await page.reload();
  const failed = page.getByRole("alert").filter({ hasText: /Couldn.t load this folder/ });
  await expect(failed).toBeVisible({ timeout: 60_000 });
  fail = false;
  await failed.getByRole("button").first().click();
  await expect(page.getByText(SUBJECT).first()).toBeVisible({ timeout: 60_000 });
  await context.close();
});

const CONSOLES = [
  { role: "ADMIN", path: "/admin", label: /Opening the admin workspace/, landmark: (p: Page) => p.getByText("Admin workspace"), next: "/admin/audit" },
  { role: "OWNER", path: "/owner", label: /Opening the owner workspace/, landmark: (p: Page) => p.getByText("Users & Roles").first(), next: "/owner/usage" },
  { role: "SUPPORT", path: "/support", label: /Opening the support workspace/, landmark: (p: Page) => p.getByRole("button", { name: /Workspace Overview/ }), next: null },
] as const;

for (const c of CONSOLES) {
  test(`${c.role.toLowerCase()} workspace: opens behind the loader and keeps its frame while pages load`, async ({ browser }) => {
    const { context } = await signInStaff(browser, getFixture(), c.role);
    const page = await context.newPage();
    await page.setViewportSize({ width: 1500, height: 900 });

    // Initial load with a slow session check: the full-screen loader, then the console.
    await slow(page, (p) => p === "/auth/me", 2500);
    await page.goto(c.path);
    await expect(loader(page, c.label)).toBeVisible({ timeout: 60_000 });
    await expect(c.landmark(page)).toBeVisible({ timeout: 60_000 });
    await page.unrouteAll({ behavior: "wait" });

    if (c.next) {
      // A page transition with slow data: the console's frame stays, the
      // content area says it is loading, then the page arrives.
      await slow(page, (p, _u, m) => m === "GET" && p !== "/auth/me" && p !== "/events/stream", 2000);
      await page.locator(`a[href="${c.next}"]`).first().click();
      await expect(page).toHaveURL(new RegExp(`${c.next}$`), { timeout: 60_000 });
      await expect(page.locator('[data-testid="brand-loader"]:visible, [role="status"]:visible, .zoi-skeleton:visible').first()).toBeVisible({ timeout: 30_000 });
      await expect(c.landmark(page)).toBeVisible();
      await expect(loader(page)).toHaveCount(0, { timeout: 60_000 });
    }
    await context.close();
  });
}

test("workspace switching: the picker and the move into the other workspace show the loader, not a blank page", async ({ browser }) => {
  const f = getFixture();
  const { context, page } = await signInStaff(browser, f, "OWNER");
  await page.setViewportSize({ width: 1500, height: 900 });
  await expect(page.getByText("Users & Roles").first()).toBeVisible({ timeout: 60_000 });

  // Every auth step is slow, so whatever screen covers each wait is visible.
  await slow(page, (p, _u, m) => m === "POST" && p.startsWith("/auth/"), 2500);

  // Switching signs out (a session belongs to one workspace): the loader
  // covers it, and sign-in says why it is there.
  await page.getByRole("button", { name: "Account menu" }).click();
  await page.getByRole("menuitem", { name: /Switch workspace/ }).click();
  await expect(loader(page, /Signing out to switch workspace/)).toBeVisible({ timeout: 10_000 });
  await expect(page).toHaveURL(/\/login$/, { timeout: 60_000 });
  await expect(page.getByText("To open another workspace, sign in again and choose it.")).toBeVisible();

  // Signing in again offers both workspaces.
  await page.getByPlaceholder("john@example.com").fill(f.staff!.OWNER.email);
  await page.getByPlaceholder("Enter your password").fill(f.password);
  await page.getByRole("button", { name: "Sign In", exact: true }).click();
  await expect(page).toHaveURL(/\/select-workspace/, { timeout: 60_000 });
  const other = page.getByRole("button").filter({ hasText: "ADMIN ·" }).first();
  await expect(other).toBeVisible({ timeout: 60_000 });
  await other.click();

  // Opening it: the loader covers the wait, then the second factor and the admin console.
  await expect(loader(page, /Opening your workspace/)).toBeVisible({ timeout: 30_000 });
  await answerMfa(page, f.staff!.OWNER.mfaSecret);
  await expect(page).toHaveURL(/\/admin/, { timeout: 120_000 });
  await expect(page.getByText("Admin workspace").first()).toBeVisible({ timeout: 60_000 });
  await context.close();
});
