import { test, expect, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { API, signIn } from "./real-harness";

/**
 * Tasks end to end, against the real API, database, reminder worker and live
 * event stream — no stubs. A throwaway workspace
 * (Backend/scripts/e2e-tasks-fixture.ts) gives two Members, a lead and a
 * teammate, who share one team (a shared mailbox), each signed in from their
 * own browser — two computers, as far as the app can tell.
 *
 * The journey: an email becomes a task and leads back to the email; the lead
 * hands a team task to the teammate, whose screen shows it without a reload;
 * the reminder worker reminds them; they finish it and the lead's screen
 * follows; the history, the search and the export all reflect what happened.
 *
 * Needs the API on :5000 and the web app on :3000; skips when the API is down.
 */

const BACKEND = path.resolve(__dirname, "../../Backend");

interface Fixture {
  tenantId: string;
  password: string;
  lead: { address: string; name: string; userId: string };
  mate: { address: string; name: string; userId: string };
  team: { id: string; name: string };
  message: { id: string; subject: string };
}

function fixtureScript(...args: string[]): string {
  return execFileSync(process.platform === "win32" ? "npx.cmd" : "npx", ["tsx", "scripts/e2e-tasks-fixture.ts", ...args], {
    cwd: BACKEND,
    encoding: "utf8",
    shell: process.platform === "win32",
    timeout: 120_000,
  });
}

let fixture: Fixture | undefined;
test.describe.configure({ mode: "serial", timeout: 300_000 });

test.beforeAll(async ({ request }) => {
  const up = await request.get(`${API}/auth/me`).then((r) => r.status()).catch(() => 0);
  test.skip(up === 0, "The local API isn't running");
  fixture = JSON.parse(fixtureScript("create").trim().split(/\r?\n/).pop()!) as Fixture;
});

test.afterAll(() => {
  if (fixture) fixtureScript("delete", fixture.tenantId);
});

const f = () => fixture!;
const pad = (n: number) => String(n).padStart(2, "0");

/** Wait for the app's own fetch of a path to finish, so a write has landed before the next step. */
const settled = (page: Page, part: string, method = "POST") =>
  page.waitForResponse((r) => r.url().includes(part) && r.request().method() === method && r.ok(), { timeout: 60_000 });

test("an email becomes a task, and the task leads back to the email", async ({ browser }) => {
  const { context, page } = await signIn(browser, f().lead.address, f().password);
  await page.getByText(f().message.subject).first().click();
  const pane = page.getByRole("article", { name: f().message.subject });
  await pane.getByRole("button", { name: "Create task" }).click();

  const dialog = page.getByRole("dialog", { name: "Create task from email" });
  await expect(dialog.getByPlaceholder("What needs doing?")).toHaveValue(`Follow up: ${f().message.subject}`);
  const created = settled(page, "/tasks/from-message/");
  await dialog.getByRole("button", { name: "Create task" }).click();
  await created;

  await page.getByRole("link", { name: "View task" }).click();
  await expect(page).toHaveURL(/\/mail\/tasks\/from-email\?task=/, { timeout: 60_000 });
  const details = page.getByRole("region", { name: "Task details" });
  await expect(details.getByTestId("task-detail-title")).toHaveText(`Follow up: ${f().message.subject}`, { timeout: 60_000 });
  await expect(details.getByText("Lena Client")).toBeVisible();
  await expect(details.getByTestId("task-activity")).toContainText("Created the task");

  await details.getByRole("link", { name: /Open source email/ }).click();
  await expect(page).toHaveURL(new RegExp(`/mail\\?message=${f().message.id}`), { timeout: 60_000 });
  await expect(page.getByRole("article", { name: f().message.subject }).getByRole("heading", { name: f().message.subject })).toBeVisible({ timeout: 60_000 });
  await context.close();
});

test("a team task travels between two people live, reminds, completes, and shows up in history, search and export", async ({ browser }) => {
  const title = `Prepare launch readiness review ${Date.now().toString(36)}`;
  const lead = await signIn(browser, f().lead.address, f().password);
  const mate = await signIn(browser, f().mate.address, f().password);

  // The teammate waits on Assigned to Me — no reloads from here on.
  await mate.page.goto("/mail/tasks/assigned");
  await expect(mate.page.getByRole("heading", { name: "Assigned to Me", level: 1 })).toBeVisible({ timeout: 60_000 });
  await expect(mate.page.getByText("Nobody has assigned you anything right now.")).toBeVisible({ timeout: 60_000 });

  // The lead opens the team from the sidebar and hands a task over, with a reminder already due.
  await lead.page.goto("/mail/tasks");
  await lead.page.getByTestId("team-workspaces").getByRole("link", { name: new RegExp(f().team.name) }).click({ timeout: 60_000 });
  await expect(lead.page.getByRole("heading", { name: f().team.name, level: 1 })).toBeVisible({ timeout: 60_000 });
  await lead.page.getByRole("button", { name: "New team task" }).click();
  const dialog = lead.page.getByRole("dialog", { name: "New task" });
  await expect(dialog.getByLabel("Team workspace")).toHaveValue(f().team.id);
  await dialog.getByPlaceholder("What needs doing?").fill(title);
  await expect(dialog.getByLabel("Assigned to").locator("option", { hasText: f().mate.name })).toHaveCount(1, { timeout: 30_000 });
  await dialog.getByLabel("Assigned to").selectOption({ label: f().mate.name });
  await dialog.getByLabel("Reminder").selectOption("custom");
  const past = new Date(Date.now() - 2 * 60_000);
  await dialog.getByLabel("Reminder date").fill(`${past.getFullYear()}-${pad(past.getMonth() + 1)}-${pad(past.getDate())}`);
  await dialog.getByLabel("Reminder time").fill(`${pad(past.getHours())}:${pad(past.getMinutes())}`);
  await dialog.getByPlaceholder("Add a step").fill("Confirm launch owners");
  const created = settled(lead.page, "/api/v1/tasks");
  await dialog.getByRole("button", { name: "Create task" }).click();
  await created;
  const leadTable = lead.page.getByTestId("task-list");
  await expect(leadTable.getByRole("row", { name: new RegExp(`${title}.*E2E`) })).toBeVisible({ timeout: 30_000 });

  // It reaches the teammate's open screen by itself, then the reminder worker reminds them.
  const mateList = mate.page.getByTestId("task-list");
  await expect(mateList.getByText(title)).toBeVisible({ timeout: 30_000 });
  await expect(mate.page.getByText(`Reminder: ${title}`).first()).toBeVisible({ timeout: 120_000 });

  // The teammate ticks the step and finishes it.
  await mateList.getByText(title).click();
  const mateDetails = mate.page.getByRole("region", { name: "Task details" });
  await expect(mateDetails.getByTestId("task-detail-title")).toHaveText(title);
  await expect(mateDetails.getByText("Reminder sent to E2E Mate")).toBeVisible({ timeout: 30_000 });
  const ticked = settled(mate.page, "/checklist/", "PATCH");
  await mateDetails.getByText("Confirm launch owners").click();
  await ticked;
  await mateDetails.getByRole("button", { name: "Mark complete" }).click();
  await expect(mateDetails.getByRole("heading", { name: "Completion details" })).toBeVisible({ timeout: 30_000 });

  // The lead's team page follows without a reload, and the lead is told.
  await expect(leadTable.getByText(title)).toBeHidden({ timeout: 30_000 });
  await expect(lead.page.getByText("Task completed").first()).toBeVisible({ timeout: 30_000 });

  // History: the team's completions, with who did what.
  await lead.page.goto("/mail/tasks/completed");
  await lead.page.getByRole("tab", { name: "By my team" }).click();
  await lead.page.getByTestId("task-list").getByText(title).click();
  const leadDetails = lead.page.getByRole("region", { name: "Task details" });
  const activity = leadDetails.getByTestId("task-activity");
  await expect(activity).toContainText("Marked complete", { timeout: 30_000 });
  await expect(activity).toContainText("Ticked “Confirm launch owners”");
  await expect(activity).toContainText("E2E Mate");
  await expect(leadDetails.getByText("E2E Mate").first()).toBeVisible();

  // Search finds it from the top bar.
  await lead.page.goto("/mail/tasks/upcoming");
  const search = lead.page.getByRole("combobox", { name: "Search tasks" });
  await search.fill(title.slice(0, 30));
  await expect(lead.page.getByRole("listbox", { name: "Tasks" })).toContainText(title, { timeout: 30_000 });
  await search.press("Enter");
  await expect(lead.page).toHaveURL(/\/mail\/tasks\/completed\?task=/, { timeout: 60_000 });

  // And the export carries it.
  await lead.page.getByRole("tab", { name: "By my team" }).click();
  await expect(lead.page.getByTestId("task-list").getByText(title)).toBeVisible({ timeout: 30_000 });
  const download = lead.page.waitForEvent("download");
  await lead.page.getByRole("button", { name: /Export history/ }).click();
  const file = await download;
  expect(file.suggestedFilename()).toMatch(/^completed-tasks-\d{4}-\d{2}-\d{2}\.csv$/);
  const csv = readFileSync((await file.path())!, "utf8");
  expect(csv).toContain(title);
  expect(csv).toContain(f().team.name);

  await lead.context.close();
  await mate.context.close();
});
