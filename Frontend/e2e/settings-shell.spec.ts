import { test, expect } from "@playwright/test";
import { openWebmail } from "./webmail-harness";

/**
 * Settings lives inside Mail: the gear and the account menu open it, its
 * pages are listed under SETTINGS in the folder column, and choosing a folder
 * there goes back to Mail.
 */

test("the gear opens Settings in the Mail shell, with its pages in the folder column", async ({ page }) => {
  await openWebmail(page);
  await page.locator("header").getByRole("link", { name: "Settings" }).click();
  await expect(page).toHaveURL(/\/mail\/settings\/mailbox-preferences$/, { timeout: 60_000 });

  const settingsPage = page.getByTestId("settings-page");
  await expect(settingsPage.getByRole("heading", { name: "Mailbox Preferences" })).toBeVisible({ timeout: 60_000 });
  await expect(settingsPage.getByText("Settings / Personal preferences")).toBeVisible();
  await expect(settingsPage.getByRole("region", { name: "Inbox experience" })).toBeVisible();

  const nav = page.getByTestId("settings-nav");
  await expect(nav.getByRole("link", { name: "Mailbox Preferences" })).toHaveAttribute("aria-current", "page");
  // In Settings no folder is the current page.
  await expect(page.getByRole("complementary", { name: "Mail folders" }).getByRole("button", { name: /Inbox/ })).not.toHaveAttribute("aria-current", "page");

  await nav.getByRole("link", { name: "Integrations & Apps" }).click();
  await expect(page).toHaveURL(/\/mail\/settings\/integrations$/);
  await expect(settingsPage.getByRole("heading", { name: "Integrations & Connected Apps" })).toBeVisible();
});

test("the account menu's Profile opens the Profile settings page", async ({ page }) => {
  await openWebmail(page);
  await page.getByRole("button", { name: "Account menu" }).click();
  await page.getByRole("menuitem", { name: "Profile" }).click();
  await expect(page).toHaveURL(/\/mail\/settings\/profile$/, { timeout: 60_000 });
  await expect(page.getByTestId("settings-page").getByRole("heading", { name: "Profile", exact: true })).toBeVisible({ timeout: 60_000 });
});

test("choosing a folder from Settings goes back to Mail on that folder", async ({ page }) => {
  await openWebmail(page);
  await page.goto("/mail/settings/sender-identities");
  await expect(page.getByTestId("settings-page").getByRole("heading", { name: "Sender Identities" })).toBeVisible({ timeout: 60_000 });
  await page.getByRole("complementary", { name: "Mail folders" }).getByRole("button", { name: "Sent" }).click();
  await expect(page).toHaveURL(/\/mail\?folder=SENT$/, { timeout: 60_000 });
});

test("an unknown Settings page is not found", async ({ page }) => {
  await openWebmail(page);
  const response = await page.goto("/mail/settings/nope");
  expect(response?.status()).toBe(404);
});

const ok = (data: unknown) => ({ status: 200, contentType: "application/json", body: JSON.stringify({ success: true, data }) });

test("Profile saves only the details that changed, and /account now opens it", async ({ page }) => {
  await openWebmail(page);
  const profile = {
    id: "u1", email: "michael@acme.test", displayName: "Michael Rivera", avatarUrl: null,
    phoneNumber: null, timezone: "UTC", language: "en", createdAt: "2026-03-03T09:00:00.000Z",
  };
  const patches: unknown[] = [];
  await page.route("**/api/v1/users/me", (route) => {
    if (route.request().method() === "PATCH") {
      const body = route.request().postDataJSON() as Record<string, unknown>;
      patches.push(body);
      return route.fulfill(ok({ ...profile, ...body }));
    }
    return route.fulfill(ok(profile));
  });

  await page.goto("/account");
  await expect(page).toHaveURL(/\/mail\/settings\/profile$/, { timeout: 60_000 });
  const details = page.getByTestId("profile-details");
  await expect(details.getByLabel("Display name")).toHaveValue("Michael Rivera", { timeout: 60_000 });
  await expect(details.getByLabel("Sign-in address")).toBeDisabled();

  const save = page.getByRole("button", { name: "Save changes" });
  await expect(save).toBeDisabled();

  // A number the server would refuse keeps Save off.
  await details.getByLabel("Phone number").fill("12");
  await expect(details.getByText(/with its country code/)).toBeVisible();
  await expect(save).toBeDisabled();

  // Spacing is removed before it is sent; the untouched name is not sent at all.
  await details.getByLabel("Phone number").fill("+44 20 7946 0958");
  await save.click();
  await expect(page.getByTestId("profile-save-state")).toContainText("Your details were saved.");
  expect(patches).toEqual([{ phoneNumber: "+442079460958" }]);
});

test("the account menu offers Settings and asks before signing out everywhere", async ({ page }) => {
  await openWebmail(page);
  await page.getByRole("button", { name: "Account menu" }).click();
  const menu = page.getByRole("menu");
  await expect(menu.getByText("Member · Acme Workspace")).toBeVisible();
  // One workspace: nowhere to switch to, so it is not offered.
  await expect(menu.getByRole("menuitem", { name: "Switch workspace" })).toHaveCount(0);
  await menu.getByRole("menuitem", { name: "Sign out everywhere" }).click();
  await expect(page.getByText("Sign out on every device?")).toBeVisible();
});

test("saved mailbox preferences change how Mail lists and opens mail", async ({ page }) => {
  const calls = await openWebmail(page);
  await page.goto("/settings");
  await expect(page).toHaveURL(/\/mail\/settings\/mailbox-preferences$/, { timeout: 60_000 });

  const save = page.getByRole("button", { name: "Save changes" });
  await expect(save).toBeDisabled();
  await page.getByLabel("Default inbox view").selectOption("unread");
  await page.getByLabel("Reading pane position").selectOption("off");
  await page.getByRole("switch", { name: "Message preview text" }).click();
  await page.getByRole("radio", { name: "Compact" }).click();
  await page.getByLabel("Mark as read").selectOption("null");
  // The preview follows the draft before anything is saved.
  await expect(page.getByTestId("live-preview")).toContainText("a message opens in place of the list");
  await save.click();
  await expect(page.getByTestId("save-state")).toContainText("Your preferences were saved.");

  await page.getByRole("complementary", { name: "Mail folders" }).getByRole("button", { name: /Inbox/ }).click();
  await expect(page).toHaveURL(/\/mail$/, { timeout: 60_000 });
  const list = page.getByRole("region", { name: "Inbox messages" });
  await expect(list.getByText("Sarah Mitchell", { exact: true })).toBeVisible({ timeout: 60_000 });
  await expect(page.locator("[data-reading-pane]")).toHaveAttribute("data-reading-pane", "off");
  await expect(page.getByRole("tab", { name: /Unread/ })).toHaveAttribute("aria-selected", "true");
  await expect(list.locator("[data-density]").first()).toHaveAttribute("data-density", "compact");
  await expect(list.getByText("Sharing the revised timeline and milestones for review.")).toHaveCount(0);

  // Off: the message takes the list's place. Never: opening it does not mark it read.
  await list.getByText("Project update — Q4 planning").first().click();
  await expect(page.getByRole("article", { name: "Project update — Q4 planning" })).toBeVisible({ timeout: 30_000 });
  await expect(list).toBeHidden();
  await page.waitForTimeout(1500);
  expect(calls.paths.some((p) => p.startsWith("PATCH /mail/m1"))).toBe(false);
});

test("the signature saves to the account with the rest of the page", async ({ page }) => {
  await openWebmail(page);
  const patches: unknown[] = [];
  await page.route("**/api/v1/mail/signature", (route) => {
    if (route.request().method() === "PATCH") {
      patches.push(route.request().postDataJSON());
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ success: true, data: { signature: "Michael" } }) });
    }
    return route.fallback();
  });
  await page.goto("/mail/settings/mailbox-preferences");
  await page.getByRole("textbox", { name: "Signature" }).fill("Michael");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByTestId("save-state")).toContainText("Your preferences were saved.");
  expect(patches).toEqual([{ signature: "Michael" }]);
});
