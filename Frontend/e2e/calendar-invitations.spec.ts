import { test, expect, type Page } from "@playwright/test";
import { json } from "./admin-harness";

/**
 * Invitations & RSVP (Calendar step 2), against an in-memory stand-in for the
 * calendar API that keeps answers, proposals and "seen" state the way the
 * server does.
 *
 * What these protect: each tab lists what the server returns; opening an
 * invitation marks it seen; Accept / Tentative / Decline / Propose send what
 * was chosen; the schedule check reports real overlaps with my calendar; the
 * organizer sees replies and can take a proposed time. Set E2E_SCREENSHOTS to
 * a folder to save dark-mode screenshots.
 */

const at = (dayOffset: number, hh: number, mm = 0) => {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + dayOffset, hh, mm);
};

type Response = "NEEDS_ACTION" | "ACCEPTED" | "TENTATIVE" | "DECLINED";

interface Attendee {
  id: string;
  email: string;
  name: string;
  isMember: boolean;
  isMe: boolean;
  response: Response;
  respondedAt: string | null;
  comment: string | null;
  proposedStartsAt: string | null;
  proposedEndsAt: string | null;
}

interface StubInvite {
  id: string;
  title: string;
  description: string;
  location: string | null;
  videoLink: string | null;
  start: Date;
  end: Date;
  organizer: { name: string; email: string };
  isOrganizer: boolean;
  seen: boolean;
  attendees: Attendee[];
}

function attendee(id: string, name: string, response: Response, isMe = false): Attendee {
  return {
    id,
    email: `${name.split(" ")[0]!.toLowerCase()}@acme.test`,
    name,
    isMember: true,
    isMe,
    response,
    respondedAt: null,
    comment: null,
    proposedStartsAt: null,
    proposedEndsAt: null,
  };
}

function seed(): StubInvite[] {
  return [
    {
      id: "inv-strategy",
      title: "Product strategy review",
      description: "1. Objectives and progress — 15 min\n2. Risks and dependencies — 15 min\n3. Decisions and owners — 20 min",
      location: "Horizon Room · London HQ",
      videoLink: "https://meet.example.com/strategy",
      start: at(1, 10),
      end: at(1, 11),
      organizer: { name: "Sarah Chen", email: "sarah@acme.test" },
      isOrganizer: false,
      seen: false,
      attendees: [
        attendee("a1", "Michael Irvine", "NEEDS_ACTION", true),
        attendee("a2", "James Carter", "ACCEPTED"),
        attendee("a3", "Emma Roberts", "TENTATIVE"),
        attendee("a4", "Lena Park", "ACCEPTED"),
      ],
    },
    {
      id: "inv-design",
      title: "Design review",
      description: "",
      location: null,
      videoLink: null,
      start: at(4, 13, 30),
      end: at(4, 14),
      organizer: { name: "Lena Park", email: "lena@acme.test" },
      isOrganizer: false,
      seen: true,
      attendees: [attendee("b1", "Michael Irvine", "NEEDS_ACTION", true)],
    },
    {
      id: "sent-retro",
      title: "Product team retrospective",
      description: "What went well, what did not.",
      location: "Cedar Room",
      videoLink: null,
      start: at(6, 16),
      end: at(6, 17),
      organizer: { name: "Michael Irvine", email: "michael@acme.test" },
      isOrganizer: true,
      seen: true,
      attendees: [
        { ...attendee("c1", "Alex Morgan", "TENTATIVE"), comment: "Clash at 16:00", proposedStartsAt: at(6, 15).toISOString(), proposedEndsAt: at(6, 16).toISOString() },
        attendee("c2", "Sarah Chen", "ACCEPTED"),
      ],
    },
  ];
}

const mine = (inv: StubInvite) => inv.attendees.find((a) => a.isMe) ?? null;
const tally = (inv: StubInvite) => ({
  accepted: inv.attendees.filter((a) => a.response === "ACCEPTED").length,
  tentative: inv.attendees.filter((a) => a.response === "TENTATIVE").length,
  declined: inv.attendees.filter((a) => a.response === "DECLINED").length,
  needsAction: inv.attendees.filter((a) => a.response === "NEEDS_ACTION").length,
});

function item(inv: StubInvite) {
  return {
    eventId: inv.id,
    title: inv.title,
    startsAt: inv.start.toISOString(),
    endsAt: inv.end.toISOString(),
    allDay: false,
    timeZone: "Europe/London",
    location: inv.location,
    videoLink: inv.videoLink,
    organizer: inv.organizer,
    attendeeCount: inv.attendees.length,
    myResponse: inv.isOrganizer ? null : mine(inv)!.response,
    isNew: !inv.isOrganizer && !inv.seen,
    hasUpdate: false,
    receivedAt: at(-1, 9, 42).toISOString(),
    responses: tally(inv),
  };
}

function detail(inv: StubInvite) {
  return {
    id: inv.id,
    calendarId: inv.isOrganizer ? "c-work" : null,
    calendarName: inv.isOrganizer ? "Work" : null,
    calendarColor: inv.isOrganizer ? "blue" : null,
    title: inv.title,
    description: inv.description || null,
    location: inv.location,
    videoLink: inv.videoLink,
    startsAt: inv.start.toISOString(),
    endsAt: inv.end.toISOString(),
    allDay: false,
    timeZone: "Europe/London",
    visibility: "DEFAULT",
    showAs: "BUSY",
    sequence: 0,
    isOrganizer: inv.isOrganizer,
    organizer: { membershipId: "m-org", ...inv.organizer },
    myResponse: inv.isOrganizer ? null : mine(inv)!.response,
    myComment: null,
    receivedAt: inv.isOrganizer ? null : at(-1, 9, 42).toISOString(),
    hasUpdate: false,
    isNew: !inv.isOrganizer && !inv.seen,
    counts: tally(inv),
    attendees: inv.attendees,
    history: [
      { id: `${inv.id}-h1`, type: "INVITED", detail: { emails: inv.attendees.map((a) => a.email) }, actorName: inv.organizer.name, createdAt: at(-1, 9, 42).toISOString() },
    ],
    createdAt: at(-1, 9).toISOString(),
    updatedAt: at(-1, 9).toISOString(),
  };
}

interface Api {
  invites: StubInvite[];
  writes: Array<{ method: string; path: string; body: unknown }>;
}

async function openInvitations(page: Page, { busyAt, extra = [] }: { busyAt?: [Date, Date]; extra?: StubInvite[] } = {}): Promise<Api> {
  const api: Api = { invites: [...seed(), ...extra], writes: [] };
  await page.addInitScript(() => window.localStorage.setItem("theme", "dark"));
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
        tenant: { id: "t1", name: "Acme Workspace", planCode: "business" },
        membership: { id: "m1", role: "MEMBER" },
        workspace: "MEMBER",
      };
      if (path === "/events/stream") return route.fulfill({ status: 200, contentType: "text/event-stream", body: "" });
      if (path === "/auth/login") return route.fulfill(json({ state: "SIGNED_IN", session, ...session }));
      if (path === "/auth/me")
        return route.fulfill(json({ ...session.user, tenant: session.tenant, membership: session.membership, workspace: "MEMBER" }));
      if (path === "/mail/mailbox")
        return route.fulfill(json({ address: "michael@acme.test", storageUsed: 2.4 * 1024 ** 3, storageLimit: 10 * 1024 ** 3 }));
      if (path === "/calendar/calendars")
        return route.fulfill(json([{ id: "c-work", kind: "PERSONAL", name: "Work", color: "blue", description: null, isDefault: true, isVisible: true, createdAt: "", updatedAt: "" }]));
      if (path === "/calendar/invitations/counts") {
        const awaiting = api.invites.filter((i) => !i.isOrganizer && mine(i)!.response === "NEEDS_ACTION").length;
        return route.fulfill(json({ awaiting, updates: 0 }));
      }
      if (path === "/calendar/invitations") {
        const tab = url.searchParams.get("tab");
        const q = (url.searchParams.get("q") ?? "").toLowerCase();
        const list = api.invites
          .filter((i) => (tab === "sent" ? i.isOrganizer : !i.isOrganizer))
          .filter((i) => (tab === "awaiting" ? mine(i)!.response === "NEEDS_ACTION" : tab === "accepted" ? mine(i)!.response === "ACCEPTED" : true))
          .filter((i) => !q || i.title.toLowerCase().includes(q));
        return route.fulfill(json(list.map(item)));
      }
      if (path === "/calendar/events" && method === "GET") {
        // My calendar: only the overlapping busy event the test asked for.
        const from = new Date(url.searchParams.get("from")!);
        const to = new Date(url.searchParams.get("to")!);
        const events =
          busyAt && busyAt[0] < to && busyAt[1] > from
            ? [{ id: "own-1", calendarId: "c-work", title: "Customer escalation", description: null, location: null, videoLink: null, startsAt: busyAt[0].toISOString(), endsAt: busyAt[1].toISOString(), allDay: false, timeZone: "UTC", visibility: "DEFAULT", showAs: "BUSY", createdAt: "", updatedAt: "", source: "OWN" }]
            : [];
        return route.fulfill(json(events));
      }
      const m = path.match(/^\/calendar\/events\/([^/]+)(?:\/(details|seen|respond|propose))?$/);
      if (m) {
        const inv = api.invites.find((i) => i.id === m[1]);
        if (!inv) return route.fulfill({ status: 404, contentType: "application/json", body: JSON.stringify({ success: false, error: { code: "NOT_FOUND", message: "Event not found" } }) });
        const action = m[2];
        if (action === "details") return route.fulfill(json(detail(inv)));
        const body = method === "GET" || method === "DELETE" ? null : request.postDataJSON();
        api.writes.push({ method, path, body });
        if (action === "seen") {
          inv.seen = true;
          return route.fulfill({ status: 204, body: "" });
        }
        if (action === "respond") {
          mine(inv)!.response = body.response;
          inv.seen = true;
          return route.fulfill(json(detail(inv)));
        }
        if (action === "propose") {
          const me = mine(inv)!;
          me.proposedStartsAt = body.startsAt;
          me.proposedEndsAt = body.endsAt;
          if (me.response === "NEEDS_ACTION") me.response = "TENTATIVE";
          return route.fulfill(json(detail(inv)));
        }
        if (method === "PATCH") {
          if (body.startsAt) inv.start = new Date(body.startsAt);
          if (body.endsAt) inv.end = new Date(body.endsAt);
          return route.fulfill(json({ ...detail(inv), attendees: [] }));
        }
        if (method === "GET") return route.fulfill(json({ ...detail(inv), attendees: [] }));
      }
      return route.fulfill(json([]));
    }
  );
  await page.setViewportSize({ width: 1700, height: 950 });
  await page.goto("/login/member");
  await page.getByPlaceholder("john@example.com").fill("michael@acme.test");
  await page.getByPlaceholder("Enter your password").fill("Password123!");
  await page.getByRole("button", { name: "Sign In to Member Workspace" }).click();
  await expect(page).toHaveURL(/\/mail$/, { timeout: 60_000 });
  await page.goto("/mail/calendar/invitations");
  await expect(page.getByRole("heading", { level: 1, name: "Invitations & RSVP Management" })).toBeVisible({ timeout: 60_000 });
  return api;
}

async function shot(page: Page, name: string) {
  if (process.env.E2E_SCREENSHOTS) await page.screenshot({ path: `${process.env.E2E_SCREENSHOTS}/${name}.png` });
}

test("lists what awaits my answer, opens the first, and marks it seen", async ({ page }) => {
  const api = await openInvitations(page);
  await expect(page.getByRole("tab", { name: /Awaiting Your Response/ })).toContainText("2");
  const list = page.getByTestId("invitation-list");
  await expect(list.getByRole("button", { name: /Product strategy review/ })).toContainText("Needs RSVP");
  await expect(list.getByRole("button", { name: /Product strategy review/ })).toContainText("From Sarah Chen · 4 invitees");
  await expect(list.getByRole("button", { name: /Design review/ })).toBeVisible();

  await expect(page.getByTestId("invitation-title")).toHaveText("Product strategy review");
  await expect(page.getByText("Response requested")).toBeVisible();
  await expect(page.getByText("2. Risks and dependencies — 15 min")).toBeVisible();
  const responses = page.getByTestId("attendee-responses");
  await expect(responses).toContainText("4 invited participants · your RSVP pending");
  await expect(responses).toContainText("James Carter");
  await expect.poll(() => api.writes.some((w) => w.path === "/calendar/events/inv-strategy/seen")).toBe(true);
  await shot(page, "invitations-1-awaiting");
});

test("accepting sends the answer, and the invitation leaves the awaiting list", async ({ page }) => {
  const api = await openInvitations(page);
  await page.getByRole("group", { name: "Your answer" }).getByRole("button", { name: "Accept" }).click();
  await expect.poll(() => api.writes.find((w) => w.path === "/calendar/events/inv-strategy/respond")?.body).toEqual({ response: "ACCEPTED" });
  await expect(page.getByTestId("invitation-list").getByRole("button", { name: /Product strategy review/ })).toHaveCount(0);
  await expect(page.getByRole("tab", { name: /Awaiting Your Response/ })).toContainText("1");

  await page.getByRole("tab", { name: "Accepted" }).click();
  await expect(page.getByTestId("invitation-list").getByRole("button", { name: /Product strategy review/ })).toContainText("Accepted");
});

test("tentative and decline send their answers too", async ({ page }) => {
  const api = await openInvitations(page);
  const answer = page.getByRole("group", { name: "Your answer" });
  await answer.getByRole("button", { name: "Tentative" }).click();
  await expect.poll(() => api.writes.filter((w) => w.path.endsWith("/respond")).map((w) => w.body)).toEqual([{ response: "TENTATIVE" }]);
  await page.getByRole("tab", { name: "All Invitations" }).click();
  await page.getByTestId("invitation-list").getByRole("button", { name: /Design review/ }).click();
  await expect(page.getByTestId("invitation-title")).toHaveText("Design review");
  await page.getByRole("group", { name: "Your answer" }).getByRole("button", { name: "Decline" }).click();
  await expect.poll(() => api.writes.find((w) => w.path === "/calendar/events/inv-design/respond")?.body).toEqual({ response: "DECLINED" });
});

test("proposing a new time sends the chosen slot", async ({ page }) => {
  const api = await openInvitations(page);
  await page.getByRole("button", { name: "Propose new time" }).click();
  const dialog = page.getByRole("dialog", { name: "Propose a new time" });
  await dialog.getByLabel("From").fill("14:00");
  await dialog.getByLabel("To").fill("15:00");
  await dialog.getByLabel("Note (optional)").fill("I have a clash at 10:00");
  await shot(page, "invitations-2-propose");
  await dialog.getByRole("button", { name: "Send proposal" }).click();
  await expect(dialog).toHaveCount(0);
  expect(api.writes.find((w) => w.path === "/calendar/events/inv-strategy/propose")?.body).toEqual({
    startsAt: at(1, 14).toISOString(),
    endsAt: at(1, 15).toISOString(),
    comment: "I have a clash at 10:00",
  });
});

test("the schedule check reports an overlap with my own calendar", async ({ page }) => {
  await openInvitations(page, { busyAt: [at(1, 10, 30), at(1, 11, 30)] });
  const check = page.getByTestId("schedule-check");
  await expect(check).toContainText("Overlaps 1 event");
  await expect(check).toContainText("Customer escalation");
});

test("with nothing else that day, the schedule check is clear", async ({ page }) => {
  await openInvitations(page);
  await expect(page.getByTestId("schedule-check")).toContainText("No conflicts with your calendar at this time.");
});

test("as organizer: Sent by Me shows replies, and a proposed time can be taken", async ({ page }) => {
  const api = await openInvitations(page);
  await page.getByRole("tab", { name: "Sent by Me" }).click();
  const row = page.getByTestId("invitation-list").getByRole("button", { name: /Product team retrospective/ });
  await expect(row).toContainText("2/2 replied");
  await row.click();
  await expect(page.getByRole("button", { name: "Edit meeting" })).toBeVisible();
  await expect(page.getByRole("group", { name: "Your answer" })).toHaveCount(0);

  await page.getByRole("tab", { name: "Attendees (2)" }).click();
  const attendees = page.getByTestId("attendee-list");
  await expect(attendees).toContainText("Clash at 16:00");
  await shot(page, "invitations-3-organizer");
  await attendees.getByRole("button", { name: "Use this time" }).click();
  await expect.poll(() => api.writes.find((w) => w.method === "PATCH" && w.path === "/calendar/events/sent-retro")?.body).toEqual({
    startsAt: at(6, 15).toISOString(),
    endsAt: at(6, 16).toISOString(),
  });
});

test("an invitation link opens that invitation", async ({ page }) => {
  await openInvitations(page);
  await page.goto("/mail/calendar/invitations?event=inv-design");
  await expect(page.getByTestId("invitation-title")).toHaveText("Design review", { timeout: 30_000 });
});

test("a meeting that has ended can no longer be answered", async ({ page }) => {
  const threeDaysAgo = new Date(Date.now() - 3 * 86_400_000);
  const ended: StubInvite = {
    id: "inv-ended",
    title: "Project meeting",
    description: "Discuss the project",
    location: null,
    videoLink: null,
    start: threeDaysAgo,
    end: new Date(threeDaysAgo.getTime() + 3_600_000),
    organizer: { name: "Sarah Chen", email: "sarah@acme.test" },
    isOrganizer: false,
    seen: true,
    attendees: [attendee("d1", "Michael Irvine", "ACCEPTED", true), attendee("d2", "Sarah Chen", "ACCEPTED")],
  };
  const api = await openInvitations(page, { extra: [ended] });
  await page.goto("/mail/calendar/invitations?event=inv-ended");
  await expect(page.getByTestId("invitation-title")).toHaveText("Project meeting", { timeout: 30_000 });
  await expect(page.getByTestId("ended-note")).toContainText("This meeting has ended, so it can no longer be answered. You answered Accepted.");
  const answers = page.getByRole("group", { name: "Your answer" });
  for (const name of ["Accept", "Tentative", "Decline"]) await expect(answers.getByRole("button", { name })).toBeDisabled();
  await expect(answers.getByRole("button", { name: /Propose new time/ })).toBeDisabled();
  expect(api.writes.some((w) => w.path.endsWith("/respond"))).toBe(false);
});

test("a meeting still to come can be re-answered until it ends", async ({ page }) => {
  const api = await openInvitations(page);
  // Opened by its link, it stays selected after it leaves the awaiting list.
  await page.goto("/mail/calendar/invitations?event=inv-strategy");
  await expect(page.getByTestId("invitation-title")).toHaveText("Product strategy review", { timeout: 30_000 });
  const answers = page.getByRole("group", { name: "Your answer" });
  await answers.getByRole("button", { name: "Accept" }).click();
  await expect(page.getByText("You can change your answer until the meeting ends.")).toBeVisible();
  await answers.getByRole("button", { name: "Decline" }).click();
  await expect.poll(() => api.writes.filter((w) => w.path === "/calendar/events/inv-strategy/respond").map((w) => (w.body as { response: string }).response)).toEqual(["ACCEPTED", "DECLINED"]);
});
