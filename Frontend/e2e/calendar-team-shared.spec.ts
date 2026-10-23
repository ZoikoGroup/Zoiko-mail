import { test, expect, type Page } from "@playwright/test";
import { json } from "./admin-harness";

/**
 * Team Calendar and Shared Calendars (Calendar step 3), against an in-memory
 * stand-in for the calendar API.
 *
 * What these protect: team and shared events appear in their calendars'
 * colours, with what the viewer may not read shown only as Busy; teammates'
 * busy time and availability come from free/busy; each show/hide choice,
 * share, request and decision sends exactly what was chosen. Set
 * E2E_SCREENSHOTS to save dark-mode screenshots.
 */

const at = (dayOffset: number, hh: number, mm = 0) => {
  const now = new Date();
  const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - ((now.getDay() + 6) % 7));
  return new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + dayOffset, hh, mm);
};
const today = (hh: number, mm = 0) => {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), hh, mm);
};

interface Cal {
  id: string;
  kind: "PERSONAL" | "TEAM";
  name: string;
  color: string;
  description: null;
  isDefault: boolean;
  isVisible: boolean;
  access: string;
  owner: { name: string; email: string } | null;
  sharedWithCount: number;
}

const cal = (id: string, kind: "PERSONAL" | "TEAM", name: string, color: string, access: string, owner: Cal["owner"], count: number): Cal => ({
  id,
  kind,
  name,
  color,
  description: null,
  isDefault: id === "c-mine",
  isVisible: true,
  access,
  owner,
  sharedWithCount: count,
});

function seedCalendars(): Cal[] {
  return [
    cal("c-mine", "PERSONAL", "Work", "blue", "OWNER", null, 1),
    cal("t-prod", "TEAM", "Product & Engineering", "blue", "EDIT", { name: "Sarah Mitchell", email: "sarah@acme.test" }, 3),
    cal("t-lead", "TEAM", "Leadership", "purple", "VIEW", { name: "David Kim", email: "david@acme.test" }, 2),
    cal("s-road", "PERSONAL", "Product Roadmap", "blue", "VIEW", { name: "Sarah Mitchell", email: "sarah@acme.test" }, 4),
    cal("s-ops", "PERSONAL", "Operations Rota", "green", "FREE_BUSY", { name: "Lena Park", email: "lena@acme.test" }, 2),
  ];
}

function event(id: string, calendarId: string, title: string, start: Date, minutes: number, extra: Record<string, unknown> = {}) {
  return {
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
    access: "VIEW",
    canEdit: false,
    redacted: false,
    organizerName: "Sarah Mitchell",
    attendeeCount: 3,
    ...extra,
  };
}

const TEAM_EVENTS = [
  event("te1", "t-prod", "Product standup", at(0, 9), 60, { source: "TEAM", canEdit: true, access: "EDIT" }),
  event("te2", "t-prod", "Cross-team planning", at(3, 11), 60, { source: "TEAM", canEdit: true, access: "EDIT", location: "Conference room" }),
  event("te3", "t-lead", "Leadership alignment", at(0, 14), 60, { source: "TEAM" }),
];
const SHARED_EVENTS = [
  event("se1", "s-road", "Roadmap kickoff", at(0, 11), 60, { source: "SHARED" }),
  event("se2", "s-road", "Feature demo", at(4, 9), 60, { source: "SHARED" }),
  event("se3", "s-ops", "Busy", at(1, 14), 60, { source: "SHARED", access: "FREE_BUSY", redacted: true, organizerName: null }),
];

const PEOPLE: Record<string, string> = {
  "sarah@acme.test": "Sarah Mitchell",
  "james@acme.test": "James Carter",
  "lena@acme.test": "Lena Park",
  "david@acme.test": "David Kim",
};

interface Api {
  calendars: Cal[];
  writes: Array<{ method: string; path: string; body: unknown }>;
  requests: { incoming: unknown[]; outgoing: unknown[] };
}

async function open(page: Page, path: "/mail/calendar/team" | "/mail/calendar/shared"): Promise<Api> {
  const api: Api = {
    calendars: seedCalendars(),
    writes: [],
    requests: {
      incoming: [
        {
          id: "rq1",
          access: "VIEW",
          message: "For sprint planning",
          status: "PENDING",
          createdAt: today(9).toISOString(),
          decidedAt: null,
          calendar: { id: "c-mine", name: "Work", ownerName: null },
          requester: { name: "James Carter", email: "james@acme.test" },
        },
      ],
      outgoing: [],
    },
  };
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
        tenant: { id: "t1", name: "Demo Workspace", planCode: "business" },
        membership: { id: "m1", role: "MEMBER" },
        workspace: "MEMBER",
      };
      if (p === "/events/stream") return route.fulfill({ status: 200, contentType: "text/event-stream", body: "" });
      if (p === "/auth/login") return route.fulfill(json({ state: "SIGNED_IN", session, ...session }));
      if (p === "/auth/me") return route.fulfill(json({ ...session.user, tenant: session.tenant, membership: session.membership, workspace: "MEMBER" }));
      if (p === "/mail/mailbox") return route.fulfill(json({ address: "michael@acme.test", storageUsed: 2.4 * 1024 ** 3, storageLimit: 10 * 1024 ** 3 }));
      if (p === "/calendar/invitations/counts") return route.fulfill(json({ awaiting: 0, updates: 0 }));
      if (p === "/calendar/calendars") return route.fulfill(json(api.calendars.filter((c) => c.access === "OWNER" && c.kind === "PERSONAL")));
      if (p === "/calendar/accessible") return route.fulfill(json(api.calendars));
      if (p === "/calendar/people") return route.fulfill(json(Object.entries(PEOPLE).map(([email, name]) => ({ email, name }))));
      if (p === "/calendar/scoped-events") {
        return route.fulfill(json(url.searchParams.get("scope") === "team" ? TEAM_EVENTS : SHARED_EVENTS));
      }
      const calMatch = p.match(/^\/calendar\/calendars\/([^/]+)$/);
      if (calMatch && method === "PATCH") {
        const c = api.calendars.find((x) => x.id === calMatch[1])!;
        Object.assign(c, body);
        return route.fulfill(json(c));
      }
      const sharesMatch = p.match(/^\/calendar\/calendars\/([^/]+)\/shares/);
      if (sharesMatch) {
        const c = api.calendars.find((x) => x.id === sharesMatch[1])!;
        if (c.access === "FREE_BUSY") {
          return route.fulfill({ status: 403, contentType: "application/json", body: JSON.stringify({ success: false, error: { code: "FORBIDDEN", message: "No" } }) });
        }
        return route.fulfill(
          json({
            calendarId: c.id,
            owner: c.owner ? { membershipId: "mo", ...c.owner } : { membershipId: "m1", name: "Michael Irvine", email: "michael@acme.test" },
            shares: [
              { id: "sh1", membershipId: "m1", name: "Michael Irvine", email: "michael@acme.test", access: c.access === "OWNER" ? "VIEW" : c.access, isMe: c.access !== "OWNER" },
              { id: "sh2", membershipId: "m2", name: "James Carter", email: "james@acme.test", access: "VIEW", isMe: false },
              { id: "sh3", membershipId: "m3", name: "Lena Park", email: "lena@acme.test", access: "EDIT", isMe: false },
            ],
          })
        );
      }
      if (p === "/calendar/freebusy") {
        const emails = (url.searchParams.get("emails") ?? "").split(",").filter(Boolean);
        const people = emails.map((email) => ({
          membershipId: email,
          name: PEOPLE[email] ?? email,
          email,
          isMe: email === "michael@acme.test",
          // James is in a meeting right now; Lena is busy later today.
          busy:
            email === "james@acme.test"
              ? [{ start: new Date(Date.now() - 30 * 60_000).toISOString(), end: new Date(Date.now() + 30 * 60_000).toISOString() }]
              : email === "lena@acme.test"
                ? [{ start: new Date(Date.now() + 2 * 3_600_000).toISOString(), end: new Date(Date.now() + 3 * 3_600_000).toISOString() }]
                : [],
        }));
        if (url.searchParams.get("includeMe") === "true") people.push({ membershipId: "m1", name: "Michael Irvine", email: "michael@acme.test", isMe: true, busy: [] });
        return route.fulfill(json(people));
      }
      if (p === "/calendar/find-time") {
        const start = at(3, 15);
        return route.fulfill(
          json({
            people: body.emails.map((e: string) => ({ membershipId: e, name: PEOPLE[e] ?? e, email: e, isMe: false })),
            slots: [{ start: start.toISOString(), end: new Date(start.getTime() + body.durationMinutes * 60_000).toISOString() }],
          })
        );
      }
      if (p === "/calendar/access-requests" && method === "GET") return route.fulfill(json(api.requests));
      if (p === "/calendar/access-requests" && method === "POST") return route.fulfill({ ...json({ id: "rq-new", calendarId: "x", status: "PENDING" }), status: 201 });
      if (/^\/calendar\/access-requests\/[^/]+\/decision$/.test(p)) {
        api.requests.incoming = [];
        return route.fulfill(json(api.requests));
      }
      if (p === "/calendar/team-calendars") return route.fulfill({ ...json({ id: "t-new", kind: "TEAM", name: body.name, color: body.color }), status: 201 });
      return route.fulfill(json([]));
    }
  );
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.goto("/login/member");
  await page.getByPlaceholder("john@example.com").fill("michael@acme.test");
  await page.getByPlaceholder("Enter your password").fill("Password123!");
  await page.getByRole("button", { name: "Sign In to Member Workspace" }).click();
  await expect(page).toHaveURL(/\/mail$/, { timeout: 60_000 });
  await page.goto(path);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible({ timeout: 60_000 });
  return api;
}

async function shot(page: Page, name: string) {
  if (process.env.E2E_SCREENSHOTS) await page.screenshot({ path: `${process.env.E2E_SCREENSHOTS}/${name}.png` });
}

test.describe("Team Calendar", () => {
  test("shows team meetings, teammates' busy time, availability and a time to meet", async ({ page }) => {
    await open(page, "/mail/calendar/team");
    await expect(page.getByRole("heading", { level: 1, name: "Team Calendar" })).toBeVisible();
    const teams = page.getByTestId("team-calendars");
    await expect(teams.getByRole("checkbox", { name: "Show Product & Engineering" })).toBeChecked();
    await expect(teams.getByRole("checkbox", { name: "Show Leadership" })).toBeChecked();

    const grid = page.getByTestId("time-grid");
    await expect(grid.getByRole("button", { name: /Product standup/ })).toBeVisible();
    await expect(grid.getByRole("button", { name: /Leadership alignment/ })).toBeVisible();
    await expect(page.getByTestId("team-count")).toContainText("3 team events");

    const availability = page.getByTestId("team-availability");
    await expect(availability).toContainText("James Carter");
    await expect(availability).toContainText("In meeting");
    await expect(availability).toContainText("Lena Park");
    await expect(page.getByTestId("find-together")).toContainText("Everyone free");
    await shot(page, "team-1-week");
  });

  test("hiding a team calendar hides its meetings and saves the choice", async ({ page }) => {
    const api = await open(page, "/mail/calendar/team");
    const grid = page.getByTestId("time-grid");
    await expect(grid.getByRole("button", { name: /Leadership alignment/ })).toBeVisible();
    await page.getByTestId("team-calendars").getByText("Leadership").click();
    await expect(grid.getByRole("button", { name: /Leadership alignment/ })).toHaveCount(0);
    expect(api.writes.find((w) => w.path === "/calendar/calendars/t-lead")?.body).toEqual({ isVisible: false });
  });

  test("selecting a meeting shows it, with edit for a calendar I can edit", async ({ page }) => {
    await open(page, "/mail/calendar/team");
    await page.getByTestId("time-grid").getByRole("button", { name: /Cross-team planning/ }).click();
    const card = page.getByTestId("selected-meeting");
    await expect(card).toContainText("Product & Engineering");
    await expect(card).toContainText("Conference room");
    await expect(card.getByRole("button", { name: /View or edit event/ })).toBeVisible();
  });

  test("Book it opens a new event with the slot, the team calendar and the people", async ({ page }) => {
    await open(page, "/mail/calendar/team");
    await page.getByTestId("find-together").getByRole("button", { name: "Book it" }).click();
    const dialog = page.getByRole("dialog", { name: "New event" });
    await expect(dialog.getByLabel("Calendar")).toHaveValue("t-prod");
    await expect(dialog.getByTestId("attendee-chip")).not.toHaveCount(0);
    await expect(dialog.locator("#ev-start-time")).toHaveValue("15:00");
  });

  test("creates a team calendar with members", async ({ page }) => {
    const api = await open(page, "/mail/calendar/team");
    await page.getByRole("button", { name: "New team calendar" }).click();
    const dialog = page.getByRole("dialog", { name: "New team calendar" });
    await dialog.getByLabel("Name").fill("Support & Operations");
    await dialog.getByLabel("Green").click();
    await dialog.getByLabel("Members").fill("lena");
    await dialog.getByRole("option", { name: /Lena Park/ }).click();
    await dialog.getByRole("button", { name: "Create team calendar" }).click();
    await expect(dialog).toHaveCount(0);
    expect(api.writes.find((w) => w.path === "/calendar/team-calendars")?.body).toEqual({
      name: "Support & Operations",
      color: "green",
      members: ["lena@acme.test"],
    });
  });

  test("the availability view lists each person's busy time", async ({ page }) => {
    await open(page, "/mail/calendar/team");
    await page.getByRole("tab", { name: "Availability" }).click();
    const grid = page.getByTestId("availability-grid");
    await expect(grid).toContainText("James Carter");
    await expect(grid).toContainText("Michael Irvine (you)");
    await shot(page, "team-2-availability");
  });
});

test.describe("Shared Calendars", () => {
  test("shows shared calendars with their access, and free/busy ones only as Busy", async ({ page }) => {
    await open(page, "/mail/calendar/shared");
    await expect(page.getByRole("heading", { level: 1, name: "Shared Calendars" })).toBeVisible();
    const list = page.getByTestId("shared-with-me");
    await expect(list).toContainText("Product Roadmap");
    await expect(list).toContainText("Details");
    await expect(list).toContainText("Operations Rota");
    await expect(list).toContainText("Busy");

    const grid = page.getByTestId("time-grid");
    await expect(grid.getByRole("button", { name: /Roadmap kickoff/ })).toBeVisible();
    await grid.getByRole("button", { name: /^Busy/ }).click();
    await expect(page.getByTestId("selected-event")).toContainText("Details hidden · Free/Busy");
    await page.getByTestId("time-grid").getByRole("button", { name: /Roadmap kickoff/ }).click();
    const selected = page.getByTestId("selected-calendar");
    await expect(selected).toContainText("Product Roadmap");
    await expect(selected).toContainText("Sarah Mitchell");
    await expect(selected).toContainText("Disabled");
    await expect(page.getByTestId("who-can-see")).toContainText("Lena Park");
    await shot(page, "shared-1-week");
  });

  test("asks a colleague for access", async ({ page }) => {
    const api = await open(page, "/mail/calendar/shared");
    await page.getByRole("button", { name: "Request access" }).first().click();
    const dialog = page.getByRole("dialog", { name: "Request access to a calendar" });
    await dialog.getByLabel("Whose calendar").fill("david");
    await dialog.getByRole("option", { name: /David Kim/ }).click();
    await dialog.getByLabel("Access you need").selectOption("VIEW");
    await dialog.getByLabel("Why (optional)").fill("Planning the offsite");
    await dialog.getByRole("button", { name: "Send request" }).click();
    await expect(dialog).toContainText("Request sent");
    expect(api.writes.find((w) => w.path === "/calendar/access-requests")?.body).toEqual({
      ownerEmail: "david@acme.test",
      access: "VIEW",
      message: "Planning the offsite",
    });
  });

  test("approves an access request", async ({ page }) => {
    const api = await open(page, "/mail/calendar/shared");
    await page.getByRole("button", { name: /Access requests/ }).click();
    const panel = page.getByTestId("access-requests");
    await expect(panel).toContainText("James Carter asks for View details on Work");
    await expect(panel).toContainText("For sprint planning");
    await shot(page, "shared-2-requests");
    await panel.getByRole("button", { name: "Approve" }).click();
    await expect.poll(() => api.writes.find((w) => w.path === "/calendar/access-requests/rq1/decision")?.body).toEqual({ approve: true });
    await expect(panel).toContainText("No requests to decide.");
  });

  test("shares one of my calendars with a colleague", async ({ page }) => {
    const api = await open(page, "/mail/calendar/shared");
    await page.getByRole("button", { name: "Share a calendar" }).click();
    const dialog = page.getByRole("dialog", { name: "Access to Work" });
    await dialog.getByLabel("Invite people", { exact: false }).or(dialog.locator("#share-people")).first().fill("james");
    await dialog.getByRole("option", { name: /James Carter/ }).click();
    await dialog.getByLabel("They can").selectOption("FREE_BUSY");
    await dialog.getByRole("button", { name: "Share", exact: true }).click();
    await expect.poll(() => api.writes.find((w) => w.method === "POST" && w.path === "/calendar/calendars/c-mine/shares")?.body).toEqual({
      email: "james@acme.test",
      access: "FREE_BUSY",
    });
  });

  test("the access matrix lists every shared calendar with its access", async ({ page }) => {
    await open(page, "/mail/calendar/shared");
    await page.getByRole("tab", { name: "Access matrix" }).click();
    const matrix = page.getByTestId("access-matrix");
    await expect(matrix.getByRole("row", { name: /Product Roadmap/ })).toContainText("Sarah Mitchell");
    await expect(matrix.getByRole("row", { name: /Operations Rota/ })).toContainText("Busy");
    await expect(matrix.getByRole("row", { name: /Work/ })).toContainText("You");
  });
});
