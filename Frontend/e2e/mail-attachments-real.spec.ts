import { test, expect, type Browser, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { signIn as signInAs, useRealWorkspace } from "./real-harness";

/**
 * Attachments from sender to recipient against the real API and database.
 *
 * The earlier attachment specs stubbed the API, which is how the missing
 * Idempotency-Key on uploads went unnoticed: the stub accepted what the real
 * server refuses. Nothing is stubbed here except, in two tests, a response
 * that is deliberately lost on its way back — the server still did the work,
 * and the retry must not do it twice.
 */

const getFixture = useRealWorkspace();
const signIn = (browser: Browser, address: string) => signInAs(browser, address, getFixture().password);

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64"
);
const PDF = Buffer.from(
  "%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj 2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj 3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n"
);
const FILES = [
  { name: "Milestones.pdf", mimeType: "application/pdf", buffer: PDF },
  // Office files as Windows reports them without Office: no useful type.
  // A real Word document (written by Word), reported without a useful type.
  { name: "Proposal.docx", mimeType: "application/octet-stream", buffer: readFileSync(`${__dirname}/fixtures/Quarterly Plan.docx`) },
  { name: "Budget.csv", mimeType: "text/csv", buffer: Buffer.from("item,amount\nDesign,1200\nBuild,3400\n") },
  { name: "photo.png", mimeType: "image/png", buffer: PNG },
  { name: "Résumé notes.txt", mimeType: "text/plain", buffer: Buffer.from("Notes with an accent: café\n") },
];

type Upload = { name: string; mimeType: string; buffer: Buffer };

async function openComposer(page: Page, to: string, subject: string) {
  await page.getByRole("button", { name: /^compose$/i }).first().click();
  const dialog = page.getByRole("dialog", { name: "New message" });
  await dialog.getByTestId("compose-to").locator("input").fill(to);
  await dialog.getByTestId("compose-to").locator("input").press("Enter");
  await dialog.getByLabel("Subject").fill(subject);
  await dialog.locator(".ProseMirror").click();
  await page.keyboard.type("Files attached.");
  return dialog;
}

async function attach(dialog: ReturnType<Page["getByRole"]>, files: Upload[]) {
  await dialog.getByTestId("compose-file-input").setInputFiles(files);
  for (const file of files) await expect(dialog.getByTestId("compose-attachments")).toContainText(file.name);
}

async function sendAndClose(page: Page, dialog: ReturnType<Page["getByRole"]>) {
  await dialog.getByRole("button", { name: "Send", exact: true }).click();
  try {
    await expect(dialog).toBeHidden({ timeout: 60_000 });
  } catch {
    throw new Error(`The composer stayed open: ${(await dialog.innerText()).replace(/\s+/g, " ").slice(0, 400)}`);
  }
}

async function openReceived(page: Page, subject: string) {
  await expect(page.getByText(subject).first()).toBeVisible({ timeout: 30_000 });
  await page.getByText(subject).first().click();
  const pane = page.getByRole("article", { name: subject });
  await expect(pane.getByRole("heading", { name: subject })).toBeVisible({ timeout: 30_000 });
  return pane;
}

test("five formats travel from sender to recipient, preview, and download byte for byte", async ({ browser }) => {
  const sender = await signIn(browser, getFixture().sender.address);
  const keys: string[] = [];
  sender.page.on("request", (r) => {
    if (r.method() === "POST" && /\/mail\/drafts\/[^/]+\/attachments$/.test(r.url())) keys.push(r.headers()["idempotency-key"] ?? "");
  });
  const subject = `Formats ${Date.now()}`;
  const dialog = await openComposer(sender.page, getFixture().recipient.address, subject);
  await attach(dialog, FILES);
  await sendAndClose(sender.page, dialog);
  // The bug: uploads went out with no key. Every one now carries its own.
  expect(keys).toHaveLength(FILES.length);
  expect(keys.every((key) => key.length >= 8)).toBe(true);
  expect(new Set(keys).size).toBe(FILES.length);

  const recipient = await signIn(browser, getFixture().recipient.address);
  const pane = await openReceived(recipient.page, subject);
  const list = pane.getByTestId("attachment-list");
  await expect(list).toContainText(`${FILES.length} attachments`);
  const cards = list.getByTestId("attachment-card");
  await expect(cards.filter({ hasText: "Milestones.pdf" }).getByTestId("file-type-badge")).toHaveText("PDF");
  await expect(cards.filter({ hasText: "Proposal.docx" }).getByTestId("file-type-badge")).toHaveText("DOCX");
  await expect(cards.filter({ hasText: "Budget.csv" }).getByTestId("file-type-badge")).toHaveText("CSV");
  await expect(cards.filter({ hasText: "Résumé notes.txt" })).toBeVisible();
  await expect(list.getByRole("button", { name: "Preview photo.png" })).toBeVisible();

  // Previews: a CSV as a table, text as text, a PDF in a frame.
  await list.getByRole("button", { name: "Preview Budget.csv" }).last().click();
  const csv = recipient.page.getByRole("dialog", { name: "Preview of Budget.csv" });
  await expect(csv.locator("table td").first()).toHaveText("item", { timeout: 20_000 });
  await expect(csv).toContainText("3400");
  await recipient.page.keyboard.press("Escape");
  await list.getByRole("button", { name: "Preview Résumé notes.txt" }).last().click();
  await expect(recipient.page.getByRole("dialog", { name: "Preview of Résumé notes.txt" })).toContainText("café", { timeout: 20_000 });
  await recipient.page.keyboard.press("Escape");
  await list.getByRole("button", { name: "Preview Milestones.pdf" }).last().click();
  await expect(recipient.page.getByRole("dialog", { name: "Preview of Milestones.pdf" }).locator("iframe")).toBeVisible({ timeout: 20_000 });
  await recipient.page.keyboard.press("Escape");

  // Downloads: the right name and the exact bytes that were sent.
  for (const file of [FILES[1], FILES[4]]) {
    const download = recipient.page.waitForEvent("download");
    await list.getByRole("button", { name: `Download ${file.name}` }).last().click();
    const got = await download;
    expect(got.suggestedFilename()).toBe(file.name);
    expect(Buffer.compare(readFileSync((await got.path())!), file.buffer)).toBe(0);
  }

  await sender.context.close();
  await recipient.context.close();
});

test("a reply carries its own attachment back", async ({ browser }) => {
  const sender = await signIn(browser, getFixture().sender.address);
  const subject = `Reply files ${Date.now()}`;
  const first = await openComposer(sender.page, getFixture().recipient.address, subject);
  await sendAndClose(sender.page, first);

  const recipient = await signIn(browser, getFixture().recipient.address);
  const pane = await openReceived(recipient.page, subject);
  await pane.getByRole("button", { name: "Reply", exact: true }).click();
  const reply = recipient.page.getByRole("dialog", { name: "Reply" });
  await reply.locator(".ProseMirror").click();
  await recipient.page.keyboard.type("Signed copy attached.");
  await attach(reply, [{ name: "Signed.pdf", mimeType: "application/pdf", buffer: PDF }]);
  await sendAndClose(recipient.page, reply);

  // Back at the sender, live: the reply and its attachment.
  const answer = await openReceived(sender.page, `Re: ${subject}`);
  await expect(answer.getByTestId("attachment-list")).toContainText("Signed.pdf", { timeout: 30_000 });

  await sender.context.close();
  await recipient.context.close();
});

test("an upload whose answer is lost is retried and stored once", async ({ browser }) => {
  const sender = await signIn(browser, getFixture().sender.address);
  let lost = false;
  // The server stores the file; the answer never reaches the browser.
  await sender.page.route(/\/mail\/drafts\/[^/]+\/attachments$/, async (route) => {
    if (route.request().method() === "POST" && !lost) {
      lost = true;
      await route.fetch();
      await route.abort("connectionreset");
      return;
    }
    await route.continue();
  });
  const subject = `Lost upload ${Date.now()}`;
  const dialog = await openComposer(sender.page, getFixture().recipient.address, subject);
  await attach(dialog, [{ name: "Once.pdf", mimeType: "application/pdf", buffer: PDF }]);
  await sendAndClose(sender.page, dialog);
  expect(lost).toBe(true);

  const recipient = await signIn(browser, getFixture().recipient.address);
  const pane = await openReceived(recipient.page, subject);
  await expect(pane.getByTestId("attachment-list")).toContainText("1 attachment");
  await expect(pane.getByTestId("attachment-card")).toHaveCount(1);

  await sender.context.close();
  await recipient.context.close();
});

test("a send whose answer is lost is retried without sending twice", async ({ browser }) => {
  const sender = await signIn(browser, getFixture().sender.address);
  // Every answer to the send is lost — the first after the server sent it —
  // so the composer cannot confirm, and says so.
  let attempts = 0;
  await sender.page.route(/\/mail\/drafts\/[^/]+\/send$/, async (route) => {
    attempts += 1;
    if (attempts === 1) await route.fetch();
    await route.abort("connectionreset");
  });
  const subject = `Lost send ${Date.now()}`;
  const dialog = await openComposer(sender.page, getFixture().recipient.address, subject);
  await attach(dialog, [{ name: "Agenda.txt", mimeType: "text/plain", buffer: Buffer.from("agenda") }]);
  await dialog.getByRole("button", { name: "Send", exact: true }).click();
  await expect(dialog).toContainText("couldn't confirm the message was sent", { timeout: 60_000 });
  expect(attempts).toBe(3); // tried, and retried twice with the same key

  // The connection is back; Send again replays the first send's answer.
  await sender.page.unroute(/\/mail\/drafts\/[^/]+\/send$/);
  await dialog.getByRole("button", { name: "Send", exact: true }).click();
  await expect(dialog).toBeHidden({ timeout: 60_000 });

  const recipient = await signIn(browser, getFixture().recipient.address);
  await expect(recipient.page.getByText(subject).first()).toBeVisible({ timeout: 30_000 });
  await recipient.page.waitForTimeout(1500);
  await expect(recipient.page.getByText(subject)).toHaveCount(1);
  const pane = await openReceived(recipient.page, subject);
  await expect(pane.getByTestId("attachment-card")).toHaveCount(1);

  await sender.context.close();
  await recipient.context.close();
});

test("files that can't be attached are refused before upload, with the reason", async ({ browser }) => {
  const sender = await signIn(browser, getFixture().sender.address);
  const dialog = await openComposer(sender.page, getFixture().recipient.address, `Refused ${Date.now()}`);
  await dialog.getByTestId("compose-file-input").setInputFiles([
    { name: "setup.exe", mimeType: "application/octet-stream", buffer: Buffer.from("MZ") },
    { name: "fine.pdf", mimeType: "application/pdf", buffer: PDF },
  ]);
  await expect(dialog).toContainText("setup.exe: .exe files can't be attached.");
  await expect(dialog.getByTestId("compose-attachments")).toContainText("fine.pdf");
  await expect(dialog.getByTestId("compose-attachments")).not.toContainText("setup.exe");
  await sender.context.close();
});

test("files preview in the composer, before and after they are uploaded", async ({ browser }) => {
  const sender = await signIn(browser, getFixture().sender.address);
  const page = sender.page;
  const dialog = await openComposer(page, getFixture().recipient.address, `Compose preview ${Date.now()}`);
  await attach(dialog, FILES);
  const rows = dialog.getByTestId("compose-attachment");
  await expect(rows).toHaveCount(FILES.length);
  // An image shows a thumbnail in the list.
  await expect(rows.filter({ hasText: "photo.png" }).locator("img")).toBeVisible();

  const preview = async (name: string) => {
    await dialog.getByRole("button", { name: `Preview ${name}`, exact: true }).click();
    return page.getByRole("dialog", { name: `Preview of ${name}` });
  };

  // Before upload — straight from the browser's copy.
  let viewer = await preview("Budget.csv");
  await expect(viewer.locator("table td").first()).toHaveText("item");
  await page.keyboard.press("Escape");
  viewer = await preview("photo.png");
  await expect(viewer.getByRole("img", { name: "photo.png" })).toBeVisible();
  await page.keyboard.press("Escape");
  viewer = await preview("Milestones.pdf");
  await expect(viewer.locator("iframe")).toBeVisible();
  await page.keyboard.press("Escape");
  // A Word file: its page, drawn in the viewer.
  viewer = await preview("Proposal.docx");
  await expect(viewer.getByTestId("docx-preview").getByText("Quarterly Plan Q4")).toBeVisible({ timeout: 30_000 });
  await page.keyboard.press("Escape");
  // The composer is still open after closing the viewer.
  await expect(dialog).toBeVisible();

  // After autosave has put them on the draft — now loaded from the server.
  await expect(dialog).toContainText("Draft saved", { timeout: 30_000 });
  await expect(dialog.getByTestId("compose-attachments")).not.toContainText("uploading", { timeout: 30_000 });
  viewer = await preview("Résumé notes.txt");
  await expect(viewer.getByTestId("text-preview")).toContainText("café", { timeout: 20_000 });
  await page.keyboard.press("Escape");
  await sender.context.close();
});

test("a file attached to a reply previews in the reply window", async ({ browser }) => {
  const sender = await signIn(browser, getFixture().sender.address);
  const subject = `Reply preview ${Date.now()}`;
  await sendAndClose(sender.page, await openComposer(sender.page, getFixture().recipient.address, subject));

  const recipient = await signIn(browser, getFixture().recipient.address);
  const pane = await openReceived(recipient.page, subject);
  await pane.getByRole("button", { name: "Reply", exact: true }).click();
  const reply = recipient.page.getByRole("dialog", { name: "Reply" });
  await attach(reply, [{ name: "Answers.csv", mimeType: "text/csv", buffer: Buffer.from("q,a\nWhen,Friday\n") }]);
  await reply.getByRole("button", { name: "Preview Answers.csv", exact: true }).click();
  const viewer = recipient.page.getByRole("dialog", { name: "Preview of Answers.csv" });
  await expect(viewer.locator("table")).toContainText("Friday");
  await recipient.page.keyboard.press("Escape");
  await sendAndClose(recipient.page, reply);

  const answer = await openReceived(sender.page, `Re: ${subject}`);
  await expect(answer.getByTestId("attachment-list")).toContainText("Answers.csv", { timeout: 30_000 });
  await sender.context.close();
  await recipient.context.close();
});
