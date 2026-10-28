import { test, expect, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * For specs that run against the real API and database rather than a stub:
 * a throwaway workspace in the local dev database
 * (Backend/scripts/e2e-realtime-fixture.ts) with two Members who sign in from
 * separate browser contexts — two computers, as far as the app can tell.
 *
 * Needs the local stack from Backend/scripts/dev-up.ps1 (API on :5000,
 * Postgres on :55432). The specs skip themselves when the API isn't running.
 */

export const API = process.env.E2E_API_URL ?? "http://127.0.0.1:5000/api/v1";
const BACKEND = path.resolve(__dirname, "../../Backend");

export type StaffRole = "OWNER" | "ADMIN" | "SUPPORT";

export interface Fixture {
  tenantId: string;
  password: string;
  sender: { address: string };
  recipient: { address: string };
  /** With useRealWorkspace({ staff: true }): accounts that sign in with a second factor. */
  staff?: Record<StaffRole, { email: string; mfaSecret: string }>;
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

/**
 * Creates the throwaway workspace before the file's tests and retires it after.
 * Call at the top level of a spec; read the fixture inside tests.
 */
export function useRealWorkspace(options: { staff?: boolean } = {}): () => Fixture {
  let fixture: Fixture | undefined;
  // Two or three real sign-ins per test, on a dev server that compiles on demand.
  test.describe.configure({ timeout: 240_000 });
  test.beforeAll(async ({ request }) => {
    const up = await request.get(`${API}/auth/me`).then((r) => r.status()).catch(() => 0);
    test.skip(up === 0, "The local API isn't running (Backend/scripts/dev-up.ps1)");
    const output = options.staff ? fixtureScript("create", "--staff") : fixtureScript("create");
    fixture = JSON.parse(output.trim().split(/\r?\n/).pop()!) as Fixture;
  });
  test.afterAll(() => {
    if (fixture) fixtureScript("delete", fixture.tenantId);
  });
  return () => {
    if (!fixture) throw new Error("The real workspace was not created");
    return fixture;
  };
}

export async function signIn(browser: Browser, address: string, password: string): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto("/login/member");
  await page.getByPlaceholder("john@example.com").fill(address);
  await page.getByPlaceholder("Enter your password").fill(password);
  await page.getByRole("button", { name: "Sign In to Member Workspace" }).click();
  // Generous: a cold dev server under load has taken over a minute to land.
  await expect(page).toHaveURL(/\/mail$/, { timeout: 120_000 });
  return { context, page };
}

/** RFC 6238 TOTP (SHA-1, 6 digits, 30 s), as an authenticator app computes it. */
export function totp(base32Secret: string, at = Date.now()): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = "";
  for (const char of base32Secret.replace(/=+$/, "").toUpperCase()) bits += alphabet.indexOf(char).toString(2).padStart(5, "0");
  const key = Buffer.from(bits.match(/.{8}/g)!.map((byte) => parseInt(byte, 2)));
  const counter = Buffer.alloc(8);
  counter.writeUInt32BE(Math.floor(at / 30_000), 4);
  const digest = createHmac("sha1", key).update(counter).digest();
  const offset = digest[digest.length - 1]! & 0x0f;
  return String((digest.readUInt32BE(offset) & 0x7fffffff) % 1_000_000).padStart(6, "0");
}

/** The last 30-second step each secret answered: the server refuses a code twice. */
const usedSteps = new Map<string, number>();

/** A code this secret has not used yet, waiting for the next step if it must. */
export async function freshCode(secret: string): Promise<string> {
  let step = Math.floor(Date.now() / 30_000);
  if (usedSteps.get(secret) === step) {
    await new Promise((resolve) => setTimeout(resolve, (step + 1) * 30_000 - Date.now() + 500));
    step = Math.floor(Date.now() / 30_000);
  }
  usedSteps.set(secret, step);
  return totp(secret);
}

/** Answers the second-factor screen the page is on. */
export async function answerMfa(page: Page, secret: string) {
  await expect(page).toHaveURL(/\/verify-mfa/, { timeout: 120_000 });
  const code = page.getByPlaceholder("000000").first();
  // Confirmed by leaving the screen. On a busy dev server the field can take
  // the code before the form responds; then a new code (the server refuses a
  // code twice) is entered again.
  await expect(async () => {
    if (!page.url().includes("/verify-mfa")) return;
    await code.fill(await freshCode(secret));
    await code.press("Enter");
    await expect(page).not.toHaveURL(/\/verify-mfa/, { timeout: 15_000 });
  }).toPass({ timeout: 120_000 });
}

/**
 * Signs a staff account in through /login and its second factor, landing in
 * the workspace its role opens (/owner, /admin or /support). The Owner also
 * administers a second workspace, so it passes the workspace picker and
 * chooses the one it owns.
 */
export async function signInStaff(browser: Browser, fixture: Fixture, role: StaffRole): Promise<{ context: BrowserContext; page: Page }> {
  const account = fixture.staff?.[role];
  if (!account) throw new Error("This fixture was created without staff accounts");
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto("/login");
  await page.getByPlaceholder("john@example.com").fill(account.email);
  await page.getByPlaceholder("Enter your password").fill(fixture.password);
  await page.getByRole("button", { name: "Sign In", exact: true }).click();
  await expect(page).toHaveURL(/\/(verify-mfa|select-workspace)/, { timeout: 120_000 });
  if (page.url().includes("/select-workspace")) {
    // On a busy dev server the picker can draw before its buttons respond,
    // so a pick is confirmed by where it leads, and repeated if it led nowhere.
    const pick = page.getByRole("button").filter({ hasText: `${role} ·` }).first();
    await expect(async () => {
      if (page.url().includes("/select-workspace")) await pick.click({ timeout: 5_000 });
      await expect(page).toHaveURL(/\/verify-mfa/, { timeout: 10_000 });
    }).toPass({ timeout: 90_000 });
  }
  await answerMfa(page, account.mfaSecret);
  await expect(page).toHaveURL(new RegExp(`/${role.toLowerCase()}`), { timeout: 120_000 });
  return { context, page };
}

/** Resolves once this page's live event stream has opened (again). */
export function streamOpened(page: Page) {
  return page.waitForResponse((r) => r.url().includes("/events/stream") && r.status() === 200, { timeout: 60_000 });
}
