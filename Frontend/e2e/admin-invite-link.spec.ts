import { test, expect, type Page } from "@playwright/test";
import { API, json, signInAsAdmin } from "./admin-harness";

/**
 * Inviting somebody, on a deployment that cannot send email.
 *
 * With email off the invitation exists but nobody receives it, so the server
 * hands the admin the link and the dialog shows it, once, to pass on. When the
 * email did go out there is no link and the dialog just closes. Every API call
 * is stubbed: what these protect is what the screen shows, and that the link
 * stays in the page and never reaches the address bar.
 */

const letter = {
  subject: "You're invited to join Acme Corp on Zoiko Mail",
  greeting: "Dear Dana Reed,",
  paragraphs: ["Admin has invited you to join Acme Corp as a member."],
  closing: "",
};

async function open(page: Page, send: Record<string, unknown>) {
  const sent: Array<{ url: string; body: unknown }> = [];
  await signInAsAdmin(page);
  await page.route(`${API}/membership/invitations/preview`, (route) => route.fulfill(json({ letter })));
  await page.route(`${API}/membership/invitations`, async (route) => {
    if (route.request().method() !== "POST") return route.fulfill(json({ items: [], count: 0 }));
    sent.push({ url: route.request().url(), body: route.request().postDataJSON() });
    return route.fulfill({ ...json({ membership: { id: "inv-1", status: "INVITED" }, ...send }), status: 201 });
  });
  await page.goto("/admin/invitations");
  await page.getByRole("button", { name: "New invitation" }).click();
  const dialog = page.getByRole("dialog", { name: "New invitation" });
  await dialog.getByText("First name").locator("..").locator("input").fill("Dana");
  await dialog.getByText("Last name").locator("..").locator("input").fill("Reed");
  await dialog.getByPlaceholder("name@company.com").fill("dana@elsewhere.test");
  await dialog.getByRole("button", { name: "Draft letter" }).click();
  await expect(dialog.getByRole("button", { name: "Send invitation" })).toBeVisible();
  return { dialog, sent };
}

test.describe("invitation link", () => {
  test("is shown once when email is off, and never reaches the address bar", async ({ page }) => {
    const link = "https://app.test/accept-invitation?token=secret-token-1";
    const { dialog, sent } = await open(page, { invitationLink: link, invitationToken: "secret-token-1" });

    await dialog.getByRole("button", { name: "Send invitation" }).click();

    await expect(dialog).toContainText("Email is turned off on this deployment, so nothing was sent");
    const box = dialog.getByTestId("invitation-link-box");
    await expect(box.getByLabel("Invitation link")).toHaveValue(link);
    expect(sent).toHaveLength(1);
    expect(page.url()).not.toContain("token=");

    // Done closes it, and the link is gone from the page.
    await dialog.getByRole("button", { name: "Done" }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(page.getByText("secret-token-1")).toHaveCount(0);
  });

  test("shows no link, and simply closes, when the invitation was emailed", async ({ page }) => {
    const { dialog } = await open(page, { invitationLink: null });

    await dialog.getByRole("button", { name: "Send invitation" }).click();

    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(page.getByTestId("invitation-link-box")).toHaveCount(0);
  });
});
