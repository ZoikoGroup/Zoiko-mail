import { test, expect, type Page } from "@playwright/test";
import { json } from "./admin-harness";

/**
 * My Calendar (Calendar step 1), driven by an in-memory stand-in for the
 * calendar API that behaves like the server: it keeps what is created, edited
 * and deleted, and answers each list with the events in the range asked for.
 *
 * What these protect: the views show the events the server returns where they
 * belong in time; creating, editing and deleting send exactly what the person
 * entered; hiding a calendar hides its events. Set E2E_SCREENSHOTS to a
 * folder to also save dark-mode screenshots.
 */

interface StubEvent {
  id: string;
  calendarId: string;
  title: string;
  description: string | null;
  location: string | null;
  videoLink: string | null;
  startsAt: string;
  endsAt: string;
  allDay: boolean;
  timeZone: string;
  visibility: "DEFAULT" | "PRIVATE";
  showAs: "BUSY" | "FREE";
  createdAt: string;
  updatedAt: string;
  source?: "OWN" | "INVITED";
  myResponse?: string | null;
  organizerName?: string | null;
}

/** A local-time instant on the Monday of this week + `day`, at hh:mm. */
function thisWeek(day: number, hh: number, mm = 0): Date {
  const now = new Date();
  const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - ((now.getDay() + 6) % 7));
  return new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + day, hh, mm);
}

const CALENDARS = [
  { id: "c-work", kind: "PERSONAL", name: "Work", color: "blue", description: null, isDefault: true, isVisible: true, createdAt: "", updatedAt: "" },
  { id: "c-cust", kind: "PERSONAL", name: "Customer Meetings", color: "green", description: null, isDefault: false, isVisible: true, createdAt: "", updatedAt: "" },
  { id: "c-pers", kind: "PERSONAL", name: "Personal", color: "purple", description: null, isDefault: false, isVisible: true, createdAt: "", updatedAt: "" },
  { id: "c-focus", kind: "PERSONAL", name: "Focus Time", color: "amber", description: null, isDefault: false, isVisible: true, createdAt: "", updatedAt: "" },
];

function seedEvents(): StubEvent[] {
  const make = (id: string, calendarId: string, title: string, start: Date, minutes: number, extra: Partial<StubEvent> = {}): StubEvent => ({
    id,
    calendarId,
    title,
    description: null,
    location: null,
    videoLink: null,
    startsAt: start.toISOString(),
    endsAt: new Date(start.getTime() + minutes * 60_000).toISOString(),
    allDay: false,
    timeZone: "Europe/London",
    visibility: "DEFAULT",
    showAs: "BUSY",
    createdAt: "",
    updatedAt: "",
    ...extra,
  });
  return [
    make("e1", "c-work", "Product standup", thisWeek(0, 9), 30),
    make("e2", "c-pers", "Roadmap checkpoint", thisWeek(0, 11, 30), 60),
    make("e3", "c-cust", "Sprint planning", thisWeek(0, 15), 60),
    make("e4", "c-cust", "Partnership call", thisWeek(1, 10), 60),
    make("e5", "c-work", "Design critique", thisWeek(1, 13), 60),
    make("e6", "c-work", "Platform reliability", thisWeek(2, 9, 30), 60),
    make("e7", "c-pers", "Leadership sync", thisWeek(2, 15), 60),
    make("e8", "c-work", "Weekly standup", thisWeek(3, 9, 30), 30),
    make("e9", "c-cust", "Product review", thisWeek(3, 11), 60, { location: "Conference room" }),
    make("e10", "c-pers", "Client discovery", thisWeek(3, 14), 60, { videoLink: "https://meet.example.com/x" }),
    make("e11", "c-focus", "Focus: Mail roadmap", thisWeek(3, 16, 15), 60, { visibility: "PRIVATE" }),
    make("e12", "c-pers", "Security review", thisWeek(4, 10), 60),
    make("e13", "c-work", "Team retrospective", thisWeek(4, 13), 60),
    make("inv1", "c-someone-else", "Budget alignment", thisWeek(3, 12), 30, {
      source: "INVITED",
      myResponse: "NEEDS_ACTION",
      organizerName: "Sarah Chen",
    } as Partial<StubEvent>),
  ];
}

interface Api {
  events: StubEvent[];
  calendars: typeof CALENDARS;
  writes: Array<{ method: string; path: string; body: unknown }>;
}

async function openCalendar(page: Page, { dark = true } = {}): Promise<Api> {
  const api: Api = { events: seedEvents(), calendars: CALENDARS.map((c) => ({ ...c })), writes: [] };
  let seq = 100;
  if (dark) await page.addInitScript(() => window.localStorage.setItem("theme", "dark"));
  await page.route(
    (url) => url.pathname.startsWith("/api/v1/"),
    async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      const path = url.pathname.replace("/api/v1", "");
      const method = request.method();
      const session = {
        accessToken: "stub-access-token",
        refreshToken: "stub-refresh-token",
        expiresIn: "12h",
        user: { id: "u1", email: "michael@acme.test", displayName: "Michael Irvine" },
        tenant: { id: "t1", name: "Demo Workspace", planCode: "business" },
        membership: { id: "m1", role: "MEMBER" },
        workspace: "MEMBER",
      };
      if (path === "/events/stream") return route.fulfill({ status: 200, contentType: "text/event-stream", body: "" });
      if (path === "/auth/login") return route.fulfill(json({ state: "SIGNED_IN", session, ...session }));
      if (path === "/auth/me")
        return route.fulfill(json({ ...session.user, tenant: session.tenant, membership: session.membership, workspace: "MEMBER" }));
      if (path === "/mail/mailbox")
        return route.fulfill(json({ address: "michael@acme.test", storageUsed: 2.4 * 1024 ** 3, storageLimit: 10 * 1024 ** 3 }));
      if (path === "/mail/unread-counts") return route.fulfill(json({ counts: { INBOX: 0 } }));

      // ── the calendar API ──
      if (path === "/calendar/calendars" && method === "GET") return route.fulfill(json(api.calendars));
      const calendarMatch = path.match(/^\/calendar\/calendars\/([^/]+)$/);
      if (calendarMatch && method === "PATCH") {
        const body = request.postDataJSON();
        api.writes.push({ method, path, body });
        const calendar = api.calendars.find((c) => c.id === calendarMatch[1])!;
        Object.assign(calendar, body);
        return route.fulfill(json(calendar));
      }
      if (path === "/calendar/invitations/counts") {
        const waiting = api.events.filter((e) => e.source === "INVITED" && e.myResponse === "NEEDS_ACTION").length;
        return route.fulfill(json({ awaiting: waiting, updates: 0 }));
      }
      if (path === "/calendar/invitations") {
        const items = api.events
          .filter((e) => e.source === "INVITED" && e.myResponse === "NEEDS_ACTION")
          .map((e) => ({
            eventId: e.id,
            title: e.title,
            startsAt: e.startsAt,
            endsAt: e.endsAt,
            allDay: e.allDay,
            timeZone: e.timeZone,
            location: e.location,
            videoLink: e.videoLink,
            organizer: { name: e.organizerName, email: "sarah@acme.test" },
            attendeeCount: 3,
            myResponse: e.myResponse,
            isNew: true,
            hasUpdate: false,
            receivedAt: e.createdAt,
            responses: { accepted: 1, tentative: 0, declined: 0, needsAction: 2 },
          }));
        return route.fulfill(json(items));
      }
      const respondMatch = path.match(/^\/calendar\/events\/([^/]+)\/respond$/);
      if (respondMatch && method === "POST") {
        const body = request.postDataJSON();
        api.writes.push({ method, path, body });
        const event = api.events.find((e) => e.id === respondMatch[1])!;
        event.myResponse = body.response;
        return route.fulfill(json({ id: event.id, myResponse: body.response }));
      }
      if (path === "/calendar/events" && method === "GET") {
        const from = new Date(url.searchParams.get("from")!);
        const to = new Date(url.searchParams.get("to")!);
        return route.fulfill(json(api.events.filter((e) => new Date(e.startsAt) < to && new Date(e.endsAt) > from)));
      }
      if (path === "/calendar/events" && method === "POST") {
        const body = request.postDataJSON();
        api.writes.push({ method, path, body });
        const event: StubEvent = {
          id: `e${seq++}`,
          description: null,
          location: null,
          videoLink: null,
          allDay: false,
          timeZone: "UTC",
          visibility: "DEFAULT",
          showAs: "BUSY",
          createdAt: "",
          updatedAt: "",
          ...body,
        };
        api.events.push(event);
        return route.fulfill({ ...json(event), status: 201 });
      }
      if (path === "/calendar/people") {
        return route.fulfill(json([{ email: "sarah@acme.test", name: "Sarah Chen" }, { email: "james@acme.test", name: "James Carter" }]));
      }
      const eventMatch = path.match(/^\/calendar\/events\/([^/]+)$/);
      if (eventMatch && method === "GET") {
        const event = api.events.find((e) => e.id === eventMatch[1])!;
        return route.fulfill(json({ ...event, sequence: 0, attendees: [] }));
      }
      if (eventMatch && method === "PATCH") {
        const body = request.postDataJSON();
        api.writes.push({ method, path, body });
        const event = api.events.find((e) => e.id === eventMatch[1])!;
        Object.assign(event, body);
        return route.fulfill(json(event));
      }
      if (eventMatch && method === "DELETE") {
        api.writes.push({ method, path, body: null });
        api.events = api.events.filter((e) => e.id !== eventMatch[1]);
        return route.fulfill({ status: 204, body: "" });
      }
      return route.fulfill(json({ items: [], count: 0 }));
    }
  );
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.goto("/login/member");
  await page.getByPlaceholder("john@example.com").fill("michael@acme.test");
  await page.getByPlaceholder("Enter your password").fill("Password123!");
  await page.getByRole("button", { name: "Sign In to Member Workspace" }).click();
  await expect(page).toHaveURL(/\/mail$/, { timeout: 60_000 });
  await page.goto("/mail/calendar");
  await expect(page.getByRole("heading", { level: 1, name: "My Calendar" })).toBeVisible({ timeout: 60_000 });
  return api;
}

async function shot(page: Page, name: string) {
  if (process.env.E2E_SCREENSHOTS) await page.screenshot({ path: `${process.env.E2E_SCREENSHOTS}/${name}.png` });
}

test("shows this work week's events from the server, in their calendars", async ({ page }) => {
  await openCalendar(page);
  const grid = page.getByTestId("time-grid");
  await expect(grid.getByRole("button", { name: /Product standup/ })).toBeVisible();
  await expect(grid.getByRole("button", { name: /Team retrospective/ })).toBeVisible();
  await expect(page.getByTestId("range-count")).toContainText("14 events");
  // The calendars are listed with their show/hide checkboxes.
  const mine = page.getByTestId("my-calendars");
  for (const name of ["Work", "Customer Meetings", "Personal", "Focus Time"]) {
    await expect(mine.getByRole("checkbox", { name: `Show ${name}` })).toBeChecked();
  }
  await shot(page, "calendar-1-work-week");
});

test("creates an event from an empty slot and shows it", async ({ page }) => {
  const api = await openCalendar(page);
  // Thursday 15:00 is free.
  const slot = page.getByRole("button", { name: "New event at 15:00" }).nth(3);
  await slot.click();
  const dialog = page.getByRole("dialog", { name: "New event" });
  await dialog.getByLabel("Title").fill("Quarterly planning");
  await dialog.getByLabel("Calendar").selectOption({ label: "Customer Meetings" });
  await dialog.getByLabel(/Location/).fill("Horizon Room");
  await shot(page, "calendar-2-new-event");
  await dialog.getByRole("button", { name: "Create event" }).click();
  await expect(dialog).toHaveCount(0);

  const post = api.writes.find((w) => w.method === "POST");
  expect(post?.body).toMatchObject({
    title: "Quarterly planning",
    calendarId: "c-cust",
    location: "Horizon Room",
    allDay: false,
    startsAt: thisWeek(3, 15).toISOString(),
    endsAt: thisWeek(3, 15, 30).toISOString(), // the default length (Calendar Settings: 30 minutes)
  });
  await expect(page.getByTestId("time-grid").getByRole("button", { name: /Quarterly planning/ })).toBeVisible();
});

test("refuses to save an event that ends before it starts, and sends nothing", async ({ page }) => {
  const api = await openCalendar(page);
  await page.getByRole("button", { name: "New event" }).first().click();
  const dialog = page.getByRole("dialog", { name: "New event" });
  await dialog.getByLabel("Title").fill("Backwards");
  await dialog.locator("#ev-end-time").fill("00:05");
  await dialog.locator("#ev-start-time").fill("23:00");
  await dialog.locator("#ev-end-date").fill(await dialog.locator("#ev-start-date").inputValue());
  await dialog.locator("#ev-end-time").fill("22:00");
  await dialog.getByRole("button", { name: "Create event" }).click();
  await expect(dialog.getByText("The event must end after it starts.")).toBeVisible();
  expect(api.writes.filter((w) => w.method === "POST")).toHaveLength(0);
});

test("edits and deletes an event", async ({ page }) => {
  const api = await openCalendar(page);
  await page.getByTestId("time-grid").getByRole("button", { name: /Design critique/ }).click();
  const dialog = page.getByRole("dialog", { name: "Edit event" });
  await dialog.getByLabel("Title").fill("Design critique (moved)");
  await dialog.getByRole("button", { name: "Save changes" }).click();
  await expect(dialog).toHaveCount(0);
  expect(api.writes.find((w) => w.method === "PATCH" && w.path === "/calendar/events/e5")?.body).toMatchObject({
    title: "Design critique (moved)",
  });
  const grid = page.getByTestId("time-grid");
  await expect(grid.getByRole("button", { name: /Design critique \(moved\)/ })).toBeVisible();

  await grid.getByRole("button", { name: /Design critique \(moved\)/ }).click();
  const again = page.getByRole("dialog", { name: "Edit event" });
  await again.getByRole("button", { name: "Delete" }).click();
  await again.getByRole("button", { name: "Yes, delete" }).click();
  await expect(again).toHaveCount(0);
  expect(api.writes.some((w) => w.method === "DELETE" && w.path === "/calendar/events/e5")).toBe(true);
  await expect(grid.getByRole("button", { name: /Design critique/ })).toHaveCount(0);
});

test("hiding a calendar hides its events, and saves the choice", async ({ page }) => {
  const api = await openCalendar(page);
  const grid = page.getByTestId("time-grid");
  await expect(grid.getByRole("button", { name: /Partnership call/ })).toBeVisible();
  await page.getByTestId("my-calendars").getByText("Customer Meetings").click();
  await expect(grid.getByRole("button", { name: /Partnership call/ })).toHaveCount(0);
  await expect(grid.getByRole("button", { name: /Product standup/ })).toBeVisible();
  expect(api.writes.find((w) => w.path === "/calendar/calendars/c-cust")?.body).toEqual({ isVisible: false });
});

test("switches between day, work week, week and month, and steps through time", async ({ page }) => {
  await openCalendar(page);
  await page.getByRole("tab", { name: "Month" }).click();
  await expect(page.getByRole("region", { name: "Calendar" }).getByRole("button", { name: /Security review/ })).toBeVisible();
  await shot(page, "calendar-3-month");
  await page.getByRole("tab", { name: "Day" }).click();
  const label = page.getByTestId("range-label");
  const today = await label.textContent();
  await page.getByRole("button", { name: "Next day" }).click();
  await expect(label).not.toHaveText(today ?? "");
  await page.getByRole("button", { name: "Today", exact: true }).click();
  await expect(label).toHaveText(today ?? "");
  await page.getByRole("tab", { name: "Week" }).click();
  await expect(page.getByTestId("time-grid").getByRole("button", { name: /Product review/ })).toBeVisible();
});

test("the day panel lists the chosen day's events", async ({ page }) => {
  await openCalendar(page);
  // Pick this week's Thursday in the mini month.
  await page.getByRole("button", { name: thisWeek(3, 0).toDateString(), exact: true }).click();
  const agenda = page.getByTestId("day-agenda");
  await expect(agenda).toContainText("5 events");
  await expect(agenda.getByText("Product review")).toBeVisible();
  await expect(agenda.getByText("Conference room")).toBeVisible();
  await expect(agenda.getByText("Video meeting")).toBeVisible();
});

test("an invitation shows on the calendar, opens as an invitation, and can be answered from the card", async ({ page }) => {
  const api = await openCalendar(page);
  // The sidebar counts it.
  await expect(page.getByRole("link", { name: /Invitations & RSVP/ })).toContainText("1");
  const card = page.getByTestId("invitations-card");
  await expect(card).toContainText("Budget alignment");
  await expect(card).toContainText("Sarah Chen");
  await shot(page, "calendar-4-with-invitation");

  await card.getByRole("button", { name: "Accept" }).click();
  await expect.poll(() => api.writes.find((w) => w.path === "/calendar/events/inv1/respond")?.body).toEqual({ response: "ACCEPTED" });
  await expect(card).toContainText("No invitations waiting for your response.");

  // Clicking someone else's meeting on the grid opens it as an invitation.
  await page.getByTestId("time-grid").getByRole("button", { name: /Budget alignment/ }).click();
  await expect(page).toHaveURL(/\/mail\/calendar\/invitations\?event=inv1$/);
});

test("invites a suggested colleague and a guest when creating an event", async ({ page }) => {
  const api = await openCalendar(page);
  await page.getByRole("button", { name: "New event at 15:00" }).nth(3).click();
  const dialog = page.getByRole("dialog", { name: "New event" });
  await dialog.getByLabel("Title").fill("Planning with Sarah");
  const people = dialog.getByLabel("Invite people");
  await people.fill("sar");
  await dialog.getByRole("option", { name: /Sarah Chen/ }).click();
  await people.fill("partner@outside.example");
  await people.press("Enter");
  await expect(dialog.getByTestId("attendee-chip")).toHaveCount(2);
  await shot(page, "calendar-5-invite-people");
  await dialog.getByRole("button", { name: "Create event" }).click();
  await expect(dialog).toHaveCount(0);
  expect(api.writes.find((w) => w.method === "POST")?.body).toMatchObject({
    title: "Planning with Sarah",
    attendees: ["sarah@acme.test", "partner@outside.example"],
  });
});
