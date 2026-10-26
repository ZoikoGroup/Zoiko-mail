import { test, expect, type Page } from "@playwright/test";
import { json } from "./admin-harness";
import { openWebmail } from "./webmail-harness";

/**
 * Tasks (Phase 1), driven by an in-memory stand-in for the tasks API that
 * behaves like the server: it keeps what is created, completed, reopened and
 * rescheduled, and answers each view with the tasks that belong in it.
 *
 * What these protect: each view shows the tasks and figures the server
 * returns; the actions send exactly what the person chose; completed work
 * reopens only with a reason; and the parts of the design that arrive later
 * are visibly marked rather than silently missing. Set E2E_SCREENSHOTS to a
 * folder to also save dark-mode screenshots.
 */

async function shot(page: Page, name: string) {
  if (process.env.E2E_SCREENSHOTS) await page.screenshot({ path: `${process.env.E2E_SCREENSHOTS}/${name}.png` });
}

const ME = { id: "u1", displayName: "Michael Irvine", email: "michael@acme.test", avatarUrl: null };
const LENA = { id: "u2", displayName: "Lena Carter", email: "lena@acme.test", avatarUrl: null };
const SARAH = { id: "u3", displayName: "Sarah Chen", email: "sarah@acme.test", avatarUrl: null };
const PEOPLE: Record<string, typeof ME> = { u1: ME, u2: LENA, u3: SARAH };
/** A team workspace: the shared mailbox ops@acme.test, with Michael and Sarah on it. */
const TEAM = { id: "team-ops", name: "Product Operations", address: "ops@acme.test", type: "SHARED" };

/** Local midnight `days` from today, plus hh:mm. */
function day(days: number, hh = 0, mm = 0): Date {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate() + days, hh, mm);
}

interface StubTask {
  id: string;
  title: string;
  description: string | null;
  status: string;
  priority: string;
  dueAt: string | null;
  originalDueAt: string | null;
  completedAt: string | null;
  completedBy: typeof ME | null;
  messageId: string | null;
  teamId: string | null;
  reminderAt: string | null;
  following: boolean;
  owner: typeof ME;
  createdBy: typeof ME;
  checklist: Array<{ id: string; text: string; done: boolean; position: number }>;
}

function seed(): StubTask[] {
  const make = (id: string, title: string, due: Date | null, extra: Partial<StubTask> = {}): StubTask => ({
    id,
    title,
    description: null,
    status: "OPEN",
    priority: "MEDIUM",
    dueAt: due?.toISOString() ?? null,
    originalDueAt: null,
    completedAt: null,
    completedBy: null,
    messageId: null,
    teamId: null,
    reminderAt: null,
    following: false,
    owner: ME,
    createdBy: ME,
    checklist: [],
    ...extra,
  });
  return [
    make("t-overdue", "Resolve customer access request", day(-2, 17), { priority: "HIGH", description: "Customer is awaiting confirmation of delegated access" }),
    make("t-q4", "Review revised Q4 proposal", day(0, 16), {
      priority: "HIGH",
      description: "Confirm scope and return feedback to Lena Carter",
      messageId: "m1",
      checklist: [
        { id: "c1", text: "Read updated proposal", done: true, position: 0 },
        { id: "c2", text: "Review commercial assumptions", done: true, position: 1 },
        { id: "c3", text: "Send consolidated feedback", done: false, position: 2 },
      ],
    }),
    make("t-onboard", "Approve onboarding checklist", day(0, 17), { createdBy: LENA, description: "Review required items for the new team member" }),
    make("t-brief", "Prepare Monday team briefing", day(3, 9, 30), { status: "PLANNED" }),
    make("t-team", "Finalize partner launch checklist", day(2, 14), { teamId: TEAM.id, owner: SARAH, description: "Confirm launch owners and approval evidence" }),
    make("t-done", "Finalize client onboarding handoff", day(-1, 9), { status: "COMPLETED", completedAt: day(0, 9, 20).toISOString(), completedBy: ME }),
  ];
}

function dto(t: StubTask) {
  const due = t.dueAt ? new Date(t.dueAt) : null;
  const open = t.status !== "COMPLETED";
  const dueState = !open || !due ? "none" : due < day(0) ? "overdue" : due < day(1) ? "today" : "upcoming";
  return {
    ...t,
    snoozedUntil: null,
    createdAt: day(-5).toISOString(),
    updatedAt: day(0).toISOString(),
    dueState,
    daysOverdue: dueState === "overdue" && due ? Math.round((day(0).getTime() - new Date(due.getFullYear(), due.getMonth(), due.getDate()).getTime()) / 86_400_000) : 0,
    threadId: null,
    hasLinkedEmail: Boolean(t.messageId),
    isAssigned: t.createdBy.id !== t.owner.id,
    fromAi: false,
    team: t.teamId ? TEAM : null,
    isFollowing: t.following,
    followerCount: t.following ? 1 : 0,
    reminderSentAt: null,
    owedBy: null,
    owedTo: null,
    checklistProgress: { done: t.checklist.filter((c) => c.done).length, total: t.checklist.length },
  };
}

function detail(t: StubTask) {
  return {
    ...dto(t),
    linkedEmail: t.messageId
      ? { accessible: true, messageId: t.messageId, threadId: null, subject: "Re: Q4 proposal revisions", fromName: "Lena Carter", fromAddress: "lena@example.com", sentAt: day(-1, 10).toISOString(), folder: "INBOX", mailboxId: null }
      : null,
  };
}

interface Api {
  tasks: StubTask[];
  writes: Array<{ method: string; path: string; body: unknown }>;
}

function view(api: Api, name: string, days: number, extra: { teamId?: string | null; scope?: string | null } = {}) {
  const all = api.tasks.map(dto);
  if (name === "following") return all.filter((t) => t.status !== "COMPLETED" && t.following);
  if (name === "team") return all.filter((t) => t.status !== "COMPLETED" && t.teamId === extra.teamId);
  if (name === "completed" && extra.scope === "team") return all.filter((t) => t.status === "COMPLETED" && t.teamId);
  // My views are what I own.
  const open = all.filter((t) => t.status !== "COMPLETED" && t.owner.id === ME.id);
  switch (name) {
    case "today":
      return open.filter((t) => t.dueState === "overdue" || t.dueState === "today");
    case "overdue":
      return open.filter((t) => t.dueState === "overdue");
    case "upcoming":
      return open.filter((t) => t.dueState === "upcoming" && new Date(t.dueAt!) < day(1 + days));
    case "completed":
      return all.filter((t) => t.status === "COMPLETED");
    case "from_email":
      return open.filter((t) => t.hasLinkedEmail);
    case "assigned":
      return open.filter((t) => t.isAssigned);
    default:
      return open;
  }
}

/** The tasks API, kept in memory. Registered after the webmail stub, so it wins for /tasks. */
async function stubTasks(page: Page): Promise<Api> {
  const api: Api = { tasks: seed(), writes: [] };
  let seq = 100;
  await page.route(
    (url) => url.pathname.startsWith("/api/v1/tasks"),
    async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      const path = url.pathname.replace("/api/v1/tasks", "");
      const method = request.method();
      const body = method === "GET" || method === "DELETE" ? undefined : request.postDataJSON();
      if (method !== "GET") api.writes.push({ method, path, body });

      if (path === "" && method === "GET") {
        const items = view(api, url.searchParams.get("view") ?? "all", Number(url.searchParams.get("days") ?? 7), {
          teamId: url.searchParams.get("teamId"),
          scope: url.searchParams.get("scope"),
        });
        const q = url.searchParams.get("q")?.toLowerCase();
        return route.fulfill(json({ items: q ? items.filter((t) => t.title.toLowerCase().includes(q)) : items, nextCursor: null, timeZone: "Europe/London" }));
      }
      if (path === "/summary") {
        const open = view(api, "all", 7);
        return route.fulfill(
          json({
            timeZone: "Europe/London",
            today: "",
            counts: {
              open: open.length,
              overdue: open.filter((t) => t.dueState === "overdue").length,
              dueToday: open.filter((t) => t.dueState === "today").length,
              next7Days: view(api, "upcoming", 7).length,
              upcoming: open.filter((t) => t.dueState === "upcoming").length,
              fromEmail: view(api, "from_email", 7).length,
              assigned: view(api, "assigned", 7).length,
              completedThisWeek: view(api, "completed", 7).length,
              teamCompletionsThisWeek: view(api, "completed", 7, { scope: "team" }).length,
              following: view(api, "following", 7).length,
            },
          })
        );
      }
      if (path === "/teams") {
        const open = view(api, "team", 7, { teamId: TEAM.id });
        return route.fulfill(json([{ ...TEAM, memberCount: 2, counts: { open: open.length, dueNext3Days: open.length, overdue: 0, assignedToMe: 0, completedThisWeek: 0 } }]));
      }
      if (path === "/search") {
        const q = (url.searchParams.get("q") ?? "").toLowerCase();
        return route.fulfill(json(api.tasks.map(dto).filter((t) => t.title.toLowerCase().includes(q))));
      }
      if (path === "/assignees") {
        const team = url.searchParams.get("teamId");
        return route.fulfill(json((team ? [ME, SARAH] : [ME, LENA, SARAH]).map((p) => ({ ...p, isMe: p.id === ME.id }))));
      }
      if (path === "/export") {
        return route.fulfill({
          status: 200,
          contentType: "text/csv; charset=utf-8",
          // As the real API does (app.ts): the page is another origin, which may only read exposed headers.
          headers: {
            "Content-Disposition": 'attachment; filename="completed-tasks-2026-10-26.csv"',
            "Access-Control-Expose-Headers": "Content-Disposition",
            "Access-Control-Allow-Origin": "http://localhost:3000",
            "Access-Control-Allow-Credentials": "true",
          },
          body: "Title\nFinalize client onboarding handoff\n",
        });
      }
      if (path === "" && method === "POST") {
        const task: StubTask = {
          id: `t-${seq++}`,
          title: body.title,
          description: body.description ?? null,
          status: body.status ?? "OPEN",
          priority: body.priority ?? "MEDIUM",
          dueAt: body.dueAt ?? null,
          originalDueAt: null,
          completedAt: null,
          completedBy: null,
          messageId: null,
          teamId: body.teamId ?? null,
          reminderAt: body.reminderAt ?? null,
          following: false,
          owner: PEOPLE[body.ownerUserId ?? "u1"] ?? ME,
          createdBy: ME,
          checklist: (body.checklist ?? []).map((text: string, i: number) => ({ id: `c-${seq++}`, text, done: false, position: i })),
        };
        api.tasks.push(task);
        return route.fulfill({ ...json(detail(task)), status: 201 });
      }
      const fromMessage = path.match(/^\/from-message\/([^/]+)$/);
      if (fromMessage) {
        const task: StubTask = { ...seed()[1]!, id: `t-${seq++}`, title: body.title, messageId: fromMessage[1]!, checklist: [] };
        api.tasks.push(task);
        return route.fulfill({ ...json(detail(task)), status: 201 });
      }
      const match = path.match(/^\/([^/]+)(\/.*)?$/);
      const task = match && api.tasks.find((t) => t.id === match[1]);
      if (!task) return route.fulfill({ status: 404, contentType: "application/json", body: JSON.stringify({ success: false, error: { code: "NOT_FOUND", message: "Task not found" } }) });
      const action = match![2] ?? "";
      if (action === "/activity") {
        return route.fulfill(
          json([
            { id: "a1", type: "TASK_CREATED", at: day(-3, 10).toISOString(), actor: { id: ME.id, displayName: ME.displayName }, label: "Created the task" },
            { id: "a2", type: "TASK_REASSIGNED", at: day(-2, 11).toISOString(), actor: { id: ME.id, displayName: ME.displayName }, label: "Handed over from Michael Irvine to Sarah Chen" },
          ])
        );
      }
      if (action === "/follow") task.following = method === "POST";
      if (action === "/complete") Object.assign(task, { status: "COMPLETED", completedAt: new Date().toISOString(), completedBy: ME });
      if (action === "/reopen") Object.assign(task, { status: "OPEN", completedAt: null, completedBy: null });
      if (action === "/reschedule") Object.assign(task, { originalDueAt: task.originalDueAt ?? task.dueAt, dueAt: body.dueAt });
      const item = action.match(/^\/checklist\/([^/]+)$/);
      if (item && method === "PATCH") Object.assign(task.checklist.find((c) => c.id === item[1])!, body);
      if (action === "/checklist" && method === "POST") task.checklist.push({ id: `c-${seq++}`, text: body.text, done: false, position: task.checklist.length });
      if (action === "" && method === "PATCH") {
        const { ownerUserId, ...rest } = body;
        Object.assign(task, rest, ownerUserId ? { owner: PEOPLE[ownerUserId] } : {});
      }
      return route.fulfill(json(detail(task)));
    }
  );
  return api;
}

async function openTasks(page: Page, path = "/mail/tasks"): Promise<Api> {
  await page.addInitScript(() => window.localStorage.setItem("theme", "dark"));
  await openWebmail(page);
  const api = await stubTasks(page);
  await page.goto(path);
  return api;
}

test("My Tasks shows the figures, the grouped queue and the selected task from the API", async ({ page }) => {
  await openTasks(page);
  await expect(page.getByRole("heading", { name: "My Tasks", level: 1 })).toBeVisible({ timeout: 60_000 });

  const cards = page.getByTestId("task-summary-card");
  await expect(cards.nth(0)).toContainText("2");
  await expect(cards.nth(0)).toContainText("Due today");
  await expect(cards.nth(1)).toContainText("1");
  await expect(cards.nth(2)).toContainText("Completed");

  const sidebar = page.getByRole("complementary", { name: "Tasks" });
  await expect(sidebar.getByRole("link", { name: /My Tasks\s*4/ })).toBeVisible();
  await expect(sidebar.getByRole("link", { name: /Overdue\s*1/ })).toBeVisible();
  await expect(sidebar.getByRole("link", { name: /Assigned to Me\s*1/ })).toBeVisible();
  await expect(sidebar.getByRole("link", { name: "Following" })).toBeVisible();

  const list = page.getByTestId("task-list");
  await expect(list.getByText("Overdue", { exact: true })).toBeVisible();
  await expect(list.getByText("Due today", { exact: true })).toBeVisible();
  await expect(list.getByText("Prepare Monday team briefing")).toBeVisible();
  await expect(list.getByText("From Lena")).toBeVisible();

  await list.getByText("Review revised Q4 proposal").click();
  await expect(page).toHaveURL(/\/mail\/tasks\?task=t-q4$/);
  const details = page.getByRole("region", { name: "Task details" });
  await expect(details.getByTestId("task-detail-title")).toHaveText("Review revised Q4 proposal");
  await expect(details.getByText("2 of 3 complete")).toBeVisible();
  await expect(details.getByText("Re: Q4 proposal revisions")).toBeVisible();
  await expect(details.getByRole("link", { name: /Open source email/ })).toHaveAttribute("href", "/mail?message=m1&folder=INBOX");
  await shot(page, "tasks-1-my");
});

test("ticking a checklist step and completing a task send exactly that", async ({ page }) => {
  const api = await openTasks(page, "/mail/tasks?task=t-q4");
  const details = page.getByRole("region", { name: "Task details" });
  await expect(details.getByText("2 of 3 complete")).toBeVisible({ timeout: 60_000 });

  await details.getByText("Send consolidated feedback").click();
  await expect(details.getByText("3 of 3 complete")).toBeVisible();
  expect(api.writes).toContainEqual({ method: "PATCH", path: "/t-q4/checklist/c3", body: { done: true } });

  await details.getByRole("button", { name: "Mark complete" }).click();
  await expect(details.getByRole("heading", { name: "Completion details" })).toBeVisible();
  expect(api.writes.some((w) => w.method === "POST" && w.path === "/t-q4/complete")).toBe(true);
});

test("a new task sends what was entered and opens selected", async ({ page }) => {
  const api = await openTasks(page);
  await expect(page.getByRole("heading", { name: "My Tasks", level: 1 })).toBeVisible({ timeout: 60_000 });
  await page.getByRole("button", { name: "New task", exact: true }).click();

  const dialog = page.getByRole("dialog", { name: "New task" });
  await dialog.getByPlaceholder("What needs doing?").fill("Send client onboarding pack");
  await dialog.getByPlaceholder("Add the context someone would need").fill("Confirm recipient list and final documents");
  await dialog.locator('input[type="date"]').fill("2030-01-15");
  await dialog.locator('input[type="time"]').fill("14:00");
  await dialog.getByRole("combobox").first().selectOption("HIGH");
  await dialog.getByLabel("New checklist step").fill("Confirm recipients");
  await dialog.getByRole("button", { name: "Add" }).click();
  await dialog.getByRole("button", { name: "Create task" }).click();

  await expect(dialog).toBeHidden();
  const create = api.writes.find((w) => w.method === "POST" && w.path === "");
  expect(create?.body).toMatchObject({
    title: "Send client onboarding pack",
    description: "Confirm recipient list and final documents",
    dueAt: new Date(2030, 0, 15, 14, 0).toISOString(),
    priority: "HIGH",
    status: "OPEN",
    checklist: ["Confirm recipients"],
  });
  await expect(page.getByTestId("task-detail-title")).toHaveText("Send client onboarding pack");
});

test("Overdue lists how late each task is, and rescheduling keeps the original date", async ({ page }) => {
  const api = await openTasks(page, "/mail/tasks/overdue");
  await expect(page.getByRole("heading", { name: "Overdue Tasks", level: 1 })).toBeVisible({ timeout: 60_000 });
  const table = page.getByTestId("task-list");
  await expect(table.getByRole("row", { name: /Resolve customer access request.*2 days/ })).toBeVisible();

  const details = page.getByRole("region", { name: "Task details" });
  await expect(details.getByText("2 days overdue")).toBeVisible();
  await expect(details.getByText(/The original deadline has passed/)).toBeVisible();
  await shot(page, "tasks-2-overdue");

  await details.getByRole("button", { name: "Reschedule" }).click();
  await page.getByRole("dialog", { name: "Reschedule task" }).getByRole("button", { name: /^Tomorrow/ }).click();
  const move = api.writes.find((w) => w.path === "/t-overdue/reschedule");
  expect(move?.body).toEqual({ dueAt: day(1, 9).toISOString() });
  await expect(table.getByText("Resolve customer access request")).toBeHidden();
});

test("completed work is read-only and reopens only with a reason", async ({ page }) => {
  const api = await openTasks(page, "/mail/tasks/completed");
  await expect(page.getByRole("heading", { name: "Completed Tasks", level: 1 })).toBeVisible({ timeout: 60_000 });
  const details = page.getByRole("region", { name: "Task details" });
  await expect(details.getByTestId("task-detail-title")).toHaveText("Finalize client onboarding handoff");
  await expect(details.getByRole("heading", { name: "Completion details" })).toBeVisible();
  await expect(details.getByRole("button", { name: "Mark complete" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Export history/ })).toBeEnabled();
  await shot(page, "tasks-3-completed");

  await details.getByRole("button", { name: "Reopen" }).click();
  const dialog = page.getByRole("dialog", { name: "Reopen task" });
  await expect(dialog.getByRole("button", { name: "Reopen task" })).toBeDisabled();
  await dialog.getByPlaceholder(/The client asked/).fill("Client asked for one more change");
  await dialog.getByRole("button", { name: "Reopen task" }).click();
  expect(api.writes).toContainEqual({ method: "POST", path: "/t-done/reopen", body: { reason: "Client asked for one more change" } });
});

test("an email becomes a task from the reading pane", async ({ page }) => {
  await openWebmail(page);
  const api = await stubTasks(page);
  await page.getByText("Sarah Mitchell", { exact: true }).first().click();
  await page.getByRole("button", { name: "Create task" }).click();

  const dialog = page.getByRole("dialog", { name: "Create task from email" });
  await expect(dialog.getByPlaceholder("What needs doing?")).toHaveValue("Follow up: Project update — Q4 planning");
  await dialog.getByRole("button", { name: "Create task" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Task created" })).toBeVisible();
  const create = api.writes.find((w) => w.path === "/from-message/m1");
  expect(create?.body).toMatchObject({ title: "Follow up: Project update — Q4 planning", priority: "MEDIUM" });
  await expect(page.getByRole("link", { name: "View task" })).toHaveAttribute("href", /\/mail\/tasks\/from-email\?task=t-/);
});

test("a team workspace lists the team's work, and a team task goes to a teammate", async ({ page }) => {
  const api = await openTasks(page);
  const sidebar = page.getByRole("complementary", { name: "Tasks" });
  await sidebar.getByTestId("team-workspaces").getByRole("link", { name: /Product Operations\s*1/ }).click({ timeout: 60_000 });
  await expect(page).toHaveURL(/\/mail\/tasks\/team\/team-ops/);
  await expect(page.getByRole("heading", { name: "Product Operations", level: 1 })).toBeVisible();

  const table = page.getByTestId("task-list");
  await expect(table.getByRole("row", { name: /Finalize partner launch checklist.*Sarah/ })).toBeVisible();
  const details = page.getByRole("region", { name: "Task details" });
  await expect(details.getByText("Accountable owner")).toBeVisible();
  await expect(details.getByRole("link", { name: "Product Operations" })).toBeVisible();
  await shot(page, "tasks-4-team");

  await page.getByRole("button", { name: "New team task" }).click();
  const dialog = page.getByRole("dialog", { name: "New task" });
  await expect(dialog.getByLabel("Team workspace")).toHaveValue("team-ops");
  await dialog.getByPlaceholder("What needs doing?").fill("Resolve shared-inbox escalation");
  await dialog.getByLabel("Assigned to").selectOption("u3");
  await dialog.getByRole("button", { name: "Create task" }).click();
  await expect(dialog).toBeHidden();

  const create = api.writes.find((w) => w.method === "POST" && w.path === "");
  expect(create?.body).toMatchObject({ title: "Resolve shared-inbox escalation", teamId: "team-ops", ownerUserId: "u3" });
  await expect(table.getByRole("row", { name: /Resolve shared-inbox escalation.*Sarah/ })).toBeVisible();
});

test("a reminder is set from the details panel and shown on the task", async ({ page }) => {
  const api = await openTasks(page, "/mail/tasks?task=t-brief");
  const details = page.getByRole("region", { name: "Task details" });
  await expect(details.getByTestId("task-detail-title")).toHaveText("Prepare Monday team briefing", { timeout: 60_000 });
  await details.getByRole("button", { name: "Reminder" }).click();
  await page.getByRole("dialog", { name: "Set a reminder" }).getByRole("button", { name: /^Tomorrow morning/ }).click();

  expect(api.writes).toContainEqual({ method: "PATCH", path: "/t-brief", body: { reminderAt: day(1, 9).toISOString() } });
  await expect(details.locator("dt", { hasText: "Reminder" })).toBeVisible();
});

test("completed history shows the team's work and exports as CSV", async ({ page }) => {
  const api = await openTasks(page, "/mail/tasks/completed");
  await expect(page.getByRole("heading", { name: "Completed Tasks", level: 1 })).toBeVisible({ timeout: 60_000 });
  api.tasks.find((t) => t.id === "t-team")!.status = "COMPLETED";
  api.tasks.find((t) => t.id === "t-team")!.completedAt = new Date().toISOString();

  const requests: string[] = [];
  page.on("request", (r) => requests.push(r.url()));
  await page.getByRole("tab", { name: "By my team" }).click();
  await expect(page.getByTestId("task-list").getByText("Finalize partner launch checklist")).toBeVisible();
  expect(requests.some((u) => u.includes("view=completed") && u.includes("scope=team"))).toBe(true);

  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: /Export history/ }).click();
  expect((await download).suggestedFilename()).toBe("completed-tasks-2026-10-26.csv");
  expect(requests.some((u) => u.includes("/tasks/export?") && u.includes("scope=team") && u.includes("days=30"))).toBe(true);
});

test("following a team task puts it on the Following page, with its history", async ({ page }) => {
  const api = await openTasks(page, "/mail/tasks/team/team-ops?task=t-team");
  const details = page.getByRole("region", { name: "Task details" });
  await expect(details.getByTestId("task-detail-title")).toHaveText("Finalize partner launch checklist", { timeout: 60_000 });
  await expect(details.getByTestId("task-activity")).toContainText("Handed over from Michael Irvine to Sarah Chen");

  await details.getByRole("button", { name: "Follow" }).click();
  await expect(details.getByRole("button", { name: /Following/ })).toHaveAttribute("aria-pressed", "true");
  expect(api.writes.some((w) => w.method === "POST" && w.path === "/t-team/follow")).toBe(true);

  const sidebar = page.getByRole("complementary", { name: "Tasks" });
  await sidebar.getByRole("link", { name: /Following\s*1/ }).click();
  await expect(page).toHaveURL(/\/mail\/tasks\/following/);
  await expect(page.getByTestId("task-list").getByText("Finalize partner launch checklist")).toBeVisible();
  await shot(page, "tasks-5-following");
});

test("the top bar finds tasks from anywhere in Tasks, and opens the one chosen", async ({ page }) => {
  await openTasks(page, "/mail/tasks/overdue");
  await expect(page.getByRole("heading", { name: "Overdue Tasks", level: 1 })).toBeVisible({ timeout: 60_000 });

  const search = page.getByRole("combobox", { name: "Search tasks" });
  await search.fill("partner");
  const results = page.getByRole("listbox", { name: "Tasks" });
  await expect(results.getByRole("option")).toHaveCount(1);
  await expect(results).toContainText("Finalize partner launch checklist");
  await expect(results).toContainText("Product Operations · Sarah Chen");
  await shot(page, "tasks-6-search");

  await search.press("ArrowDown");
  await search.press("Enter");
  await expect(page).toHaveURL(/\/mail\/tasks\/team\/team-ops\?task=t-team$/);
  await expect(page.getByTestId("task-detail-title")).toHaveText("Finalize partner launch checklist");

  await search.fill("nothing like this");
  await expect(page.getByRole("listbox", { name: "Tasks" })).toContainText("No tasks match");
});
