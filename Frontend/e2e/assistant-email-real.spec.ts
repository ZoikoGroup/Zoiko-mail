import { test, expect, type APIRequestContext } from "@playwright/test";
import path from "node:path";
import { readFileSync } from "node:fs";
import { API, signIn, useRealWorkspace } from "./real-harness";

/**
 * "Summarize with Alet", end to end: Mail → Alet with the email attached →
 * nothing sent until Analyze Email → a summary from the real model, built
 * from the email's body and the text of its attached PDF.
 */

const getFixture = useRealWorkspace();
test.describe.configure({ mode: "serial" });

const key = (p: string) => `${p}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
const SUBJECT = "Q4 budget sign-off needed";

async function token(request: APIRequestContext, email: string) {
  const res = await request.post(`${API}/auth/login`, { data: { email, password: getFixture().password, workspace: "MEMBER" } });
  return (await res.json()).data.accessToken as string;
}

test("Summarize with Alet attaches the email, waits for Analyze Email, then summarises it", async ({ browser, request }) => {
  const f = getFixture();
  const sender = await token(request, f.sender.address);
  const h = () => ({ Authorization: `Bearer ${sender}`, "Idempotency-Key": key("mail") });
  const draft = await (
    await request.post(`${API}/mail/drafts`, {
      headers: h(),
      data: {
        subject: SUBJECT,
        textBody:
          "Hi,\n\nPlease review the attached quarterly plan and approve the Q4 budget of £42,000 by Friday 7 November, " +
          "so procurement can place the order. If you can't approve it, tell me which line to cut.\n\nThanks",
        recipients: { to: [f.recipient.address] },
      },
    })
  ).json();
  await request.post(`${API}/mail/drafts/${draft.data.id}/attachments`, {
    headers: h(),
    multipart: {
      file: { name: "Quarterly Plan.pdf", mimeType: "application/pdf", buffer: readFileSync(path.join(__dirname, "fixtures", "Quarterly Plan.pdf")) },
    },
  });
  await request.post(`${API}/mail/drafts/${draft.data.id}/send`, { headers: h() });

  const { page, context } = await signIn(browser, f.recipient.address, f.password);
  await page.setViewportSize({ width: 1500, height: 900 });

  // An earlier chat, which must still be there afterwards.
  await page.goto("/mail/alet");
  await page.getByLabel("Ask Alet").fill("Reply with exactly one word, in capital letters: KIWI");
  await page.getByRole("button", { name: "Send" }).click();
  await expect(page.getByTestId("assistant-answer").first()).toContainText(/kiwi/i, { timeout: 90_000 });

  // Open the email in Mail and send it to Alet.
  await page.goto("/mail");
  await page.getByText(SUBJECT).first().click();
  await expect(page.getByRole("heading", { name: SUBJECT })).toBeVisible({ timeout: 60_000 });
  const asked: string[] = [];
  page.on("request", (r) => {
    if (r.method() === "POST" && r.url().includes("/assistant/messages")) asked.push(r.url());
  });
  await page.getByTestId("summarize-with-alet").click();

  await expect(page).toHaveURL(/\/mail\/alet$/, { timeout: 60_000 });
  const card = page.getByTestId("assistant-email-card");
  await expect(card).toHaveAttribute("data-status", "ready", { timeout: 60_000 });
  await expect(card.getByTestId("assistant-email-subject")).toHaveText(SUBJECT);
  await expect(card).toContainText(f.sender.address);
  await expect(card).toContainText("1 attachment included");
  await expect(card).toContainText("not sent to Alet yet");

  // Nothing goes to the AI on its own.
  await page.waitForTimeout(3000);
  expect(asked).toHaveLength(0);
  await expect(page.getByTestId("assistant-welcome")).toBeVisible();

  // The preview shows exactly what Alet will read, attachment text included.
  await card.getByRole("button", { name: "Preview what Alet will read" }).click();
  const preview = page.getByTestId("assistant-email-preview");
  await expect(preview).toContainText(`Subject: ${SUBJECT}`);
  await expect(preview).toContainText("approve the Q4 budget of £42,000 by Friday 7 November");
  await expect(preview).toContainText("Milestone one: design review on 3 November");
  await page.keyboard.press("Escape");

  // Confirm.
  await card.getByTestId("analyze-email").click();
  await expect(page.getByTestId("assistant-thinking")).toContainText("reading the email");
  const answer = page.getByTestId("assistant-answer").first();
  await expect(answer).toContainText(/42,?000/, { timeout: 90_000 });
  await expect(answer).toContainText(/7 November|November 7/);
  expect(asked).toHaveLength(1);
  await expect(page.getByTestId("assistant-email-card")).toHaveCount(0);
  await expect(page.getByTestId("assistant-message-files")).toContainText(SUBJECT);

  // A follow-up about the attachment uses the same email.
  await page.getByLabel("Ask Alet").fill("According to the attached plan, when is the design review?");
  await page.getByRole("button", { name: "Send" }).click();
  await expect(page.getByTestId("assistant-answer")).toHaveCount(2, { timeout: 90_000 });
  await expect(page.getByTestId("assistant-answer").nth(1)).toContainText(/3 November|November 3/);

  // Saved, and the earlier chat is still there.
  await page.reload();
  await expect(page.getByTestId("assistant-answer")).toHaveCount(2, { timeout: 60_000 });
  const chats = page.getByTestId("assistant-conversations");
  await expect(chats).toContainText(SUBJECT);
  await expect(chats).toContainText("Reply with exactly one word");
  await context.close();
});

test("the email can be removed before it is analyzed, and other people's mail cannot be attached", async ({ browser, request }) => {
  const f = getFixture();
  const { page, context } = await signIn(browser, f.recipient.address, f.password);
  await page.setViewportSize({ width: 1500, height: 900 });
  await page.getByText(SUBJECT).first().click();
  await expect(page.getByRole("heading", { name: SUBJECT })).toBeVisible({ timeout: 60_000 });
  await page.getByTestId("summarize-with-alet").click();
  const card = page.getByTestId("assistant-email-card");
  await expect(card).toHaveAttribute("data-status", "ready", { timeout: 60_000 });
  await card.getByRole("button", { name: "Remove email" }).click();
  await expect(card).toHaveCount(0);
  await expect(page.getByTestId("assistant-welcome")).toBeVisible();

  // A message that is not in one's mailbox is refused.
  const res = await request.post(`${API}/assistant/attachments/email`, {
    headers: { Authorization: `Bearer ${await token(request, f.sender.address)}`, "Idempotency-Key": key("att") },
    data: { messageId: "00000000-0000-4000-8000-000000000999" },
  });
  expect(res.status()).toBe(404);
  await context.close();
});
