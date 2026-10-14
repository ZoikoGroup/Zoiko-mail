import { test, expect, type Page } from "@playwright/test";
import { API, deny, json, signInAsAdmin } from "./admin-harness";

/**
 * Manage Credentials on Admin → Mailboxes, through the step-up prompt.
 *
 * The failure this guards: "Set password" sent the request, the server asked
 * for a fresh password, and the "Confirm it is you" prompt opened *behind*
 * the credentials dialog — both are full-screen modals at the same layer, and
 * the credentials one was rendered later. The click looked dead and nothing
 * was saved. Playwright refuses to click an element another one covers, so
 * reaching the prompt's input at all is the assertion.
 */

const mailboxes = [
  {
    id: "mb-sam",
    membershipId: "m-sam",
    address: "sam@acme.test",
    type: "USER",
    storageUsed: 0,
    storageLimit: 1_073_741_824,
    sendSuspendedAt: null,
    sendSuspensionReason: null,
    aiEnabled: true,
    workspaces: ["MEMBER"],
  },
];

const status = {
  mailboxId: "mb-sam",
  address: "sam@acme.test",
  mode: "SET_PASSWORD",
  reason: null,
  message: null,
  owner: { email: "sam@acme.test", displayName: "Sam", role: "MEMBER", hasPassword: true },
  mailServer: "HOSTED",
};

interface Captured {
  body: Record<string, unknown> | null;
  stepUpToken: string | null;
}

async function openCredentials(page: Page, outcome: "ok" | "mail-server-down" = "ok"): Promise<Captured[]> {
  const saves: Captured[] = [];
  await signInAsAdmin(page, {
    capabilities: ["workspace.mailboxes.manage", "people.invite.member", "people.credentials.reset"],
  });
  await page.route(`${API}/mail/admin/mailboxes`, (route) => route.fulfill(json(mailboxes)));
  await page.route(`${API}/mail/admin/mailboxes/mb-sam/credentials`, (route) => {
    const request = route.request();
    if (request.method() === "GET") return route.fulfill(json(status));
    const token = request.headers()["x-step-up-token"] ?? null;
    if (!token) {
      return route.fulfill(
        deny("FORBIDDEN", "This action needs a fresh password", {
          requiresStepUp: true,
          capability: "people.credentials.reset",
        })
      );
    }
    saves.push({ body: request.postDataJSON() as Record<string, unknown>, stepUpToken: token });
    if (outcome === "mail-server-down") {
      return route.fulfill({
        status: 502,
        contentType: "application/json",
        body: JSON.stringify({
          success: false,
          error: {
            code: "MAIL_SERVER_SYNC_FAILED",
            message: "The mail server did not accept the new password, so nothing was changed. Try again in a moment.",
          },
        }),
      });
    }
    return route.fulfill(
      json({ mailboxId: "mb-sam", address: "sam@acme.test", ownerEmail: "sam@acme.test", sessionsRevoked: 2, mailServer: "HOSTED" })
    );
  });
  await page.route(`${API}/auth/step-up`, (route) => route.fulfill(json({ stepUpToken: "fresh-token" })));

  await page.goto("/admin/mailboxes");
  await page.getByRole("row", { name: /sam@acme\.test/ }).getByRole("button", { name: "Credentials" }).click();
  const dialog = page.getByRole("dialog", { name: "Manage credentials" });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel("New password", { exact: true }).fill("Fresh-Passw0rd");
  await dialog.getByLabel("Confirm new password").fill("Fresh-Passw0rd");
  await dialog.getByLabel(/I understand this replaces/).check();
  await dialog.getByRole("button", { name: "Set password" }).click();

  // The prompt must be on top and usable, not hidden behind the dialog.
  const prompt = page.getByRole("dialog", { name: "Confirm it is you" });
  await expect(prompt).toBeVisible();
  await prompt.getByLabel("Password").fill("admin-own-password");
  await prompt.getByRole("button", { name: "Confirm and continue" }).click();
  return saves;
}

test("sets a mailbox password through step-up and says it was saved", async ({ page }) => {
  const saves = await openCredentials(page);

  await expect(page.getByText(/Password saved for sam@acme\.test in Zoiko and on the mail server/)).toBeVisible();
  expect(saves).toHaveLength(1);
  expect(saves[0]!.stepUpToken).toBe("fresh-token");
  expect(saves[0]!.body).toEqual({ newPassword: "Fresh-Passw0rd", confirmPassword: "Fresh-Passw0rd" });
});

test("shows the mail server's refusal in the credentials dialog", async ({ page }) => {
  await openCredentials(page, "mail-server-down");

  const dialog = page.getByRole("dialog", { name: "Manage credentials" });
  await expect(dialog.getByText(/mail server did not accept the new password/)).toBeVisible();
  await expect(page.getByRole("dialog", { name: "Confirm it is you" })).toHaveCount(0);
});

test("checks the password before sending anything", async ({ page }) => {
  await signInAsAdmin(page, {
    capabilities: ["workspace.mailboxes.manage", "people.credentials.reset"],
  });
  let posted = 0;
  await page.route(`${API}/mail/admin/mailboxes`, (route) => route.fulfill(json(mailboxes)));
  await page.route(`${API}/mail/admin/mailboxes/mb-sam/credentials`, (route) => {
    if (route.request().method() === "GET") return route.fulfill(json(status));
    posted += 1;
    return route.fulfill(json({}));
  });

  await page.goto("/admin/mailboxes");
  await page.getByRole("row", { name: /sam@acme\.test/ }).getByRole("button", { name: "Credentials" }).click();
  const dialog = page.getByRole("dialog", { name: "Manage credentials" });
  await dialog.getByLabel("New password", { exact: true }).fill("short");
  await expect(dialog.getByText(/Needs at least 8 characters/)).toBeVisible();
  await dialog.getByLabel("New password", { exact: true }).fill("Fresh-Passw0rd");
  await dialog.getByLabel("Confirm new password").fill("Different-1");
  await expect(dialog.getByText("The passwords do not match.")).toBeVisible();
  await dialog.getByLabel(/I understand this replaces/).check();
  await expect(dialog.getByRole("button", { name: "Set password" })).toBeDisabled();
  expect(posted).toBe(0);
});
