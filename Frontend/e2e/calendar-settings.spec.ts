import { test, expect, type Page } from "@playwright/test";
import { json } from "./admin-harness";

/**
 * Calendar Settings (Calendar step 7), against an in-memory stand-in for the API.
 *
 * What these protect: the page saves exactly what was changed (and nothing
 * when it is discarded or invalid), and saved preferences really change the
 * calendar — first day of the week, weekends, 12/24-hour time, the view it
 * opens in, descriptions, and the defaults of a new event.
 */

const DEFAULTS = {
  defaultView: "week",
  weekStart: 1,
  defaultDurationMinutes: 30,
  timeZone: null,
  locale: "en-GB",
  dateFormat: "DMY",
  timeFormat: "H24",
  showWeekends: false,
  showDescriptions: true,
  workDays: [1, 2, 3, 4, 5],
  workStart: "09:00",
  workEnd: "17:00",
  defaultVisibility: "DEFAULT",
  defaultShowAs: "BUSY",
  allowAccessRequests: true,
  showPendingInvitations: true,
  notifyInvitations: true,
  notifyResponses: true,
  notifyUpdates: true,
  notifyBookings: true,
  notifySharing: true,
  notifyTemplates: true,
  saved: false,
  updatedAt: null,
};

/** Today at hh:mm, local time. */
function today(hh: number, mm = 0): Date {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), hh, mm);
}

interface Api {
  prefs: Record<string, unknown>;
  writes: Array<{ method: string; path: string; body: unknown }>;
}

async function signedIn(page: Page, prefs: Record<string, unknown> = {}, path = "/mail/calendar/settings"): Promise<Api> {
  const api: Api = { prefs: { ...DEFAULTS, ...prefs }, writes: [] };
  const event = {
    id: "e1",
    calendarId: "c-work",
    title: "Quarterly planning",
    description: "Agree the Q1 goals",
    location: null,
    videoLink: null,
    startsAt: today(10).toISOString(),
    endsAt: today(11).toISOString(),
    allDay: false,
    timeZone: "Europe/London",
    visibility: "DEFAULT",
    showAs: "BUSY",
    createdAt: "",
    updatedAt: "",
    source: "OWN",
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
        tenant: { id: "t1", name: "Acme Workspace", planCode: "business" },
        membership: { id: "m1", role: "MEMBER" },
        workspace: "MEMBER",
      };
      if (p === "/events/stream") return route.fulfill({ status: 200, contentType: "text/event-stream", body: "" });
      if (p === "/auth/login") return route.fulfill(json({ state: "SIGNED_IN", session, ...session }));
      if (p === "/auth/me") return route.fulfill(json({ ...session.user, tenant: session.tenant, membership: session.membership, workspace: "MEMBER" }));
      if (p === "/mail/mailbox") return route.fulfill(json({ address: "michael@acme.test", storageUsed: 2.4 * 1024 ** 3, storageLimit: 10 * 1024 ** 3 }));
      if (p === "/calendar/invitations/counts") return route.fulfill(json({ awaiting: 0, updates: 0 }));
      if (p === "/calendar/preferences" && method === "GET") return route.fulfill(json(api.prefs));
      if (p === "/calendar/preferences" && method === "PATCH") {
        Object.assign(api.prefs, body, { saved: true, updatedAt: new Date().toISOString() });
        return route.fulfill(json(api.prefs));
      }
      if (p === "/calendar/calendars")
        return route.fulfill(json([{ id: "c-work", kind: "PERSONAL", name: "Work", color: "blue", description: null, isDefault: true, isVisible: true, createdAt: "", updatedAt: "" }]));
      if (p === "/calendar/accessible")
        return route.fulfill(json([{ id: "c-work", kind: "PERSONAL", name: "Work", color: "blue", description: null, isDefault: true, isVisible: true, access: "OWNER", owner: null, sharedWithCount: 2 }]));
      if (p === "/calendar/events") return route.fulfill(json([event]));
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
  return api;
}

async function openSettings(page: Page, prefs: Record<string, unknown> = {}) {
  const api = await signedIn(page, prefs);
  await expect(page.getByRole("heading", { level: 1, name: "Calendar Settings & Preferences" })).toBeVisible({ timeout: 60_000 });
  return api;
}

async function shot(page: Page, name: string) {
  if (process.env.E2E_SCREENSHOTS) await page.screenshot({ path: `${process.env.E2E_SCREENSHOTS}/${name}.png` });
}

const panel = (page: Page) => page.getByTestId("settings-panel");
const patches = (api: Api) => api.writes.filter((w) => w.method === "PATCH" && w.path === "/calendar/preferences");

test.describe("the settings page", () => {
  test("shows the current preferences and saves exactly what changed", async ({ page }) => {
    const api = await openSettings(page);
    const p = panel(page);
    await expect(p.getByRole("radio", { name: "Week" })).toHaveAttribute("aria-checked", "true");
    await expect(page.getByTestId("save-state")).toContainText("Saved to your account");
    await shot(page, "settings-1-general");

    await p.getByRole("radio", { name: "Month" }).click();
    await p.getByLabel("Start of week").selectOption("0");
    await p.getByLabel("Default event duration").selectOption("45");
    await p.getByLabel("Time zone").selectOption("Europe/London");
    await p.getByLabel("Time format").selectOption("H12");
    await p.getByRole("switch", { name: "Show weekends" }).click();
    await expect(page.getByTestId("save-state")).toContainText("6 unsaved changes");
    await page.getByRole("button", { name: "Save changes" }).click();
    await expect.poll(() => patches(api)[0]?.body).toEqual({
      defaultView: "month",
      weekStart: 0,
      defaultDurationMinutes: 45,
      timeZone: "Europe/London",
      timeFormat: "H12",
      showWeekends: true,
    });
    await expect(page.getByTestId("save-state")).toContainText("Preferences saved");
  });

  test("the preview follows unsaved choices", async ({ page }) => {
    await openSettings(page);
    const preview = page.getByTestId("settings-preview");
    await expect(preview.getByTestId("preview-day")).toHaveCount(5);
    await expect(preview.getByTestId("preview-hour").first()).toHaveText("09:00");
    await panel(page).getByRole("switch", { name: "Show weekends" }).click();
    await panel(page).getByLabel("Time format").selectOption("H12");
    await expect(preview.getByTestId("preview-day")).toHaveCount(7);
    await expect(preview.getByTestId("preview-hour").first()).toHaveText("9:00 AM");
    await expect(preview).toContainText("Quarterly planning");
  });

  test("discarding puts everything back without saving", async ({ page }) => {
    const api = await openSettings(page);
    await panel(page).getByRole("radio", { name: "Agenda" }).click();
    await page.getByRole("button", { name: "Discard" }).click();
    await expect(panel(page).getByRole("radio", { name: "Week" })).toHaveAttribute("aria-checked", "true");
    await expect(page.getByRole("button", { name: "Save changes" })).toBeDisabled();
    expect(patches(api)).toHaveLength(0);
  });

  test("refuses working hours that end before they start", async ({ page }) => {
    const api = await openSettings(page);
    await page.getByRole("navigation", { name: "Settings sections" }).getByRole("button", { name: "Working hours" }).click();
    await expect(page).toHaveURL(/section=hours/);
    await panel(page).getByLabel("Day ends").fill("08:00");
    await expect(page.getByTestId("save-state")).toContainText("Working hours must end after they start.");
    await expect(page.getByRole("button", { name: "Save changes" })).toBeDisabled();
    await panel(page).getByLabel("Day ends").fill("18:30");
    await panel(page).getByRole("button", { name: "Sat" }).click();
    await page.getByRole("button", { name: "Save changes" }).click();
    await expect.poll(() => patches(api)[0]?.body).toEqual({ workEnd: "18:30", workDays: [1, 2, 3, 4, 5, 6] });
  });

  test("turns notification groups and access requests off", async ({ page }) => {
    const api = await openSettings(page);
    const nav = page.getByRole("navigation", { name: "Settings sections" });
    await nav.getByRole("button", { name: "Notifications" }).click();
    await panel(page).getByRole("switch", { name: "New invitations" }).click();
    await panel(page).getByRole("switch", { name: "Rooms and bookings" }).click();
    await nav.getByRole("button", { name: "Sharing & access" }).click();
    await panel(page).getByRole("switch", { name: "Let colleagues ask for access" }).click();
    await expect(page.getByTestId("my-calendar-shares")).toContainText("Shared with 2");
    await shot(page, "settings-2-sharing");
    await page.getByRole("button", { name: "Save changes" }).click();
    await expect.poll(() => patches(api)[0]?.body).toEqual({ notifyInvitations: false, notifyBookings: false, allowAccessRequests: false });
  });
});

test.describe("saved preferences change the calendar", () => {
  test("opens in the chosen view, with the chosen first day and time format", async ({ page }) => {
    await signedIn(page, { defaultView: "month", weekStart: 0, timeFormat: "H12", showWeekends: true }, "/mail/calendar");
    await expect(page.getByRole("tab", { name: "Month" })).toHaveAttribute("aria-selected", "true", { timeout: 60_000 });
    const calendar = page.getByRole("region", { name: "Calendar" });
    await expect(calendar.getByText("Sun", { exact: true })).toBeVisible();
    await page.getByRole("tab", { name: "Week" }).click();
    await expect(page.getByTestId("time-grid")).toContainText("9:00 AM");
    await expect(page.getByTestId("time-grid").getByRole("button", { name: /Quarterly planning/ })).toBeVisible();
  });

  test("the agenda view shows descriptions only when chosen", async ({ page }) => {
    await signedIn(page, { defaultView: "agenda" }, "/mail/calendar");
    const agenda = page.getByTestId("agenda-list");
    await expect(agenda).toContainText("Quarterly planning", { timeout: 60_000 });
    await expect(agenda).toContainText("Agree the Q1 goals");
    await shot(page, "settings-3-agenda");
  });

  test("hides descriptions when turned off", async ({ page }) => {
    await signedIn(page, { defaultView: "agenda", showDescriptions: false }, "/mail/calendar");
    const agenda = page.getByTestId("agenda-list");
    await expect(agenda).toContainText("Quarterly planning", { timeout: 60_000 });
    await expect(agenda).not.toContainText("Agree the Q1 goals");
  });

  test("a new event starts from the chosen length, privacy and busy/free", async ({ page }) => {
    await signedIn(page, { defaultDurationMinutes: 45, defaultVisibility: "PRIVATE", defaultShowAs: "FREE" }, "/mail/calendar");
    await page.getByRole("button", { name: "New event" }).first().click();
    const dialog = page.getByRole("dialog");
    const start = await dialog.getByLabel("Time").first().inputValue();
    const end = await dialog.getByLabel("Time").nth(1).inputValue();
    const minutes = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3));
    expect((minutes(end) - minutes(start) + 1440) % 1440).toBe(45);
    await expect(dialog.getByLabel("Private")).toBeChecked();
    await expect(dialog.getByRole("radio", { name: "Free" })).toHaveAttribute("aria-checked", "true");
  });
});
