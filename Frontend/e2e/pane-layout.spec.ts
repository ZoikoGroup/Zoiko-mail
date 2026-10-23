import { test, expect, type Locator, type Page } from "@playwright/test";
import { openWebmail } from "./webmail-harness";

/**
 * Resizable panes in the Member inbox: Standard size (the default layout) and
 * Custom size (dragging the dividers, the Layout menu's sliders, or the
 * keyboard), remembered in this browser, never squeezing the reading pane
 * below its minimum, and leaving phones and mail itself alone.
 */

const width = async (locator: Locator) => Math.round((await locator.boundingBox())!.width);
const folderPane = (page: Page) => page.getByTestId("folder-pane");
const listPane = (page: Page) => page.getByTestId("message-list-pane");
const readingPane = (page: Page) => page.getByRole("region", { name: "Message", exact: true });
const listDivider = (page: Page) => page.getByRole("separator", { name: "Resize message list" });
const folderDivider = (page: Page) => page.getByRole("separator", { name: "Resize folder pane" });

async function dragBy(page: Page, divider: Locator, dx: number) {
  const box = (await divider.boundingBox())!;
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  // In steps, as a hand moves, so the drag is exercised frame by frame.
  await page.mouse.move(x + dx / 2, y, { steps: 8 });
  await page.mouse.move(x + dx, y, { steps: 8 });
  await page.mouse.up();
}

async function openLayoutMenu(page: Page) {
  await page.getByRole("button", { name: "Layout" }).click();
  return page.getByRole("dialog", { name: "Layout" });
}

async function ready(page: Page) {
  await openWebmail(page);
  await expect(page.getByText("Sarah Mitchell", { exact: true }).first()).toBeVisible({ timeout: 60_000 });
}

test("starts at Standard size", async ({ page }) => {
  await ready(page);
  expect(await width(folderPane(page))).toBe(240);
  // 1600px wide is the xl breakpoint, where the standard list is 410.
  expect(await width(listPane(page))).toBe(410);
  const menu = await openLayoutMenu(page);
  await expect(menu.getByRole("radio", { name: /Standard size/ })).toHaveAttribute("aria-checked", "true");
  await expect(menu.getByTestId("list-width")).toBeDisabled();
});

test("dragging a divider resizes smoothly, switches to Custom and is remembered", async ({ page }) => {
  await ready(page);
  await dragBy(page, listDivider(page), 120);
  expect(await width(listPane(page))).toBeGreaterThanOrEqual(526);
  expect(await width(listPane(page))).toBeLessThanOrEqual(534);
  await dragBy(page, folderDivider(page), 40);
  expect(await width(folderPane(page))).toBeGreaterThanOrEqual(278);
  expect(await width(folderPane(page))).toBeLessThanOrEqual(282);

  const menu = await openLayoutMenu(page);
  await expect(menu.getByRole("radio", { name: /Custom size/ })).toHaveAttribute("aria-checked", "true");
  const listSlider = menu.getByTestId("list-width");
  await expect(listSlider).toBeEnabled();
  const listValue = Number(await listSlider.inputValue());
  expect(Math.abs(listValue - (await width(listPane(page))))).toBeLessThanOrEqual(1);
  await page.keyboard.press("Escape");

  // Still there after a reload.
  const before = await width(listPane(page));
  await page.reload();
  await expect(page.getByText("Sarah Mitchell", { exact: true }).first()).toBeVisible({ timeout: 60_000 });
  expect(await width(listPane(page))).toBe(before);
  expect(await width(folderPane(page))).toBeGreaterThanOrEqual(278);
});

test("Standard size restores the default layout, and Custom brings the custom sizes back", async ({ page }) => {
  await ready(page);
  await dragBy(page, listDivider(page), 150);
  const custom = await width(listPane(page));
  expect(custom).toBeGreaterThan(500);

  let menu = await openLayoutMenu(page);
  await menu.getByRole("radio", { name: /Standard size/ }).click();
  expect(await width(listPane(page))).toBe(410);
  expect(await width(folderPane(page))).toBe(240);

  await menu.getByRole("radio", { name: /Custom size/ }).click();
  expect(await width(listPane(page))).toBe(custom);
  await page.keyboard.press("Escape");

  // Double-clicking a divider is the shortcut back to Standard.
  await listDivider(page).dblclick();
  expect(await width(listPane(page))).toBe(410);
  menu = await openLayoutMenu(page);
  await expect(menu.getByRole("radio", { name: /Standard size/ })).toHaveAttribute("aria-checked", "true");
});

test("the sliders set precise widths", async ({ page }) => {
  await ready(page);
  const menu = await openLayoutMenu(page);
  await menu.getByRole("radio", { name: /Custom size/ }).click();
  await menu.getByTestId("list-width").fill("500");
  await menu.getByTestId("folder-width").fill("300");
  await expect(menu.getByText("500px")).toBeVisible();
  expect(await width(listPane(page))).toBe(500);
  expect(await width(folderPane(page))).toBe(300);
});

test("the dividers work from the keyboard", async ({ page }) => {
  await ready(page);
  const divider = listDivider(page);
  await divider.focus();
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowRight");
  expect(await width(listPane(page))).toBe(426);
  await page.keyboard.press("Shift+ArrowLeft");
  expect(await width(listPane(page))).toBe(386);
  await expect(divider).toHaveAttribute("aria-valuenow", "386");
  await page.keyboard.press("Home");
  expect(await width(listPane(page))).toBe(300);
  await page.keyboard.press("End");
  // As wide as leaves the reading pane its 420px minimum.
  expect(await width(readingPane(page))).toBeGreaterThanOrEqual(418);
});

test("the reading pane is never squeezed below its minimum, even when the window shrinks", async ({ page }) => {
  await ready(page);
  await dragBy(page, listDivider(page), 900);
  expect(await width(readingPane(page))).toBeGreaterThanOrEqual(418);

  await page.setViewportSize({ width: 1100, height: 800 });
  await expect(listPane(page)).toBeVisible();
  expect(await width(readingPane(page))).toBeGreaterThanOrEqual(418);
  expect(await width(listPane(page))).toBeGreaterThanOrEqual(300);
});

test("mail works as before in a custom layout", async ({ page }) => {
  await ready(page);
  await dragBy(page, listDivider(page), 100);
  await page.getByText("Project update — Q4 planning").first().click();
  const pane = page.getByRole("article", { name: "Project update — Q4 planning" });
  await expect(pane.getByRole("button", { name: "Reply", exact: true })).toBeVisible({ timeout: 30_000 });
  await pane.getByRole("button", { name: "Reply", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Reply" })).toBeVisible();
});

test("phones keep one pane at a time, with no dividers or Layout menu", async ({ page }) => {
  await ready(page);
  await dragBy(page, listDivider(page), 120);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(listDivider(page)).toBeHidden();
  await expect(folderDivider(page)).toBeHidden();
  await expect(page.getByRole("button", { name: "Layout" })).toBeHidden();
  // The list fills the phone's width, custom desktop size notwithstanding.
  expect(await width(listPane(page))).toBe(390);
});
