import { test, expect, type Page } from "@playwright/test";
import { signIn, useRealWorkspace } from "./real-harness";

/**
 * Alet, the AI assistant, end to end: browser → Zoiko API → OpenAI → database.
 *
 * Nothing is stubbed in the main path: the answers come from the model the
 * API is configured with, so questions ask for answers that can be checked.
 * The browser must never talk to an AI provider or see a credential.
 */

const getFixture = useRealWorkspace();
test.describe.configure({ mode: "serial" });

const thread = (page: Page) => page.getByTestId("assistant-thread");
const answers = (page: Page) => thread(page).getByTestId("assistant-answer");
const box = (page: Page) => page.getByLabel("Ask Alet");

async function openAlet(page: Page) {
  await page.getByRole("navigation", { name: "Workspace sections" }).first().getByRole("link", { name: "Alet", exact: true }).click();
  await expect(page).toHaveURL(/\/mail\/alet/, { timeout: 60_000 });
  await expect(page.getByTestId("assistant-title")).toBeVisible({ timeout: 60_000 });
}

test("asks a real question, shows it thinking, answers, remembers the chat and keeps it after a reload", async ({ browser }) => {
  const f = getFixture();
  const { page, context } = await signIn(browser, f.sender.address, f.password);
  await page.setViewportSize({ width: 1500, height: 900 });

  // Everything the browser sends and receives, to prove the key never reaches it.
  const seen: string[] = [];
  page.on("request", (r) => seen.push(r.url()));
  const bodies: string[] = [];
  page.on("response", async (r) => {
    if (r.url().includes("/assistant/")) bodies.push(await r.text().catch(() => ""));
  });

  await openAlet(page);
  await expect(page.getByTestId("coming-soon")).toHaveCount(0);
  await expect(page.getByTestId("assistant-welcome")).toBeVisible();

  // Nothing to send yet.
  await expect(page.getByRole("button", { name: "Send" })).toBeDisabled();

  await box(page).fill("Reply with exactly one word, in capital letters: PINEAPPLE");
  await box(page).press("Enter");
  await expect(thread(page).getByTestId("assistant-question")).toContainText("PINEAPPLE");
  await expect(page.getByTestId("assistant-thinking")).toBeVisible();
  await expect(answers(page).first()).toContainText(/pineapple/i, { timeout: 60_000 });
  await expect(page.getByTestId("assistant-thinking")).toHaveCount(0);
  await expect(page).toHaveURL(/\/mail\/alet\?c=[0-9a-f-]{36}/);
  await expect(page.getByTestId("assistant-conversations")).toContainText("Reply with exactly one word");

  // A follow-up is answered with the conversation as memory.
  await box(page).fill("Which word did you just reply with? Answer with only that word.");
  await page.getByRole("button", { name: "Send" }).click();
  await expect(answers(page)).toHaveCount(2, { timeout: 60_000 });
  await expect(answers(page).nth(1)).toContainText(/pineapple/i);

  // Formatted answers render as lists, not raw Markdown.
  await box(page).fill("List the three primary colours of light as a numbered Markdown list, one per line, nothing else.");
  await box(page).press("Enter");
  await expect(answers(page)).toHaveCount(3, { timeout: 60_000 });
  await expect(answers(page).nth(2).locator("ol > li")).toHaveCount(3);

  // Saved on the server: a reload brings the whole chat back.
  await page.reload();
  await expect(answers(page)).toHaveCount(3, { timeout: 60_000 });
  await expect(thread(page).getByTestId("assistant-question")).toHaveCount(3);

  expect(seen.some((u) => /openai\.com/i.test(u))).toBe(false);
  expect(bodies.length).toBeGreaterThan(0);
  for (const b of bodies) expect(b).not.toMatch(/sk-[A-Za-z0-9]{10,}/);
  await context.close();
});

test("answers a Zoiko Mail question from the product, and says what it cannot see", async ({ browser }) => {
  const f = getFixture();
  const { page, context } = await signIn(browser, f.sender.address, f.password);
  await page.setViewportSize({ width: 1500, height: 900 });
  await openAlet(page);
  await page.getByRole("button", { name: "New chat" }).first().click();
  await expect(page.getByTestId("assistant-welcome")).toBeVisible({ timeout: 30_000 });

  await box(page).fill("In Zoiko Mail, how do I print an email?");
  await box(page).press("Enter");
  await expect(answers(page).first()).toContainText(/printer/i, { timeout: 60_000 });

  await box(page).fill("How many unread emails are in my inbox?");
  await box(page).press("Enter");
  await expect(answers(page)).toHaveCount(2, { timeout: 60_000 });
  await expect(answers(page).nth(1)).toContainText(/(can.t|cannot|unable|not able|don.t have|no access)/i);
  await context.close();
});

test("a failed answer says why, keeps the question, and Retry gets the answer", async ({ browser }) => {
  const f = getFixture();
  const { page, context } = await signIn(browser, f.sender.address, f.password);
  await page.setViewportSize({ width: 1500, height: 900 });
  await openAlet(page);
  await page.getByRole("button", { name: "New chat" }).first().click();
  await expect(page.getByTestId("assistant-welcome")).toBeVisible({ timeout: 30_000 });

  // The service is down for the first try only.
  let failures = 1;
  await page.route("**/api/v1/assistant/messages", (route) => {
    if (failures-- > 0) {
      return route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({ success: false, error: { code: "ASSISTANT_UNAVAILABLE", message: "The AI assistant is busy right now. Wait a moment and try again." } }),
      });
    }
    return route.continue();
  });

  await box(page).fill("Reply with exactly one word, in capital letters: MANGO");
  await box(page).press("Enter");
  const error = page.getByTestId("assistant-error");
  await expect(error).toContainText("busy right now", { timeout: 30_000 });
  await expect(thread(page).getByTestId("assistant-question")).toContainText("MANGO");
  await expect(page.getByRole("button", { name: "Send" })).toBeDisabled();

  await error.getByRole("button", { name: "Retry" }).click();
  await expect(answers(page).first()).toContainText(/mango/i, { timeout: 60_000 });
  await expect(error).toHaveCount(0);
  await context.close();
});

test("questions over the limit cannot be sent", async ({ browser }) => {
  const f = getFixture();
  const { page, context } = await signIn(browser, f.sender.address, f.password);
  await page.setViewportSize({ width: 1500, height: 900 });
  await openAlet(page);
  await page.getByRole("button", { name: "New chat" }).first().click();
  await box(page).fill("x".repeat(4001));
  await expect(page.getByText("4,001/4,000")).toBeVisible();
  await expect(page.getByRole("button", { name: "Send" })).toBeDisabled();
  await box(page).fill("   ");
  await expect(page.getByRole("button", { name: "Send" })).toBeDisabled();
  await context.close();
});

test("chats are private, and can be renamed and deleted with confirmation", async ({ browser }) => {
  const f = getFixture();
  const { page, context } = await signIn(browser, f.sender.address, f.password);
  await page.setViewportSize({ width: 1500, height: 900 });
  await openAlet(page);
  const list = page.getByTestId("assistant-conversations");
  await list.getByRole("button", { name: /^Reply with exactly one word, in capital letters: PINEAPPLE/ }).click();
  await expect(answers(page)).toHaveCount(3, { timeout: 60_000 });
  const chatUrl = page.url();

  // The colleague cannot open it.
  const other = await signIn(browser, f.recipient.address, f.password);
  await other.page.goto(chatUrl.replace(/^https?:\/\/[^/]+/, ""));
  await expect(other.page.getByText("This chat isn’t available.")).toBeVisible({ timeout: 60_000 });
  await expect(other.page.getByTestId("assistant-conversations")).toContainText("No chats yet");
  await other.context.close();

  // Rename.
  await list.getByRole("button", { name: /^Options for Reply with exactly one word, in capital letters: PINEAPPLE/ }).click();
  await page.getByRole("menu").getByRole("button", { name: "Rename" }).click();
  const dialog = page.getByRole("dialog", { name: "Rename chat" });
  await dialog.getByLabel("Name").fill("Fruit test");
  await dialog.getByRole("button", { name: "Save" }).click();
  await expect(page.getByTestId("assistant-title")).toHaveText("Fruit test");
  await expect(list).toContainText("Fruit test");

  // Delete asks first; Cancel keeps it.
  await list.getByRole("button", { name: "Options for Fruit test" }).click();
  await page.getByRole("menu").getByRole("button", { name: "Delete" }).click();
  await page.getByRole("dialog", { name: "Delete this chat?" }).getByRole("button", { name: "Cancel" }).click();
  await expect(list).toContainText("Fruit test");
  await list.getByRole("button", { name: "Options for Fruit test" }).click();
  await page.getByRole("menu").getByRole("button", { name: "Delete" }).click();
  await page.getByRole("dialog", { name: "Delete this chat?" }).getByRole("button", { name: "Delete chat" }).click();
  await expect(page).toHaveURL(/\/mail\/alet$/, { timeout: 30_000 });
  await expect(list).not.toContainText("Fruit test");
  await page.goto(chatUrl.replace(/^https?:\/\/[^/]+/, ""));
  await expect(page.getByText("This chat isn’t available.")).toBeVisible({ timeout: 60_000 });
  await context.close();
});

test("on a phone the chat list is a panel", async ({ browser }) => {
  const f = getFixture();
  const { page, context } = await signIn(browser, f.sender.address, f.password);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/mail/alet");
  await expect(page.getByTestId("assistant-welcome")).toBeVisible({ timeout: 60_000 });
  await page.getByRole("button", { name: "Open chats" }).click();
  const panel = page.getByRole("dialog", { name: "Chats" });
  await expect(panel.getByRole("button", { name: "New chat" })).toBeVisible();
  await expect(panel.getByTestId("assistant-conversations")).toContainText(/Reply with exactly one word|No chats yet/);
  await context.close();
});
