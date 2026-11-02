import { test, expect, type Browser, type Locator, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import path from "node:path";
import { signIn as signInAs, useRealWorkspace } from "./real-harness";
import { expectViewerLayout, expectDocxFits, expectImageFits, expectPdfFills, contentArea } from "./viewer-layout";

/**
 * The document viewer is a centred window 86% of the screen wide and 82% high
 * for every format (PDF, Word .docx and .doc, images, text) and from every
 * place a file is previewed: the composer, a received message and Alet,
 * against the real API, at desktop, laptop and phone sizes.
 */

const getFixture = useRealWorkspace();
const signIn = (browser: Browser, address: string) => signInAs(browser, address, getFixture().password);
const fixture = (name: string, mimeType: string) => ({ name, mimeType, buffer: readFileSync(path.join(__dirname, "fixtures", name)) });
const PDF = fixture("Quarterly Plan.pdf", "application/pdf");
const DOCX = fixture("Quarterly Plan.docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
const DOC = fixture("Legacy Notes.doc", "application/octet-stream");
const JPG = fixture("Site photo.jpg", "image/jpeg");
const CSV = { name: "Budget.csv", mimeType: "text/csv", buffer: Buffer.from("Item,Cost\nVenue,1200\nCatering,850\n") };
const ALL = [PDF, DOCX, DOC, JPG, CSV];

const shot = async (page: Page, name: string) => {
  if (process.env.E2E_SCREENSHOTS) await page.screenshot({ path: `${process.env.E2E_SCREENSHOTS}/${name}.png` });
};

async function openComposer(page: Page, subject: string) {
  await page.getByRole("button", { name: /^compose$/i }).first().click();
  const dialog = page.getByRole("dialog", { name: "New message" });
  await dialog.getByTestId("compose-to").locator("input").fill(getFixture().recipient.address);
  await dialog.getByTestId("compose-to").locator("input").press("Enter");
  await dialog.getByLabel("Subject").fill(subject);
  return dialog;
}

const viewerFor = (page: Page, name: string) => page.getByRole("dialog", { name: `Preview of ${name}` });

async function open(page: Page, scope: Locator, name: string) {
  await scope.getByRole("button", { name: `Preview ${name}`, exact: true }).click();
  const viewer = viewerFor(page, name);
  await expect(viewer).toBeVisible();
  return viewer;
}

/** Opens each file and checks the window, its controls, and the file drawn inside it. */
async function checkEveryFormat(page: Page, scope: Locator, label: string) {
  let viewer = await open(page, scope, PDF.name);
  await expectViewerLayout(page, viewer, { zoomable: false });
  await expectPdfFills(viewer);
  await shot(page, `${label}-pdf`);
  await page.keyboard.press("Escape");
  await expect(viewer).toBeHidden();

  viewer = await open(page, scope, DOCX.name);
  await expect(viewer.getByTestId("docx-preview").getByText("Quarterly Plan Q4")).toBeVisible({ timeout: 30_000 });
  await expectViewerLayout(page, viewer, { zoomable: true });
  await expectDocxFits(viewer);
  await shot(page, `${label}-docx`);
  // Zoomed in, the page grows inside the window, which scrolls; the window keeps its size.
  const before = (await viewer.boundingBox())!;
  for (let i = 0; i < 4; i++) await viewer.getByRole("button", { name: "Zoom in" }).click();
  const scroller = viewer.getByTestId("docx-preview").locator("xpath=..");
  const scroll = await scroller.evaluate((el) => ({ wider: el.scrollWidth > el.clientWidth, overflow: getComputedStyle(el).overflow }));
  expect(scroll).toEqual({ wider: true, overflow: "auto" });
  await scroller.evaluate((el) => el.scrollTo(el.scrollWidth, el.scrollHeight));
  expect(await viewer.boundingBox()).toEqual(before);
  await expectViewerLayout(page, viewer, { zoomable: true });
  await viewer.getByRole("button", { name: "Fit to screen" }).click();
  await expectDocxFits(viewer);
  await viewer.getByRole("button", { name: "Close preview" }).click();
  await expect(viewer).toBeHidden();

  viewer = await open(page, scope, DOC.name);
  await expect(viewer.getByTestId("text-preview")).toContainText("Quarterly Plan Q4", { timeout: 30_000 });
  await expectViewerLayout(page, viewer, { zoomable: true });
  const text = (await viewer.getByTestId("text-preview").boundingBox())!;
  const area = await contentArea(viewer);
  expect(text.x + text.width).toBeLessThanOrEqual(area.x + area.width + 0.5);
  await page.keyboard.press("Escape");

  viewer = await open(page, scope, JPG.name);
  await expectViewerLayout(page, viewer, { zoomable: true });
  await expectImageFits(viewer, JPG.name);
  await page.keyboard.press("Escape");

  viewer = await open(page, scope, CSV.name);
  await expect(viewer.getByTestId("text-preview")).toContainText("Catering");
  await expectViewerLayout(page, viewer, { zoomable: true });
  await page.keyboard.press("Escape");
}

test("the composer: every format opens in an 86% × 82% centred window, at desktop and laptop sizes", async ({ browser }) => {
  const { page, context } = await signIn(browser, getFixture().sender.address);
  await page.setViewportSize({ width: 1600, height: 960 });
  const dialog = await openComposer(page, `Viewer layout ${Date.now()}`);
  await dialog.getByTestId("compose-file-input").setInputFiles(ALL);
  await expect(dialog.getByTestId("compose-attachment")).toHaveCount(ALL.length);

  await checkEveryFormat(page, dialog, "desktop");

  await page.setViewportSize({ width: 1280, height: 720 });
  await checkEveryFormat(page, dialog, "laptop");

  // Resizing with it open: the window follows the screen.
  const viewer = await open(page, dialog, DOCX.name);
  await expectViewerLayout(page, viewer, { zoomable: true });
  await page.setViewportSize({ width: 1440, height: 900 });
  await expectViewerLayout(page, viewer, { zoomable: true });

  // A click inside keeps it open; a click on the dimmed screen around it closes it.
  await viewer.getByTestId("docx-preview").click();
  await expect(viewer).toBeVisible();
  await page.mouse.click(20, 450);
  await expect(viewer).toBeHidden();
  // The composer underneath is untouched.
  await expect(dialog).toBeVisible();
  await context.close();
});

test("on a phone the viewer keeps its proportions and its controls", async ({ browser }) => {
  const { page, context } = await signIn(browser, getFixture().sender.address);
  await page.setViewportSize({ width: 390, height: 844 });
  const dialog = await openComposer(page, `Viewer phone ${Date.now()}`);
  await dialog.getByTestId("compose-file-input").setInputFiles([PDF, DOCX, JPG]);
  await expect(dialog.getByTestId("compose-attachment")).toHaveCount(3);

  let viewer = await open(page, dialog, DOCX.name);
  // Opened straight after signing in: the "Login Successful" toast, if still
  // showing, is beneath the viewer's dimmed backdrop, not on top of it.
  const toast = page.getByTestId("toast-success");
  if (await toast.isVisible()) {
    const onTop = await toast.evaluate((el) => {
      const r = el.getBoundingClientRect();
      return document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)?.getAttribute("data-testid");
    });
    expect(onTop).toBe("file-preview-backdrop");
  }
  await expect(viewer.getByTestId("docx-preview").getByText("Quarterly Plan Q4")).toBeVisible({ timeout: 30_000 });
  await expectViewerLayout(page, viewer, { zoomable: true });
  await expectDocxFits(viewer);
  await shot(page, "phone-docx");
  await page.keyboard.press("Escape");

  viewer = await open(page, dialog, PDF.name);
  await expectViewerLayout(page, viewer, { zoomable: false });
  await expectPdfFills(viewer);
  await page.keyboard.press("Escape");

  viewer = await open(page, dialog, JPG.name);
  await expectViewerLayout(page, viewer, { zoomable: true });
  await expectImageFits(viewer, JPG.name);
  await context.close();
});

test("a received message: its attachments open in the same window, and download from it", async ({ browser }) => {
  const sender = await signIn(browser, getFixture().sender.address);
  const subject = `Viewer received ${Date.now()}`;
  const dialog = await openComposer(sender.page, subject);
  await dialog.locator(".ProseMirror").click();
  await sender.page.keyboard.type("Files attached.");
  await dialog.getByTestId("compose-file-input").setInputFiles(ALL);
  await expect(dialog.getByTestId("compose-attachment")).toHaveCount(ALL.length);
  await dialog.getByRole("button", { name: "Send", exact: true }).click();
  await expect(dialog).toBeHidden({ timeout: 60_000 });

  const recipient = await signIn(browser, getFixture().recipient.address);
  const page = recipient.page;
  await page.setViewportSize({ width: 1600, height: 960 });
  await page.getByText(subject).first().click();
  const list = page.getByTestId("attachment-list");
  await expect(list.getByTestId("attachment-card")).toHaveCount(ALL.length, { timeout: 30_000 });

  await checkEveryFormat(page, list, "received");

  // Download from inside the viewer still gives the file itself.
  const viewer = await open(page, list, DOCX.name);
  const download = page.waitForEvent("download");
  await viewer.getByRole("button", { name: `Download ${DOCX.name}` }).click();
  const got = await download;
  expect(Buffer.compare(readFileSync((await got.path())!), DOCX.buffer)).toBe(0);
  // Arrow keys move between files in the same window.
  await page.keyboard.press("ArrowRight");
  await expectViewerLayout(page, viewerFor(page, DOC.name), { zoomable: true });

  await sender.context.close();
  await recipient.context.close();
});

test("Alet: a file attached to a chat previews in the same window", async ({ browser }) => {
  const { page, context } = await signIn(browser, getFixture().sender.address);
  await page.setViewportSize({ width: 1500, height: 900 });
  await page.goto("/mail/alet");
  await expect(page.getByTestId("assistant-welcome")).toBeVisible({ timeout: 60_000 });
  await page.getByTestId("assistant-file-input").setInputFiles([PDF, DOCX]);
  const chips = page.getByTestId("assistant-composer-file");
  await expect(chips).toHaveCount(2);
  await expect(chips.first()).toHaveAttribute("data-status", "ready", { timeout: 30_000 });
  await expect(chips.last()).toHaveAttribute("data-status", "ready", { timeout: 30_000 });

  await chips.filter({ hasText: PDF.name }).getByRole("button", { name: new RegExp(`Preview ${PDF.name}`) }).click();
  let viewer = viewerFor(page, PDF.name);
  await expectViewerLayout(page, viewer, { zoomable: false });
  await expectPdfFills(viewer);
  await page.keyboard.press("Escape");

  await chips.filter({ hasText: DOCX.name }).getByRole("button", { name: new RegExp(`Preview ${DOCX.name}`) }).click();
  viewer = viewerFor(page, DOCX.name);
  await expect(viewer.getByTestId("docx-preview").getByText("Quarterly Plan Q4")).toBeVisible({ timeout: 30_000 });
  await expectViewerLayout(page, viewer, { zoomable: true });
  await expectDocxFits(viewer);
  await shot(page, "alet-docx");
  await page.keyboard.press("Escape");
  await context.close();
});
