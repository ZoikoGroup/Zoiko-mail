import { test, expect, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
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

export interface Fixture {
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

/**
 * Creates the throwaway workspace before the file's tests and retires it after.
 * Call at the top level of a spec; read the fixture inside tests.
 */
export function useRealWorkspace(): () => Fixture {
  let fixture: Fixture | undefined;
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

/** Resolves once this page's live event stream has opened (again). */
export function streamOpened(page: Page) {
  return page.waitForResponse((r) => r.url().includes("/events/stream") && r.status() === 200, { timeout: 60_000 });
}
