import { test, expect, type Page } from "@playwright/test";
import { json } from "./admin-harness";

/**
 * Meeting Templates (Calendar step 6), against an in-memory stand-in for the API.
 *
 * What these protect: edits save exactly what was changed; a member's team
 * template goes to review while a manager approves or sends it back; using a
 * template fills in a new meeting, and its safeguards (no clash with my
 * calendar, members only where set) stop a meeting that breaks them.
 */

const BASE = {
  teamCalendarId: null as string | null,
  teamCalendar: null as { id: string; name: string; color: string } | null,
  locationDetail: null as string | null,
  defaultAttendees: [] as string[],
  bufferMinutes: 0,
  minNoticeHours: 0,
  externalGuests: "APPROVAL",
  recordingAllowed: false,
  reviewNote: null as string | null,
  reviewedBy: null as string | null,
  reviewedAt: null,
  createdAt: "2026-10-01T00:00:00.000Z",
  updatedAt: "2026-10-01T00:00:00.000Z",
  owner: { name: "Michael Irvine", email: "michael@acme.test" },
};
const TEAM = { id: "c-team", name: "Product & Engineering", color: "purple" };

type Template = typeof BASE & {
  id: string;
  scope: string;
  title: string;
  agenda: string | null;
  durationMinutes: number;
  locationType: string;
  status: string;
  isMine: boolean;
  canEdit: boolean;
  canReview: boolean;
};

function seedTemplates(role: "member" | "manager"): Template[] {
  return [
    {
      ...BASE,
      id: "t1",
      scope: "PERSONAL",
      title: "Customer onboarding call",
      agenda: "1. Goals\n2. Product walkthrough\n3. Next steps",
      durationMinutes: 45,
      locationType: "VIDEO",
      locationDetail: "https://meet.example.com/onboarding",
      defaultAttendees: ["sarah@acme.test"],
      bufferMinutes: 10,
      status: "READY",
      isMine: true,
      canEdit: true,
      canReview: false,
    },
    {
      ...BASE,
      id: "t2",
      scope: "TEAM",
      teamCalendarId: TEAM.id,
      teamCalendar: TEAM,
      title: "Sprint planning",
      agenda: "Review the board",
      durationMinutes: 60,
      locationType: "IN_PERSON",
      locationDetail: "Room 4B",
      externalGuests: "NOT_ALLOWED",
      status: "READY",
      owner: { name: "Priya Shah", email: "priya@acme.test" },
      reviewedBy: "Priya Shah",
      isMine: false,
      canEdit: role === "manager",
      canReview: role === "manager",
    },
    {
      ...BASE,
      id: "t3",
      scope: "TEAM",
      teamCalendarId: TEAM.id,
      teamCalendar: TEAM,
      title: "Release retro",
      agenda: null,
      durationMinutes: 30,
      locationType: "VIDEO",
      status: "PENDING_REVIEW",
      owner: { name: "James Carter", email: "james@acme.test" },
      isMine: false,
      canEdit: role === "manager",
      canReview: role === "manager",
    },
  ].filter((t) => role === "manager" || t.id !== "t3");
}

interface Api {
  templates: Template[];
  writes: Array<{ method: string; path: string; body: unknown }>;
  /** My busy time, as free/busy reports it. */
  busy: Array<{ start: string; end: string }>;
}

async function signedIn(page: Page, role: "member" | "manager" = "member", path = "/mail/calendar/templates"): Promise<Api> {
  const api: Api = { templates: seedTemplates(role), writes: [], busy: [] };
  await page.addInitScript(() => window.localStorage.setItem("theme", "dark"));
  await page.route(
    (url) => url.pathname.startsWith("/api/v1/"),
    async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      const p = url.pathname.replace("/api/v1", "");
      const method = request.method();
      const body = method === "GET" || method === "DELETE" ? null : request.postDataJSON();
      if (method !== "GET") api.writes.push({ method, path: p, body });
      const session = {
        accessToken: "stub-access-token",
        refreshToken: "stub-refresh-token",
        expiresIn: "12h",
        user: { id: "u1", email: "michael@acme.test", displayName: "Michael Irvine" },
        tenant: { id: "t1", name: "Acme Workspace", planCode: "business" },
        membership: { id: "m1", role: "MEMBER" },
        workspace: "MEMBER",
      };
      if (p === "/events/stream") return route.fulfill({ status: 200, contentType: "text/event-stream", body: "" });
      if (p === "/auth/login") return route.fulfill(json({ state: "SIGNED_IN", session, ...session }));
      if (p === "/auth/me") return route.fulfill(json({ ...session.user, tenant: session.tenant, membership: session.membership, workspace: "MEMBER" }));
      if (p === "/mail/mailbox") return route.fulfill(json({ address: "michael@acme.test", storageUsed: 2.4 * 1024 ** 3, storageLimit: 10 * 1024 ** 3 }));
      if (p === "/calendar/invitations/counts") return route.fulfill(json({ awaiting: 0, updates: 0 }));
      if (p === "/calendar/calendars") return route.fulfill(json([]));
      if (p === "/calendar/people") return route.fulfill(json([{ email: "sarah@acme.test", name: "Sarah Chen" }]));
      if (p === "/calendar/accessible")
        return route.fulfill(
          json([
            { id: "c-work", kind: "PERSONAL", name: "Work", color: "blue", description: null, isDefault: true, isVisible: true, access: "OWNER", owner: null, sharedWithCount: 0 },
            { ...TEAM, kind: "TEAM", description: null, isDefault: false, isVisible: true, access: role === "manager" ? "MANAGE" : "EDIT", owner: { name: "Priya Shah", email: "priya@acme.test" }, sharedWithCount: 4 },
          ])
        );
      if (p === "/calendar/freebusy") {
        // Workspace members come back; anyone else is outside the workspace.
        const emails = (url.searchParams.get("emails") ?? "").split(",").filter((e) => e.endsWith("@acme.test"));
        return route.fulfill(
          json([
            { membershipId: "m1", name: "Michael Irvine", email: "michael@acme.test", isMe: true, busy: api.busy },
            ...emails.map((email, i) => ({ membershipId: `m-${i}`, name: email, email, isMe: false, busy: [] })),
          ])
        );
      }
      if (p === "/calendar/events" && method === "POST") return route.fulfill({ ...json({ id: "e-new", ...body }), status: 201 });
      if (p === "/calendar/events") return route.fulfill(json([]));
      if (p === "/calendar/templates" && method === "GET") return route.fulfill(json(api.templates));
      if (p === "/calendar/templates" && method === "POST") {
        const team = body.scope === "TEAM";
        const created = {
          ...BASE,
          id: "t-new",
          scope: body.scope ?? "PERSONAL",
          teamCalendarId: team ? body.teamCalendarId : null,
          teamCalendar: team ? TEAM : null,
          title: body.title,
          agenda: null,
          durationMinutes: body.durationMinutes,
          locationType: "VIDEO",
          status: team && role === "member" ? "PENDING_REVIEW" : body.status,
          isMine: true,
          canEdit: true,
          canReview: team && role === "manager",
        };
        api.templates.unshift(created);
        return route.fulfill({ ...json(created), status: 201 });
      }
      const m = p.match(/^\/calendar\/templates\/([^/]+)(?:\/(duplicate|review))?$/);
      if (m) {
        const t = api.templates.find((x) => x.id === m[1])!;
        if (m[2] === "duplicate") {
          const copy = { ...t, id: "t-copy", scope: "PERSONAL", teamCalendarId: null, teamCalendar: null, title: `${t.title} (copy)`, status: "DRAFT", isMine: true, canEdit: true, canReview: false };
          api.templates.unshift(copy);
          return route.fulfill({ ...json(copy), status: 201 });
        }
        if (m[2] === "review") {
          Object.assign(t, { status: body.approve ? "READY" : "DRAFT", reviewNote: body.note ?? null, updatedAt: new Date().toISOString() });
          return route.fulfill(json(t));
        }
        if (method === "PATCH") {
          Object.assign(t, body, { updatedAt: new Date().toISOString() });
          return route.fulfill(json(t));
        }
        if (method === "DELETE") {
          api.templates = api.templates.filter((x) => x.id !== t.id);
          return route.fulfill({ status: 204, body: "" });
        }
      }
      return route.fulfill(json([]));
    }
  );
  await page.setViewportSize({ width: 1700, height: 1000 });
  await page.goto("/login/member");
  await page.getByPlaceholder("john@example.com").fill("michael@acme.test");
  await page.getByPlaceholder("Enter your password").fill("Password123!");
  await page.getByRole("button", { name: "Sign In to Member Workspace" }).click();
  await expect(page).toHaveURL(/\/mail$/, { timeout: 60_000 });
  await page.goto(path);
  await expect(page.getByRole("heading", { level: 1, name: "Meeting Templates & Event Presets" })).toBeVisible({ timeout: 60_000 });
  return api;
}

async function shot(page: Page, name: string) {
  if (process.env.E2E_SCREENSHOTS) await page.screenshot({ path: `${process.env.E2E_SCREENSHOTS}/${name}.png` });
}

const list = (page: Page) => page.getByTestId("template-list");
const editor = (page: Page) => page.getByTestId("template-editor");
const dialog = (page: Page) => page.getByRole("dialog");

test.describe("the template library", () => {
  test("lists templates with their kind and status, and previews the invitation", async ({ page }) => {
    await signedIn(page, "manager");
    const stats = page.getByTestId("template-stats");
    await expect(stats).toContainText("Meeting templates");
    await expect(stats).toContainText("1 personal · 2 team-managed");
    await expect(stats).toContainText("Awaiting approval");
    await expect(page.getByRole("tab", { name: /Review Queue/ })).toContainText("(1)");
    await expect(list(page).getByRole("button", { name: /Customer onboarding call/ })).toContainText("Personal");
    await expect(list(page).getByRole("button", { name: /Sprint planning/ })).toContainText("Team");
    await expect(list(page).getByRole("button", { name: /Release retro/ })).toContainText("Needs review");
    const preview = page.getByTestId("invitation-preview");
    await expect(preview).toContainText("Customer onboarding call");
    await expect(preview).toContainText("45 min");
    await expect(preview).toContainText("Product walkthrough");
    await shot(page, "templates-1-library");
  });

  test("saves changed defaults and safeguards exactly", async ({ page }) => {
    const api = await signedIn(page);
    const ed = editor(page);
    await ed.getByLabel("Duration").selectOption("30");
    await ed.getByLabel("Default agenda").fill("Intro\nDemo");
    await ed.getByLabel("Buffer").selectOption("15");
    await ed.getByLabel("Minimum notice").selectOption("24");
    await ed.getByLabel("External guest invitations").selectOption("NOT_ALLOWED");
    await ed.getByLabel("Allow recording or AI recap").check();
    await ed.getByRole("button", { name: "Save template" }).click();
    await expect.poll(() => api.writes.find((w) => w.method === "PATCH" && w.path === "/calendar/templates/t1")?.body).toEqual({
      durationMinutes: 30,
      agenda: "Intro\nDemo",
      bufferMinutes: 15,
      minNoticeHours: 24,
      externalGuests: "NOT_ALLOWED",
      recordingAllowed: true,
    });
  });

  test("discards unsaved edits", async ({ page }) => {
    const api = await signedIn(page);
    const ed = editor(page);
    await ed.getByLabel("Event title").fill("Something else");
    await ed.getByRole("button", { name: "Discard" }).click();
    await expect(ed.getByLabel("Event title")).toHaveValue("Customer onboarding call");
    expect(api.writes.filter((w) => w.method === "PATCH")).toHaveLength(0);
  });

  test("shows a team template read-only to a member, who can still duplicate it", async ({ page }) => {
    const api = await signedIn(page);
    await list(page).getByRole("button", { name: /Sprint planning/ }).click();
    const ed = editor(page);
    await expect(ed).toContainText("Managed by the team");
    await expect(ed.getByLabel("Event title")).toBeDisabled();
    await expect(ed.getByRole("button", { name: "Save template" })).toHaveCount(0);
    await page.getByRole("button", { name: "Duplicate" }).click();
    await expect.poll(() => api.writes.some((w) => w.method === "POST" && w.path === "/calendar/templates/t2/duplicate")).toBe(true);
    await expect(editor(page)).toContainText("Sprint planning (copy)");
  });
});

test.describe("team templates and review", () => {
  test("a member's new team template is submitted for review", async ({ page }) => {
    const api = await signedIn(page);
    await page.getByRole("button", { name: "New template" }).first().click();
    const d = dialog(page);
    await d.getByLabel("Template name").fill("Design critique");
    await d.getByLabel("Who uses it").selectOption(TEAM.id);
    await d.getByLabel("Duration").selectOption("60");
    await expect(d).toContainText("A team manager reviews it");
    await d.getByRole("button", { name: "Create and submit for review" }).click();
    await expect.poll(() => api.writes.find((w) => w.method === "POST" && w.path === "/calendar/templates")?.body).toEqual({
      title: "Design critique",
      durationMinutes: 60,
      scope: "TEAM",
      teamCalendarId: TEAM.id,
      status: "READY",
    });
    await expect(page).toHaveURL(/tab=review/);
    await expect(editor(page)).toContainText("Waiting for a team manager");
  });

  test("a manager approves, or sends back with a note", async ({ page }) => {
    const api = await signedIn(page, "manager", "/mail/calendar/templates?tab=review");
    await expect(list(page).getByRole("button")).toHaveCount(1);
    const panel = page.getByTestId("review-panel");
    await expect(panel).toContainText("Submitted by James Carter");
    await shot(page, "templates-2-review");
    await panel.getByLabel("Note if you send it back").fill("Add an agenda");
    await panel.getByRole("button", { name: "Send back" }).click();
    await expect.poll(() => api.writes.find((w) => w.path === "/calendar/templates/t3/review")?.body).toEqual({ approve: false, note: "Add an agenda" });
  });

  test("the sidebar opens the review queue", async ({ page }) => {
    await signedIn(page, "manager");
    await page.getByRole("button", { name: /Pending Review/ }).click();
    await expect(page).toHaveURL(/tab=review/);
    await expect(page.getByRole("tab", { name: /Review Queue/ })).toHaveAttribute("aria-selected", "true");
  });
});

test.describe("using a template", () => {
  test("fills in a new meeting, and creates it with those details", async ({ page }) => {
    const api = await signedIn(page);
    await editor(page).getByRole("button", { name: "Use template" }).click();
    const d = dialog(page);
    await expect(d.getByLabel("Title")).toHaveValue("Customer onboarding call");
    await expect(d.getByLabel("Video link")).toHaveValue("https://meet.example.com/onboarding");
    await expect(d.getByLabel("Agenda or notes")).toHaveValue("1. Goals\n2. Product walkthrough\n3. Next steps");
    await expect(d.getByTestId("attendee-chip")).toHaveCount(1);
    await expect(d.getByTestId("template-rules")).toContainText("10-min buffer");
    await shot(page, "templates-3-use");
    await d.getByRole("button", { name: "Create event" }).click();
    await expect.poll(() => api.writes.find((w) => w.method === "POST" && w.path === "/calendar/events")?.body).toBeTruthy();
    const sent = api.writes.find((w) => w.path === "/calendar/events")!.body as Record<string, string | string[]>;
    expect(sent).toMatchObject({ title: "Customer onboarding call", videoLink: "https://meet.example.com/onboarding", attendees: ["sarah@acme.test"], calendarId: "c-work" });
    expect(new Date(sent.endsAt as string).getTime() - new Date(sent.startsAt as string).getTime()).toBe(45 * 60_000);
  });

  test("refuses a time that clashes with my calendar, buffer included", async ({ page }) => {
    const api = await signedIn(page);
    // Busy right up to a few minutes before any half-hour start: inside the 10-minute buffer.
    const now = Date.now();
    api.busy = [{ start: new Date(now - 3_600_000).toISOString(), end: new Date(now + 2 * 3_600_000).toISOString() }];
    await editor(page).getByRole("button", { name: "Use template" }).click();
    const d = dialog(page);
    await expect(d.getByLabel("Title")).toHaveValue("Customer onboarding call");
    await d.getByRole("button", { name: "Create event" }).click();
    await expect(d.getByRole("alert").filter({ hasText: "overlaps something in your calendar" })).toBeVisible();
    expect(api.writes.some((w) => w.path === "/calendar/events")).toBe(false);
  });

  test("keeps a members-only template to workspace members, in its team calendar", async ({ page }) => {
    const api = await signedIn(page);
    await list(page).getByRole("button", { name: /Sprint planning/ }).click();
    await editor(page).getByRole("button", { name: "Use template" }).click();
    const d = dialog(page);
    await expect(d.getByLabel("Calendar")).toHaveValue(TEAM.id);
    await expect(d.getByLabel("Location")).toHaveValue("Room 4B");
    const invite = d.locator("#ev-attendees");
    await invite.fill("dana@outside.example");
    await invite.press("Enter");
    await d.getByRole("button", { name: "Create event" }).click();
    await expect(d.getByRole("alert").filter({ hasText: "workspace members only" })).toBeVisible();
    expect(api.writes.some((w) => w.path === "/calendar/events")).toBe(false);
    await d.getByRole("button", { name: "Remove dana@outside.example" }).click();
    await d.getByRole("button", { name: "Create event" }).click();
    await expect.poll(() => api.writes.find((w) => w.path === "/calendar/events")?.body).toMatchObject({ calendarId: TEAM.id, title: "Sprint planning" });
  });
});
