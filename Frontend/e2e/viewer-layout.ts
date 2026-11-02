import { expect, type Locator, type Page } from "@playwright/test";

/**
 * The document viewer's layout (FilePreview in components/mail/AttachmentPreview.tsx),
 * the same for every format and every place a file is previewed from:
 * a window 86% of the screen wide and 82% high, centred, with its controls
 * in view and nothing spilling past its edges.
 */

export const VIEWER_WIDTH = 0.86;
export const VIEWER_HEIGHT = 0.82;

/** Within a pixel: CSS percentages round to device pixels. */
const close = (actual: number, expected: number, what: string) =>
  expect(Math.abs(actual - expected), `${what}: ${actual.toFixed(1)} vs ${expected.toFixed(1)}`).toBeLessThanOrEqual(1.5);

export async function expectViewerLayout(page: Page, viewer: Locator, { zoomable }: { zoomable: boolean }) {
  await expect(viewer).toBeVisible();
  const vp = page.viewportSize()!;
  const box = (await viewer.boundingBox())!;

  // 86% × 82% of the screen, centred both ways.
  close(box.width, vp.width * VIEWER_WIDTH, "width");
  close(box.height, vp.height * VIEWER_HEIGHT, "height");
  close(box.x, (vp.width - box.width) / 2, "left margin");
  close(box.y, (vp.height - box.height) / 2, "top margin");

  // Its own layer at the top of the page, not inside whatever opened it, so
  // nothing in the app (a toast, a menu, the composer) can draw over it.
  expect(await viewer.evaluate((el) => el.parentElement?.parentElement === document.body)).toBe(true);

  // Nothing overflows the window itself: the file scrolls inside its own area.
  const overflow = await viewer.evaluate((el) => ({
    x: el.scrollWidth - el.clientWidth,
    y: el.scrollHeight - el.clientHeight,
    page: document.documentElement.scrollWidth - window.innerWidth,
  }));
  expect(overflow, "nothing spills past the viewer or the page").toEqual({ x: 0, y: 0, page: 0 });

  // Its controls are there and inside it.
  const controls = [viewer.getByRole("button", { name: /^Download / }), viewer.getByRole("button", { name: "Close preview" })];
  if (zoomable) {
    controls.push(
      viewer.getByRole("button", { name: "Zoom out" }),
      viewer.getByRole("button", { name: "Zoom in" }),
      viewer.getByRole("button", { name: "Fit to screen" })
    );
  }
  for (const control of controls) {
    await expect(control).toBeVisible();
    const c = (await control.boundingBox())!;
    expect(c.x).toBeGreaterThanOrEqual(box.x);
    expect(c.x + c.width).toBeLessThanOrEqual(box.x + box.width + 0.5);
    // Nothing (a toast, a menu) sits over it: a click there reaches it.
    const covering = await control.evaluate((el) => {
      const r = el.getBoundingClientRect();
      const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
      if (hit && el.contains(hit)) return null;
      return hit ? `${hit.tagName.toLowerCase()} ${hit.getAttribute("data-testid") ?? ""} "${(hit.textContent ?? "").slice(0, 40)}"` : "nothing";
    });
    expect(covering, `${await control.getAttribute("aria-label")} is covered`).toBeNull();
  }

  // The file's name is shown whole (a long one may end in "…", but never a short one), even on a phone.
  const name = await viewer.evaluate((el) => {
    const label = el.getAttribute("aria-label")!.replace(/^Preview of /, "");
    const node = Array.from(el.querySelectorAll("div")).find((d) => d.textContent === label && d.children.length === 0)!;
    return { shown: node.clientWidth, needs: node.scrollWidth };
  });
  expect(name.shown, "the file name isn't cut off").toBeGreaterThanOrEqual(name.needs);
  return box;
}

/** The file's own area: everything below the viewer's top bar. */
export async function contentArea(viewer: Locator) {
  return viewer.evaluate((el) => {
    const area = el.lastElementChild!.getBoundingClientRect();
    return { x: area.x, y: area.y, width: area.width, height: area.height };
  });
}

/**
 * A fitted Word document: its pages sit inside the viewer, not cut off at the
 * side, and are drawn at their own proportions.
 */
export async function expectDocxFits(viewer: Locator) {
  const area = await contentArea(viewer);
  const page = (await viewer.locator("section.docx").first().boundingBox())!;
  expect(page.x).toBeGreaterThanOrEqual(area.x);
  expect(page.x + page.width).toBeLessThanOrEqual(area.x + area.width + 0.5);
  // A Word page is taller than it is wide (A4 / Letter): never squashed.
  expect(page.height / page.width).toBeGreaterThan(1.2);
}

/** A fitted image: wholly in view, at its own proportions. */
export async function expectImageFits(viewer: Locator, name: string) {
  const area = await contentArea(viewer);
  const img = viewer.getByRole("img", { name });
  await expect(img).toBeVisible();
  const box = (await img.boundingBox())!;
  const natural = await img.evaluate((el: HTMLImageElement) => el.naturalWidth / el.naturalHeight);
  expect(Math.abs(box.width / box.height - natural), "not stretched").toBeLessThan(0.02);
  expect(box.x).toBeGreaterThanOrEqual(area.x);
  expect(box.y).toBeGreaterThanOrEqual(area.y);
  expect(box.x + box.width).toBeLessThanOrEqual(area.x + area.width + 0.5);
  expect(box.y + box.height).toBeLessThanOrEqual(area.y + area.height + 0.5);
}

/** The PDF viewer fills the file's area. */
export async function expectPdfFills(viewer: Locator) {
  const area = await contentArea(viewer);
  const frame = viewer.locator("iframe");
  await expect(frame).toBeVisible();
  const box = (await frame.boundingBox())!;
  close(box.width, area.width, "PDF width");
  close(box.height, area.height, "PDF height");
}
