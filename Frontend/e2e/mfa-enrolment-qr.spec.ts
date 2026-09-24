import { test, expect } from "@playwright/test";

/**
 * The enrolment screen offers a QR before it offers a key.
 *
 * Typing a 32-character base32 secret into a phone is the worst moment in
 * setting up MFA, and AC-002 requires a second factor for every Owner, Admin
 * and Support actor — so friction here is a security problem, not a cosmetic
 * one. Somebody who gives up mid-enrolment is somebody without a second
 * factor.
 *
 * Three things are asserted, and the third is the one that would otherwise
 * ship broken unnoticed: the code has to be dark-on-light. A QR drawn in the
 * page's own palette looks correct in review, passes any test that only
 * checks an <svg> exists, and fails on the phones that try to scan it.
 */

const API = "**/api/v1";

const json = (data: unknown) => ({
  status: 200,
  contentType: "application/json",
  body: JSON.stringify({ success: true, data }),
});

const SECRET = "GVFQ7472P77WCEXHAXBPPHA5VCR6LWYU";
const URI = `otpauth://totp/Zoiko%20Mail:owner@acme.test?secret=${SECRET}&issuer=Zoiko%20Mail`;

async function openEnrolment(page: import("@playwright/test").Page) {
  await page.route(`${API}/**`, (route) => route.fulfill(json({})));

  // A sign-in that stops at enrolment rather than at a code prompt.
  await page.route(`${API}/auth/login`, (route) =>
    route.fulfill(
      json({
        state: "MFA_ENROLLMENT_REQUIRED",
        mfaToken: "stub-mfa-token",
        reason: "OWNER",
      })
    )
  );
  await page.route(`${API}/auth/mfa/challenge/enroll`, (route) =>
    route.fulfill(json({ secret: SECRET, uri: URI }))
  );

  await page.goto("/login");
  await page.getByPlaceholder("john@example.com").fill("owner@acme.test");
  await page.getByPlaceholder("Enter your password").fill("Password123!");
  await page.getByRole("button", { name: "Sign In", exact: true }).click();

  await expect(
    page.getByRole("heading", { name: /Set up two-factor authentication/i })
  ).toBeVisible({ timeout: 60_000 });
}

test.describe("MFA enrolment", () => {
  test("shows a scannable code", async ({ page }) => {
    await openEnrolment(page);

    const qr = page.getByRole("img", { name: /scan this code/i });
    await expect(qr).toBeVisible({ timeout: 20_000 });

    // A QR with no modules is a blank square that still passes a
    // "does an svg exist" check.
    const rects = await qr.locator("svg path, svg rect").count();
    expect(rects, "the QR rendered no modules").toBeGreaterThan(0);
  });

  test("is dark on light, whatever the page theme is", async ({ page }) => {
    await page.emulateMedia({ colorScheme: "dark" });
    await openEnrolment(page);

    const plate = page.getByRole("img", { name: /scan this code/i }).locator("..");
    const background = await plate.evaluate((el) => getComputedStyle(el).backgroundColor);

    // The card behind this is dark. A scanner needs a light quiet zone to
    // find the finder patterns at all, so the plate is white on purpose and
    // not left to inherit the theme.
    expect(background).toBe("rgb(255, 255, 255)");
  });

  test("still offers the key to type, for anyone who cannot scan", async ({ page }) => {
    await openEnrolment(page);

    // Desktop authenticators and password managers have no camera to point,
    // and discovering that after the key was replaced is a dead end.
    await expect(page.getByText(SECRET)).toBeVisible();
    await expect(page.getByText(/enter this key by hand/i)).toBeVisible();
  });

  test("the scan comes first, and the typing is the fallback", async ({ page }) => {
    await openEnrolment(page);

    const qrBox = await page.getByRole("img", { name: /scan this code/i }).boundingBox();
    const keyBox = await page.getByText(SECRET).boundingBox();

    // Order is the whole point of the change: the fast path has to be the
    // one somebody sees first.
    expect(qrBox!.y).toBeLessThan(keyBox!.y);
  });
});
