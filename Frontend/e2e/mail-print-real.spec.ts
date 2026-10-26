import { test, expect, type APIRequestContext, type Page } from "@playwright/test";
import { API, signIn, useRealWorkspace } from "./real-harness";

/**
 * Print Mail, against the real API and database.
 *
 * The browser's print dialog cannot be driven, so the test records the
 * document handed to it (the print frame's srcdoc) and checks what is on the
 * paper: subject, sender, recipients, date and body, and none of the app.
 * It also renders that document to a PDF, as "Save as PDF" would.
 */

const getFixture = useRealWorkspace();
const key = (prefix: string) => `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;

async function token(request: APIRequestContext, email: string) {
  const res = await request.post(`${API}/auth/login`, { data: { email, password: getFixture().password, workspace: "MEMBER" } });
  return (await res.json()).data.accessToken as string;
}

/** Keeps every print frame's document, since the frame is removed after printing. */
async function recordPrints(page: Page) {
  await page.evaluate(() => {
    const w = window as unknown as { __printed: string[] };
    w.__printed = [];
    new MutationObserver((records) => {
      for (const r of records)
        r.addedNodes.forEach((n) => {
          if (n instanceof HTMLIFrameElement && n.dataset.testid === "print-frame") w.__printed.push(n.srcdoc);
        });
    }).observe(document.body, { childList: true });
  });
}
const printed = (page: Page) => page.evaluate(() => (window as unknown as { __printed: string[] }).__printed);

test("Print Mail hands the browser a clean document with the subject, people, date and body", async ({ browser, request }) => {
  const f = getFixture();
  const sender = await token(request, f.sender.address);
  const headers = () => ({ Authorization: `Bearer ${sender}`, "Idempotency-Key": key("print") });
  const draft = await (
    await request.post(`${API}/mail/drafts`, {
      headers: headers(),
      data: {
        subject: "Quarterly plan for review",
        textBody: "Hello,\n\nThe plan is attached.",
        htmlBody:
          '<p>Hello,</p><p>The <strong>plan</strong> is attached.</p><script>document.title="pwned"</script><a href="javascript:alert(1)" onclick="alert(1)">link</a>',
        recipients: { to: [f.recipient.address], cc: ["finance@outside.example"] },
      },
    })
  ).json();
  await request.post(`${API}/mail/drafts/${draft.data.id}/attachments`, {
    headers: headers(),
    multipart: { file: { name: "Plan.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4\n%%EOF") } },
  });
  await request.post(`${API}/mail/drafts/${draft.data.id}/send`, { headers: headers() });

  const { page, context } = await signIn(browser, f.recipient.address, f.password);
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.getByText("Quarterly plan for review").first().click();
  await expect(page.getByRole("heading", { name: "Quarterly plan for review" })).toBeVisible({ timeout: 60_000 });

  await recordPrints(page);
  await page.getByRole("button", { name: "Print mail" }).click();
  await expect.poll(async () => (await printed(page)).length, { timeout: 20_000 }).toBe(1);
  await expect(page.getByText(/Couldn.t print this message/)).toHaveCount(0);
  // The frame is gone once the dialog has been handled.
  await expect(page.getByTestId("print-frame")).toHaveCount(0, { timeout: 10_000 });

  const doc = (await printed(page))[0]!;
  expect(doc).toContain("<h1>Quarterly plan for review</h1>");
  const fromRow = doc.match(/<th>From:<\/th><td>([^<]*)<\/td>/)?.[1] ?? "";
  expect(fromRow).toContain(f.sender.address);
  expect(doc).toContain(`<th>To:</th><td>${f.recipient.address}</td>`);
  expect(doc).toContain("<th>Cc:</th><td>finance@outside.example</td>");
  expect(doc).toMatch(/<th>Date:<\/th><td>[^<]*\d{4}[^<]*<\/td>/);
  expect(doc).toContain("The <strong>plan</strong> is attached.");
  expect(doc).toContain("Plan.pdf");
  // Inert: no sender script, handler or javascript: link reaches the paper.
  expect(doc).not.toContain("<script>document.title");
  expect(doc).not.toContain("onclick");
  expect(doc).not.toContain("javascript:");
  // None of the app.
  for (const ui of ["Reply all", "Summarize with Alet", "Move to Trash", "Inbox"]) expect(doc).not.toContain(ui);

  // What "Save as PDF" produces from it.
  const paper = await context.newPage();
  await paper.setContent(doc);
  await expect(paper.locator("h1")).toHaveText("Quarterly plan for review");
  const pdf = await paper.pdf({ format: "A4" });
  expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
  expect(pdf.length).toBeGreaterThan(5_000);
  if (process.env.E2E_SCREENSHOTS) {
    await paper.screenshot({ path: `${process.env.E2E_SCREENSHOTS}/print-preview.png`, fullPage: true });
  }
  await context.close();
});

test("a conversation prints every message, oldest first", async ({ browser, request }) => {
  const f = getFixture();
  const a = await token(request, f.sender.address);
  const b = await token(request, f.recipient.address);
  const h = (t: string) => ({ Authorization: `Bearer ${t}`, "Idempotency-Key": key("print") });
  const first = await (await request.post(`${API}/mail/drafts`, { headers: h(a), data: { subject: "Venue options", textBody: "Which venue do you prefer?", recipients: { to: [f.recipient.address] } } })).json();
  await request.post(`${API}/mail/drafts/${first.data.id}/send`, { headers: h(a) });
  const reply = await (await request.post(`${API}/mail/${first.data.id}/reply`, { headers: h(b), data: { textBody: "The riverside one, please." } })).json();
  await request.post(`${API}/mail/drafts/${reply.data.id}/send`, { headers: h(b) });

  const { page, context } = await signIn(browser, f.sender.address, f.password);
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.getByText("Re: Venue options").first().click();
  await expect(page.getByTestId("conversation")).toBeVisible({ timeout: 60_000 });
  await recordPrints(page);
  await page.getByRole("button", { name: "Print mail" }).click();
  await expect.poll(async () => (await printed(page)).length, { timeout: 20_000 }).toBe(1);
  const doc = (await printed(page))[0]!;
  expect(doc).toContain("2 messages in this conversation");
  expect(doc.indexOf("Which venue do you prefer?")).toBeGreaterThan(-1);
  expect(doc.indexOf("Which venue do you prefer?")).toBeLessThan(doc.indexOf("The riverside one, please."));
  await context.close();
});
