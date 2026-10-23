import { test, expect, type Browser, type Locator, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import path from "node:path";
import { signIn as signInAs, useRealWorkspace } from "./real-harness";

/**
 * Attachment previews for every supported document and image format, in the
 * composer, in a reply and on the recipient's side, against the real API.
 *
 * The documents were written by Microsoft Word (DOCX, DOC and a PDF export)
 * and the images are real JPEG and PNG files, so what is checked is the
 * actual content showing — "Quarterly Plan Q4" on the Word page, the text of
 * the .doc — not just a filename or an icon.
 */

const getFixture = useRealWorkspace();
const signIn = (browser: Browser, address: string) => signInAs(browser, address, getFixture().password);
const fixture = (name: string, mimeType: string) => ({ name, mimeType, buffer: readFileSync(path.join(__dirname, "fixtures", name)) });
const PDF = fixture("Quarterly Plan.pdf", "application/pdf");
const DOCX = fixture("Quarterly Plan.docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
// Windows without Office reports .doc as octet-stream.
const DOC = fixture("Legacy Notes.doc", "application/octet-stream");
const JPG = fixture("Site photo.jpg", "image/jpeg");
const PNG = fixture("Chart.png", "image/png");
const ALL = [PDF, DOCX, DOC, JPG, PNG];

const shot = async (page: Page, name: string) => {
  if (process.env.E2E_SCREENSHOTS) await page.screenshot({ path: `${process.env.E2E_SCREENSHOTS}/${name}.png` });
};

async function openComposer(page: Page, to: string, subject: string) {
  await page.getByRole("button", { name: /^compose$/i }).first().click();
  const dialog = page.getByRole("dialog", { name: "New message" });
  await dialog.getByTestId("compose-to").locator("input").fill(to);
  await dialog.getByTestId("compose-to").locator("input").press("Enter");
  await dialog.getByLabel("Subject").fill(subject);
  await dialog.locator(".ProseMirror").click();
  await page.keyboard.type("Documents attached.");
  return dialog;
}

/** Checks each tile shows the file itself, not just its name. */
async function expectTilePreviews(tiles: Locator) {
  const tile = (name: string) => tiles.filter({ hasText: name });
  await expect(tile(JPG.name).locator("img")).toBeVisible({ timeout: 30_000 });
  await expect(tile(PNG.name).locator("img")).toBeVisible();
  await expect(tile(PDF.name).locator("iframe")).toBeVisible();
  // The Word page itself, drawn in the tile.
  await expect(tile(DOCX.name).getByText("Quarterly Plan Q4")).toBeAttached({ timeout: 30_000 });
  // The .doc's text, read by the server.
  await expect(tile(DOC.name).getByText(/Quarterly Plan Q4/)).toBeAttached({ timeout: 30_000 });
}

/** Opens a file's viewer and checks its content and controls. */
async function expectViewer(page: Page, scope: Locator, name: string) {
  await scope.getByRole("button", { name: `Preview ${name}`, exact: true }).click();
  const viewer = page.getByRole("dialog", { name: `Preview of ${name}` });
  await expect(viewer).toBeVisible();
  return viewer;
}

test("every format previews in the composer the moment it is attached, at full size with zoom", async ({ browser }) => {
  const { page, context } = await signIn(browser, getFixture().sender.address);
  await page.setViewportSize({ width: 1600, height: 960 });
  const dialog = await openComposer(page, getFixture().recipient.address, `Formats ${Date.now()}`);
  await dialog.getByTestId("compose-file-input").setInputFiles(ALL);
  const tiles = dialog.getByTestId("compose-attachment");
  await expect(tiles).toHaveCount(ALL.length);
  await expectTilePreviews(tiles);
  await shot(page, "p1-compose-tiles");

  // Word: real pages, zoom in and out, fit.
  let viewer = await expectViewer(page, dialog, DOCX.name);
  const docx = viewer.getByTestId("docx-preview");
  await expect(docx.getByText("Quarterly Plan Q4")).toBeVisible({ timeout: 30_000 });
  await expect(docx.getByText("Milestone two: launch on 1 December.")).toBeVisible();
  const level = viewer.getByTestId("zoom-level");
  const fitted = await level.innerText();
  await viewer.getByRole("button", { name: "Zoom in" }).click();
  await expect(level).not.toHaveText(fitted);
  await viewer.getByRole("button", { name: "Actual size" }).click();
  await expect(level).toHaveText("100%");
  await viewer.getByRole("button", { name: "Fit to screen" }).click();
  await expect(viewer.getByRole("button", { name: "Fit to screen" })).toHaveAttribute("aria-pressed", "true");
  await shot(page, "p2-docx-viewer");
  // The viewer is large: most of the window.
  const box = (await viewer.boundingBox())!;
  expect(box.width).toBeGreaterThan(1500);
  expect(box.height).toBeGreaterThan(900);
  await page.keyboard.press("Escape");

  // Legacy .doc: its text.
  viewer = await expectViewer(page, dialog, DOC.name);
  await expect(viewer.getByTestId("text-preview")).toContainText("Milestone one: design review on 3 November.", { timeout: 30_000 });
  await shot(page, "p3-doc-viewer");
  await page.keyboard.press("Escape");

  // PDF: the browser's viewer, filling the window.
  viewer = await expectViewer(page, dialog, PDF.name);
  const pdf = viewer.locator("iframe");
  await expect(pdf).toBeVisible();
  expect((await pdf.boundingBox())!.height).toBeGreaterThan(800);
  await shot(page, "p4-pdf-viewer");
  await page.keyboard.press("Escape");

  // Image: fit, then actual size and zoom.
  viewer = await expectViewer(page, dialog, JPG.name);
  const img = viewer.getByRole("img", { name: JPG.name });
  await expect(img).toBeVisible();
  await viewer.getByRole("button", { name: "Actual size" }).click();
  await expect((await img.boundingBox())!.width).toBeCloseTo(1200, -1);
  await viewer.getByRole("button", { name: "Zoom in" }).click();
  expect((await img.boundingBox())!.width).toBeGreaterThan(1250);
  await shot(page, "p5-image-zoom");
  await page.keyboard.press("Escape");

  // The composer is still there after the viewer closes.
  await expect(dialog).toBeVisible();
  await context.close();
});

test("sent attachments preview for the recipient, in a reply, and download intact", async ({ browser }) => {
  const sender = await signIn(browser, getFixture().sender.address);
  const subject = `Received formats ${Date.now()}`;
  const dialog = await openComposer(sender.page, getFixture().recipient.address, subject);
  await dialog.getByTestId("compose-file-input").setInputFiles(ALL);
  await expect(dialog.getByTestId("compose-attachment")).toHaveCount(ALL.length);
  await dialog.getByRole("button", { name: "Send", exact: true }).click();
  try {
    await expect(dialog).toBeHidden({ timeout: 60_000 });
  } catch {
    throw new Error(`The composer stayed open: ${(await dialog.innerText()).replace(/\s+/g, " ").slice(-400)}`);
  }

  const recipient = await signIn(browser, getFixture().recipient.address);
  const page = recipient.page;
  await page.setViewportSize({ width: 1600, height: 960 });
  await page.getByText(subject).first().click();
  const list = page.getByTestId("attachment-list");
  await expect(list.getByTestId("attachment-card")).toHaveCount(ALL.length, { timeout: 30_000 });
  await expectTilePreviews(list.getByTestId("attachment-card"));
  await shot(page, "p6-received-tiles");

  const viewer = await expectViewer(page, list, DOCX.name);
  await expect(viewer.getByTestId("docx-preview").getByText("Quarterly Plan Q4")).toBeVisible({ timeout: 30_000 });
  // Arrow keys move to the next file in the viewer.
  await page.keyboard.press("ArrowRight");
  await expect(page.getByRole("dialog", { name: `Preview of ${DOC.name}` }).getByTestId("text-preview")).toContainText("Quarterly Plan Q4", { timeout: 30_000 });
  await page.keyboard.press("Escape");

  for (const file of [DOCX, DOC]) {
    const download = page.waitForEvent("download");
    await list.getByRole("button", { name: `Download ${file.name}` }).click();
    const got = await download;
    expect(got.suggestedFilename()).toBe(file.name);
    expect(Buffer.compare(readFileSync((await got.path())!), file.buffer)).toBe(0);
  }

  // Reply with a Word file and a photo: both preview in the reply window.
  await page.getByRole("button", { name: "Reply", exact: true }).click();
  const reply = page.getByRole("dialog", { name: "Reply" });
  await reply.getByTestId("compose-file-input").setInputFiles([DOCX, JPG]);
  const replyTiles = reply.getByTestId("compose-attachment");
  await expect(replyTiles.filter({ hasText: DOCX.name }).getByText("Quarterly Plan Q4")).toBeAttached({ timeout: 30_000 });
  await expect(replyTiles.filter({ hasText: JPG.name }).locator("img")).toBeVisible();
  const replyViewer = await expectViewer(page, reply, DOCX.name);
  await expect(replyViewer.getByTestId("docx-preview").getByText("Milestone one: design review on 3 November.")).toBeVisible({ timeout: 30_000 });
  await shot(page, "p7-reply-docx");
  await page.keyboard.press("Escape");

  await sender.context.close();
  await recipient.context.close();
});

test("a damaged document says it couldn't be shown, with Retry and Download", async ({ browser }) => {
  const { page, context } = await signIn(browser, getFixture().sender.address);
  const dialog = await openComposer(page, getFixture().recipient.address, `Damaged ${Date.now()}`);
  await dialog.getByTestId("compose-file-input").setInputFiles([
    { name: "Damaged.docx", mimeType: "application/octet-stream", buffer: Buffer.from("this is not a Word document") },
  ]);
  const tile = dialog.getByTestId("compose-attachment");
  await expect(tile).toContainText("Preview unavailable", { timeout: 30_000 });
  const viewer = await expectViewer(page, dialog, "Damaged.docx");
  const error = viewer.getByTestId("preview-error");
  await expect(error).toContainText("Couldn't show this file", { timeout: 30_000 });
  await expect(error.getByRole("button", { name: "Retry" })).toBeVisible();
  await expect(error.getByRole("button", { name: "Download" })).toBeVisible();
  await context.close();
});
