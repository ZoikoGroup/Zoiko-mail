import { test, expect, type Browser, type Page } from "@playwright/test";
import { signIn as signInAs, streamOpened, useRealWorkspace } from "./real-harness";

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

const getFixture = useRealWorkspace();
const signIn = (browser: Browser, address: string) => signInAs(browser, address, getFixture().password);

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
  const recipient = await signIn(browser, getFixture().recipient.address);
  // Wait until the recipient is really listening, as a person would be.
  await streamOpened(recipient.page).catch(() => undefined);
  await expect(recipient.page.getByText("Live arrival", { exact: false })).toHaveCount(0);
  const loads = { count: 0 };
  recipient.page.on("framenavigated", (frame) => {
    if (frame === recipient.page.mainFrame()) loads.count += 1;
  });

  const sender = await signIn(browser, getFixture().sender.address);
  const subject = `Live arrival ${Date.now()}`;
  await compose(sender.page, getFixture().recipient.address, subject);

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
  const recipient = await signIn(browser, getFixture().recipient.address);
  await streamOpened(recipient.page).catch(() => undefined);

  // The network drops: the stream and every API call fail.
  await recipient.context.setOffline(true);
  const sender = await signIn(browser, getFixture().sender.address);
  const subject = `While offline ${Date.now()}`;
  await compose(sender.page, getFixture().recipient.address, subject);
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
  const { context, page: first } = await signIn(browser, getFixture().sender.address);
  const second = await context.newPage();
  await second.goto("/login/member");
  await second.getByPlaceholder("john@example.com").fill(getFixture().recipient.address);
  await second.getByPlaceholder("Enter your password").fill(getFixture().password);
  const followed = streamOpened(first);
  await second.getByRole("button", { name: "Sign In to Member Workspace" }).click();
  await expect(second).toHaveURL(/\/mail$/, { timeout: 60_000 });
  await followed;

  // Mail to the recipient now reaches the first tab live.
  const other = await signIn(browser, getFixture().sender.address);
  const subject = `Followed account ${Date.now()}`;
  await compose(other.page, getFixture().recipient.address, subject);
  await expect(first.getByText(subject).first()).toBeVisible({ timeout: 10_000 });

  await other.context.close();
  await context.close();
});
