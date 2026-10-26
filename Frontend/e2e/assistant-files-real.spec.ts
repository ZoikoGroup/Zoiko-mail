import { test, expect, type Browser, type Page } from "@playwright/test";
import JSZip from "jszip";
import path from "node:path";
import { readFileSync } from "node:fs";
import { signIn, useRealWorkspace } from "./real-harness";

/**
 * Alet reads attached files — browser → Zoiko API → text extraction / image →
 * OpenAI → answer — with nothing stubbed.
 *
 * The files are made here, full of specific facts a model could not guess
 * (an invoice number, a leave allowance, a sales figure, a receipt total),
 * so an answer that contains them can only have come from reading the file.
 */

const getFixture = useRealWorkspace();
test.describe.configure({ mode: "serial" });

type Made = { name: string; mimeType: string; buffer: Buffer };
const files: Record<string, Made> = {};

const INVOICE_HTML = `<html><body style="font-family:Arial;padding:40px">
<h1>INVOICE INV-58213</h1>
<p>Billed to: <b>Harbourline Logistics Ltd</b>, 14 Quay Street, Leith</p>
<p>Issue date: 2 October 2026 &nbsp; Due date: <b>16 November 2026</b></p>
<table border="1" cellpadding="6" style="border-collapse:collapse">
<tr><th>Item</th><th>Qty</th><th>Amount</th></tr>
<tr><td>Route optimisation audit</td><td>1</td><td>£4,200.00</td></tr>
<tr><td>Driver training workshop</td><td>3</td><td>£1,950.00</td></tr>
</table>
<p>Subtotal £6,150.00 &nbsp; VAT (20%) £1,230.00</p>
<h2>Total due: £7,380.00</h2>
<p>Payment terms: bank transfer to sort code 40-11-62.</p>
</body></html>`;

const SALES_HTML = `<html><body style="font-family:Arial;padding:24px;background:#fff">
<h2>Q3 2026 sales by region</h2>
<table border="1" cellpadding="10" style="border-collapse:collapse;font-size:20px">
<tr><th>Region</th><th>Sales</th></tr>
<tr><td>North</td><td>$31,400</td></tr>
<tr><td>South</td><td>$27,950</td></tr>
<tr><td>East</td><td>$48,725</td></tr>
<tr><td>West</td><td>$19,880</td></tr>
</table></body></html>`;

const RECEIPT_HTML = `<html><body style="font-family:'Courier New';padding:24px;background:#fffdf5;width:360px">
<h2 style="text-align:center">MAPLE &amp; BLUE CAFE</h2>
<p>2 x Flat white ......... 7.40</p>
<p>1 x Almond croissant .... 3.85</p>
<p>1 x Orange juice ........ 4.20</p>
<hr/><p><b>TOTAL ............... 15.45</b></p>
<p>Paid by card ending 7731</p></body></html>`;

/** A real .docx: the three parts Word needs, nothing more. */
async function makeDocx(paragraphs: string[]): Promise<Buffer> {
  const zip = new JSZip();
  zip.file(
    "[Content_Types].xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`
  );
  zip.file(
    "_rels/.rels",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`
  );
  const body = paragraphs.map((p) => `<w:p><w:r><w:t xml:space="preserve">${p.replace(/&/g, "&amp;")}</w:t></w:r></w:p>`).join("");
  zip.file(
    "word/document.xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}</w:body></w:document>`
  );
  return zip.generateAsync({ type: "nodebuffer" });
}

async function makeFiles(browser: Browser) {
  const page = await browser.newPage();
  await page.setContent(INVOICE_HTML);
  files.pdf = { name: "Invoice INV-58213.pdf", mimeType: "application/pdf", buffer: await page.pdf({ format: "A4" }) };
  await page.setViewportSize({ width: 520, height: 360 });
  await page.setContent(SALES_HTML);
  files.png = { name: "Q3 sales.png", mimeType: "image/png", buffer: await page.screenshot({ type: "png" }) };
  await page.setViewportSize({ width: 420, height: 380 });
  await page.setContent(RECEIPT_HTML);
  files.jpg = { name: "Cafe receipt.jpg", mimeType: "image/jpeg", buffer: await page.screenshot({ type: "jpeg", quality: 85 }) };
  await page.close();
  files.docx = {
    name: "Leave policy.docx",
    mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    buffer: await makeDocx([
      "Northwind Annual Leave Policy (2026)",
      "Full-time employees receive 27 days of paid annual leave per year, plus public holidays.",
      "Up to 5 unused days may be carried over into the following year, and must be used by 31 March.",
      "Leave requests must be submitted at least 10 working days in advance through the HR portal.",
    ]),
  };
  files.doc = {
    name: "Legacy Notes.doc",
    mimeType: "application/msword",
    buffer: readFileSync(path.join(__dirname, "fixtures", "Legacy Notes.doc")),
  };
}

const thread = (page: Page) => page.getByTestId("assistant-thread");
const answers = (page: Page) => thread(page).getByTestId("assistant-answer");
const chips = (page: Page) => page.getByTestId("assistant-composer-file");

async function openNewChat(browser: Browser) {
  const f = getFixture();
  const { page, context } = await signIn(browser, f.sender.address, f.password);
  await page.setViewportSize({ width: 1500, height: 900 });
  await page.goto("/mail/alet");
  await expect(page.getByTestId("assistant-welcome")).toBeVisible({ timeout: 60_000 });
  return { page, context };
}

async function attach(page: Page, ...made: Made[]) {
  await page.getByTestId("assistant-file-input").setInputFiles(made.map((m) => ({ name: m.name, mimeType: m.mimeType, buffer: m.buffer })));
}

async function askAndRead(page: Page, question: string, nth: number) {
  await page.getByLabel("Ask Alet").fill(question);
  await page.getByRole("button", { name: "Send" }).click();
  await expect(answers(page)).toHaveCount(nth + 1, { timeout: 90_000 });
  return answers(page).nth(nth);
}

test.beforeAll(async ({ browser }) => {
  await makeFiles(browser);
});

test("a PDF: shows it reading, answers from the invoice, and follows up without re-attaching", async ({ browser }) => {
  const { page, context } = await openNewChat(browser);
  await attach(page, files.pdf!);
  await expect(chips(page)).toHaveAttribute("data-status", "ready", { timeout: 30_000 });
  await expect(chips(page)).toContainText("1 page");

  // Preview before sending.
  await chips(page).getByRole("button", { name: /Preview Invoice INV-58213.pdf/ }).click();
  await expect(page.getByRole("dialog", { name: /Invoice INV-58213.pdf/ })).toBeVisible();
  await page.keyboard.press("Escape");

  await page.getByLabel("Ask Alet").fill("What is the total due, and by what date?");
  await page.getByRole("button", { name: "Send" }).click();
  await expect(page.getByTestId("assistant-thinking")).toContainText("reading your file");
  await expect(answers(page).first()).toContainText(/7,?380/, { timeout: 90_000 });
  await expect(answers(page).first()).toContainText(/16 November 2026|November 16/);
  await expect(thread(page).getByTestId("assistant-message-files")).toContainText("Invoice INV-58213.pdf");
  await expect(chips(page)).toHaveCount(0);

  // The file stays with the conversation.
  const followUp = await askAndRead(page, "Who is the invoice billed to?", 1);
  await expect(followUp).toContainText("Harbourline Logistics");

  // Something not in the file is said to be not in it, not made up.
  const absent = await askAndRead(page, "According to the invoice, what is the customer's VAT registration number?", 2);
  await expect(absent).toContainText(/(not (include|contain|mention|provide|list|specif|stated|shown|found|available)|doesn.t|does not|no VAT registration|isn.t)/i);
  await context.close();
});

test("Word files: a .docx and a legacy .doc are read for their content", async ({ browser }) => {
  const { page, context } = await openNewChat(browser);
  await attach(page, files.docx!);
  await expect(chips(page)).toHaveAttribute("data-status", "ready", { timeout: 30_000 });
  const leave = await askAndRead(page, "How many days of annual leave do full-time employees get, and how many can be carried over?", 0);
  await expect(leave).toContainText("27");
  await expect(leave).toContainText("5");

  await attach(page, files.doc!);
  await expect(chips(page)).toHaveAttribute("data-status", "ready", { timeout: 30_000 });
  const doc = await askAndRead(page, "In the legacy notes, when is the design review?", 1);
  await expect(doc).toContainText(/3 November|November 3/);
  await context.close();
});

test("images: reads a chart and a photo of a receipt", async ({ browser }) => {
  const { page, context } = await openNewChat(browser);
  await attach(page, files.png!);
  await expect(chips(page)).toHaveAttribute("data-status", "ready", { timeout: 30_000 });
  const chart = await askAndRead(page, "Which region had the highest sales, and what was the figure?", 0);
  await expect(chart).toContainText("East");
  await expect(chart).toContainText(/48,?725/);
  // The image is shown on the question, from the server.
  await expect(thread(page).getByTestId("assistant-message-files").getByRole("img", { name: "Q3 sales.png" })).toBeVisible();

  await attach(page, files.jpg!);
  await expect(chips(page)).toHaveAttribute("data-status", "ready", { timeout: 30_000 });
  const receipt = await askAndRead(page, "What cafe is this receipt from, and what was the total?", 1);
  await expect(receipt).toContainText(/maple/i);
  await expect(receipt).toContainText("15.45");
  await context.close();
});

test("several files in one question, and files sent without words get a summary", async ({ browser }) => {
  const { page, context } = await openNewChat(browser);
  await attach(page, files.pdf!, files.png!);
  await expect(chips(page)).toHaveCount(2);
  await expect(chips(page).nth(0)).toHaveAttribute("data-status", "ready", { timeout: 30_000 });
  await expect(chips(page).nth(1)).toHaveAttribute("data-status", "ready", { timeout: 30_000 });
  const both = await askAndRead(page, "Give me the invoice total and the West region's sales.", 0);
  await expect(both).toContainText(/7,?380/);
  await expect(both).toContainText(/19,?880/);

  await page.getByRole("button", { name: "New chat" }).first().click();
  await expect(page.getByTestId("assistant-welcome")).toBeVisible({ timeout: 30_000 });
  await attach(page, files.docx!);
  await expect(chips(page)).toHaveAttribute("data-status", "ready", { timeout: 30_000 });
  await page.getByRole("button", { name: "Send" }).click();
  await expect(answers(page).first()).toContainText(/27/, { timeout: 90_000 });
  await expect(page.getByTestId("assistant-title")).toHaveText("Leave policy.docx");
  await context.close();
});

test("refuses what it cannot read, with the reason, and a refused file must be removed to send", async ({ browser }) => {
  const { page, context } = await openNewChat(browser);
  await attach(page, { name: "notes.txt", mimeType: "text/plain", buffer: Buffer.from("hello") });
  await expect(chips(page)).toHaveAttribute("data-status", "error");
  await expect(chips(page)).toContainText("Alet can read PDF, Word");
  await page.getByLabel("Ask Alet").fill("hello");
  await expect(page.getByRole("button", { name: "Send" })).toBeDisabled();
  await chips(page).getByRole("button", { name: "Remove notes.txt" }).click();
  await expect(chips(page)).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Send" })).toBeEnabled();

  // Checked by the server too: a text file named .pdf is refused for what it is.
  await attach(page, { name: "renamed.pdf", mimeType: "application/pdf", buffer: Buffer.from("not really a pdf") });
  await expect(chips(page)).toHaveAttribute("data-status", "error", { timeout: 30_000 });
  await expect(chips(page)).toContainText("isn't a valid PDF");
  await chips(page).getByRole("button", { name: "Remove renamed.pdf" }).click();

  // At most four files per question.
  await attach(page, files.png!, files.jpg!, files.pdf!, files.docx!, files.doc!);
  await expect(chips(page)).toHaveCount(4);
  await expect(page.getByText(/Only 4 more files can be attached/)).toBeVisible();
  await context.close();
});
