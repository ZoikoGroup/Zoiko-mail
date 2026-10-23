import { test, expect, type Page } from "@playwright/test";

/**
 * "Unable to reach Zoiko Mail" — what a person sees when no answer comes back.
 *
 * The real API decides the first case: signing in from either spelling of the
 * local address reaches it (the browser treats localhost and 127.0.0.1 as
 * different origins, and only one used to be allowed). The other two stub the
 * network to show that the two failures a browser reports identically — the
 * API is down, the API refuses this page's origin — now say different things.
 *
 * Needs the local API (Backend/scripts/dev-up.ps1, or the frontend's
 * `npm run dev`, which starts it).
 */

const API = "http://localhost:5000/api/v1";

async function signIn(page: Page, origin: string) {
  await page.goto(`${origin}/login/member`);
  await page.getByPlaceholder("john@example.com").fill("nobody@zoiko-e2e.test");
  await page.getByPlaceholder("Enter your password").fill("Definitely-Wrong-1");
  await page.getByRole("button", { name: "Sign In to Member Workspace" }).click();
}

for (const origin of ["http://localhost:3000", "http://127.0.0.1:3000"]) {
  test(`signing in from ${origin} reaches the API`, async ({ page, request }) => {
    const up = await request.get(`${API}/auth/me`).then((r) => r.status()).catch(() => 0);
    test.skip(up === 0, "The local API isn't running");
    await signIn(page, origin);
    // The API answered: a wrong password, not an unreachable server.
    await expect(page.getByText("Invalid email or password")).toBeVisible({ timeout: 60_000 });
    await expect(page.getByText(/Unable to reach|isn't running|refused requests/)).toHaveCount(0);
  });
}

test("when the API is down, the error says so and how to start it", async ({ page }) => {
  await page.route((url) => url.port === "5000", (route) => route.abort("connectionrefused"));
  await signIn(page, "http://localhost:3000");
  const error = page.getByText(/The Zoiko Mail API isn't running at http:\/\/localhost:5000/);
  await expect(error).toBeVisible({ timeout: 60_000 });
  await expect(error).toContainText("Backend/scripts/dev-up.ps1");
  await expect(error).toContainText("npm run dev");
});

test("when the API is up but refuses this page's origin, the error says that instead", async ({ page, request }) => {
  const up = await request.get(`${API}/auth/me`).then((r) => r.status()).catch(() => 0);
  test.skip(up === 0, "The local API isn't running");
  // A real refusal, not a stub (a stubbed response skips the browser's CORS
  // check): [::1] is a third spelling of this machine that CORS_ORIGIN
  // doesn't list, so the real API answers and the browser blocks the answer.
  await signIn(page, "http://[::1]:3000");
  const error = page.getByText(/The Zoiko Mail API is running but refused requests from http:\/\/\[::1\]:3000/);
  await expect(error).toBeVisible({ timeout: 60_000 });
  await expect(error).toContainText("CORS_ORIGIN in Backend/.env");
});
