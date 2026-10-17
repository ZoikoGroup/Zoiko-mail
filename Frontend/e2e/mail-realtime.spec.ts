import { test, expect, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * Live delivery, sender to recipient, against the real API and database.
 *
 * Unlike the other specs nothing here is stubbed: a throwaway workspace is
 * created in the local dev database (Backend/scripts/e2e-realtime-fixture.ts),
 * two people sign in from separate browser contexts — two computers, as far
 * as the app can tell — and one sends to the other through the composer. The
 * recipient's page is never reloaded; the message has to arrive by itself.
 *
 * Needs the local stack from Backend/scripts/dev-up.ps1 (API on :5000,
 * Postgres on :55432). Skipped when the API isn't running.
 */

const API = process.env.E2E_API_URL ?? "http://127.0.0.1:5000/api/v1";
const BACKEND = path.resolve(__dirname, "../../Backend");

interface Fixture {
  tenantId: string;
  password: string;
  sender: { address: string };
  recipient: { address: string };
}

/** The dev database URL the way dev-up builds it; the password never leaves this process. */
function devDatabaseUrl(): string {
  if (process.env.E2E_DATABASE_URL) return process.env.E2E_DATABASE_URL;
  const line = readFileSync(path.join(BACKEND, ".env"), "utf8").split(/\r?\n/).find((l) => l.startsWith("POSTGRES_PASSWORD="));
  if (!line) throw new Error("POSTGRES_PASSWORD not found in Backend/.env");
  return `postgresql://zoiko:${line.slice("POSTGRES_PASSWORD=".length)}@127.0.0.1:55432/zoiko_mail?schema=public`;
}

function fixtureScript(...args: string[]): string {
  return execFileSync(process.platform === "win32" ? "npx.cmd" : "npx", ["tsx", "scripts/e2e-realtime-fixture.ts", ...args], {
    cwd: BACKEND,
    env: { ...process.env, DATABASE_URL: devDatabaseUrl() },
    encoding: "utf8",
    shell: process.platform === "win32",
    timeout: 120_000,
  });
}

let fixture: Fixture;

// Two or three real sign-ins per test, on a dev server that compiles on demand.
test.describe.configure({ timeout: 240_000 });

test.beforeAll(async ({ request }) => {
  const up = await request.get(`${API}/auth/me`).then((r) => r.status()).catch(() => 0);
  test.skip(up === 0, "The local API isn't running (Backend/scripts/dev-up.ps1)");
  fixture = JSON.parse(fixtureScript("create").trim().split(/\r?\n/).pop()!) as Fixture;
});

test.afterAll(() => {
  if (fixture) fixtureScript("delete", fixture.tenantId);
});

async function signIn(browser: Browser, address: string): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto("/login/member");
  await page.getByPlaceholder("john@example.com").fill(address);
  await page.getByPlaceholder("Enter your password").fill(fixture.password);
  await page.getByRole("button", { name: "Sign In to Member Workspace" }).click();
  await expect(page).toHaveURL(/\/mail$/, { timeout: 60_000 });
  return { context, page };
}

/** Resolves once this page's live event stream has opened (again). */
function streamOpened(page: Page) {
  return page.waitForResponse((r) => r.url().includes("/events/stream") && r.status() === 200, { timeout: 60_000 });
}

async function compose(page: Page, to: string, subject: string) {
  await page.getByRole("button", { name: /compose|new message/i }).first().click();
  const dialog = page.getByRole("dialog", { name: "New message" });
  await dialog.getByTestId("compose-to").locator("input").fill(to);
  await dialog.getByTestId("compose-to").locator("input").press("Enter");
  await dialog.getByLabel("Subject").fill(subject);
  await dialog.locator(".ProseMirror").click();
  await page.keyboard.type("Sent from the live delivery test.");
  await dialog.getByRole("button", { name: "Send", exact: true }).click();
  try {
    await expect(dialog).toBeHidden({ timeout: 30_000 });
  } catch {
    throw new Error(`The composer stayed open: ${(await dialog.innerText()).replace(/\s+/g, " ").slice(0, 400)}`);
  }
}

test("mail sent from one account appears in the other's open inbox without a reload, once", async ({ browser }) => {
  const recipient = await signIn(browser, fixture.recipient.address);
  // Wait until the recipient is really listening, as a person would be.
  await streamOpened(recipient.page).catch(() => undefined);
  await expect(recipient.page.getByText("Live arrival", { exact: false })).toHaveCount(0);
  const loads = { count: 0 };
  recipient.page.on("framenavigated", (frame) => {
    if (frame === recipient.page.mainFrame()) loads.count += 1;
  });

  const sender = await signIn(browser, fixture.sender.address);
  const subject = `Live arrival ${Date.now()}`;
  await compose(sender.page, fixture.recipient.address, subject);

  // Within seconds, with no reload and no new sign-in.
  await expect(recipient.page.getByText(subject).first()).toBeVisible({ timeout: 10_000 });
  expect(loads.count).toBe(0);
  // Listed once, not once per event or per refetch.
  await recipient.page.waitForTimeout(1500);
  await expect(recipient.page.getByText(subject)).toHaveCount(1);

  await sender.context.close();
  await recipient.context.close();
});

test("mail that arrives while the connection is down shows up as soon as it comes back", async ({ browser }) => {
  const recipient = await signIn(browser, fixture.recipient.address);
  await streamOpened(recipient.page).catch(() => undefined);

  // The network drops: the stream and every API call fail.
  await recipient.context.setOffline(true);
  const sender = await signIn(browser, fixture.sender.address);
  const subject = `While offline ${Date.now()}`;
  await compose(sender.page, fixture.recipient.address, subject);
  await recipient.page.waitForTimeout(3000);
  await expect(recipient.page.getByText(subject)).toHaveCount(0);

  // Back online: the client reconnects and catches up on what it missed.
  const reopened = streamOpened(recipient.page);
  await recipient.context.setOffline(false);
  await reopened;
  await expect(recipient.page.getByText(subject).first()).toBeVisible({ timeout: 15_000 });
  await expect(recipient.page.getByText(subject)).toHaveCount(1);

  await sender.context.close();
  await recipient.context.close();
});

test("a tab whose browser signs in as someone else follows that account, inbox and live updates included", async ({ browser }) => {
  // One browser, two tabs: the second tab signs in as the recipient. The
  // first tab must stop showing — and listening as — the sender.
  const { context, page: first } = await signIn(browser, fixture.sender.address);
  const second = await context.newPage();
  await second.goto("/login/member");
  await second.getByPlaceholder("john@example.com").fill(fixture.recipient.address);
  await second.getByPlaceholder("Enter your password").fill(fixture.password);
  const followed = streamOpened(first);
  await second.getByRole("button", { name: "Sign In to Member Workspace" }).click();
  await expect(second).toHaveURL(/\/mail$/, { timeout: 60_000 });
  await followed;

  // Mail to the recipient now reaches the first tab live.
  const other = await signIn(browser, fixture.sender.address);
  const subject = `Followed account ${Date.now()}`;
  await compose(other.page, fixture.recipient.address, subject);
  await expect(first.getByText(subject).first()).toBeVisible({ timeout: 10_000 });

  await other.context.close();
  await context.close();
});
