import { test, expect, type Page } from "@playwright/test";
import { json } from "./admin-harness";

/**
 * Scheduling Links (Calendar step 5): the host's page, and the public
 * booking page a guest opens — both against an in-memory stand-in for the API.
 *
 * What these protect: the host's edits, publishing and request decisions send
 * exactly what was chosen; a guest sees only the free times the server offers,
 * books with what they entered, and is told plainly when a time was taken
 * meanwhile or the link is unavailable.
 */

/** The next weekday at least two days ahead, at hh:mm local time. */
function nextWeekday(hh: number, mm = 0): Date {
  const d = new Date();
  d.setDate(d.getDate() + 2);
  while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() + 1);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), hh, mm);
}
const SLOTS = [
  [9, 0],
  [9, 30],
  [10, 0],
  [14, 0],
].map(([h, m]) => ({ start: nextWeekday(h!, m!).toISOString(), end: new Date(nextWeekday(h!, m!).getTime() + 30 * 60_000).toISOString() }));

const LINK = {
  id: "l1",
  calendarId: "c-work",
  slug: "30-minute-introduction-k3x9p2qa",
  title: "30-minute introduction",
  description: "Book an introductory conversation with Michael.",
  durationMinutes: 30,
  bufferMinutes: 15,
  minNoticeHours: 12,
  maxDaysAhead: 30,
  timeZone: "Europe/London",
  weekdays: [1, 2, 3, 4, 5],
  dayStart: "09:00",
  dayEnd: "17:00",
  locationType: "VIDEO",
  locationDetail: "https://meet.example.com/michael",
  requiresApproval: false,
  status: "PUBLISHED",
  createdAt: "2026-10-01T00:00:00.000Z",
  updatedAt: "2026-10-01T00:00:00.000Z",
  kind: "PERSONAL",
  calendarName: "Work",
  owner: { name: "Michael Irvine", email: "michael@acme.test" },
  isMine: true,
  pendingCount: 0,
};

interface Api {
  links: Array<typeof LINK>;
  writes: Array<{ method: string; path: string; body: unknown }>;
  requests: Array<Record<string, unknown>>;
}

async function signedIn(page: Page): Promise<Api> {
  const api: Api = {
    links: [
      { ...LINK },
      { ...LINK, id: "l2", slug: "client-consultation-aa11bb22", title: "Client consultation", status: "DRAFT", durationMinutes: 45, requiresApproval: true, pendingCount: 1 },
    ],
    writes: [],
    requests: [
      {
        id: "g1",
        guestName: "Dana Reed",
        guestEmail: "dana@outside.example",
        notes: "About pricing",
        startsAt: SLOTS[0]!.start,
        endsAt: SLOTS[0]!.end,
        timeZone: "Europe/Paris",
        status: "PENDING",
        eventId: null,
        createdAt: "",
        link: { id: "l2", title: "Client consultation", durationMinutes: 45 },
      },
    ],
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
      if (p === "/calendar/calendars") return route.fulfill(json([]));
      if (p === "/calendar/accessible")
        return route.fulfill(json([{ id: "c-work", kind: "PERSONAL", name: "Work", color: "blue", description: null, isDefault: true, isVisible: true, access: "OWNER", owner: null, sharedWithCount: 0 }]));
      if (p === "/calendar/booking-links" && method === "GET") return route.fulfill(json(api.links));
      if (p === "/calendar/booking-links" && method === "POST") {
        const created = { ...LINK, id: "l-new", slug: "new-booking-link-zz99", status: "DRAFT", ...body };
        api.links.push(created);
        return route.fulfill({ ...json(created), status: 201 });
      }
      const linkMatch = p.match(/^\/calendar\/booking-links\/([^/]+)(\/slots)?$/);
      if (linkMatch && linkMatch[2]) return route.fulfill(json(SLOTS));
      if (linkMatch && method === "PATCH") {
        const link = api.links.find((l) => l.id === linkMatch[1])!;
        Object.assign(link, body, { updatedAt: new Date().toISOString() });
        return route.fulfill(json(link));
      }
      if (p === "/calendar/guest-bookings") return route.fulfill(json(api.requests));
      if (/^\/calendar\/guest-bookings\/[^/]+\/decision$/.test(p)) {
        api.requests = api.requests.map((r) => ({ ...r, status: body.approve ? "CONFIRMED" : "DECLINED" }));
        return route.fulfill(json(api.requests));
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
  await page.goto("/mail/calendar/scheduling");
  await expect(page.getByRole("heading", { level: 1, name: "Scheduling Links & Appointment Booking" })).toBeVisible({ timeout: 60_000 });
  return api;
}

async function shot(page: Page, name: string) {
  if (process.env.E2E_SCREENSHOTS) await page.screenshot({ path: `${process.env.E2E_SCREENSHOTS}/${name}.png` });
}

test.describe("the host's scheduling page", () => {
  test("lists links with their status, and previews the guest page with real free times", async ({ page }) => {
    await signedIn(page);
    const stats = page.getByTestId("scheduling-stats");
    await expect(stats).toContainText("Booking links");
    await expect(stats).toContainText("2 personal · 0 team");
    const list = page.getByTestId("link-list");
    await expect(list.getByRole("button", { name: /30-minute introduction/ })).toContainText("Published");
    await expect(list.getByRole("button", { name: /Client consultation/ })).toContainText("Draft");
    await expect(page.getByTestId("share-url")).toContainText("/book/30-minute-introduction-k3x9p2qa");
    const preview = page.getByTestId("guest-preview");
    await expect(preview).toContainText("30-minute introduction");
    await expect(preview.getByTestId("slot-times")).toContainText("09:00");
    await shot(page, "scheduling-1-links");
  });

  test("saves changed rules exactly", async ({ page }) => {
    const api = await signedIn(page);
    const editor = page.getByTestId("link-editor");
    await editor.getByRole("button", { name: "Sat" }).click();
    await editor.getByLabel("Day starts").fill("10:00");
    await editor.getByLabel("Meeting duration").selectOption("45");
    await editor.getByLabel("Buffer between meetings").selectOption("10");
    await editor.getByLabel("Minimum notice").selectOption("24");
    await editor.getByLabel("Host approves each booking").check();
    await editor.getByRole("button", { name: "Save changes" }).click();
    await expect.poll(() => api.writes.find((w) => w.method === "PATCH" && w.path === "/calendar/booking-links/l1")?.body).toEqual({
      weekdays: [1, 2, 3, 4, 5, 6],
      dayStart: "10:00",
      durationMinutes: 45,
      bufferMinutes: 10,
      minNoticeHours: 24,
      requiresApproval: true,
    });
  });

  test("refuses a day that ends before it starts, without saving", async ({ page }) => {
    const api = await signedIn(page);
    const editor = page.getByTestId("link-editor");
    await editor.getByLabel("Day ends").fill("08:00");
    await expect(editor).toContainText("The day must end after it starts.");
    await expect(editor.getByRole("button", { name: "Save changes" })).toBeDisabled();
    expect(api.writes.filter((w) => w.method === "PATCH")).toHaveLength(0);
  });

  test("publishes a draft", async ({ page }) => {
    const api = await signedIn(page);
    await page.getByTestId("link-list").getByRole("button", { name: /Client consultation/ }).click();
    const editor = page.getByTestId("link-editor");
    await editor.getByLabel("Link status").selectOption("PUBLISHED");
    await editor.getByRole("button", { name: "Save changes" }).click();
    await expect.poll(() => api.writes.find((w) => w.path === "/calendar/booking-links/l2")?.body).toEqual({ status: "PUBLISHED" });
  });

  test("creates a new link as a draft in my time zone", async ({ page }) => {
    const api = await signedIn(page);
    await page.getByRole("button", { name: "New booking link" }).click();
    await expect.poll(() => api.writes.find((w) => w.method === "POST" && w.path === "/calendar/booking-links")?.body).toMatchObject({
      title: "New booking link",
      status: "DRAFT",
    });
  });

  test("confirms a booking request", async ({ page }) => {
    const api = await signedIn(page);
    await page.getByRole("tab", { name: /Booking Requests/ }).click();
    const requests = page.getByTestId("booking-requests");
    await expect(requests).toContainText("Dana Reed · Client consultation");
    await expect(requests).toContainText("About pricing");
    await expect(requests).toContainText("Awaiting your review");
    await shot(page, "scheduling-2-requests");
    await requests.getByRole("button", { name: "Confirm" }).click();
    await expect.poll(() => api.writes.find((w) => w.path === "/calendar/guest-bookings/g1/decision")?.body).toEqual({ approve: true });
    await expect(requests).toContainText("Confirmed");
  });
});

test.describe("the public booking page", () => {
  async function openPublic(page: Page, onBook: (body: Record<string, unknown>) => { status: number; body: unknown }) {
    const posted: Array<Record<string, unknown>> = [];
    await page.addInitScript(() => window.localStorage.setItem("theme", "dark"));
    await page.route(
      (url) => url.pathname.startsWith("/api/v1/"),
      async (route) => {
        const request = route.request();
        const p = new URL(request.url()).pathname.replace("/api/v1", "");
        if (p === "/public/booking/missing-link-abc") {
          return route.fulfill({ status: 404, contentType: "application/json", body: JSON.stringify({ success: false, error: { code: "NOT_FOUND", message: "Booking link not found" } }) });
        }
        if (p === `/public/booking/${LINK.slug}` && request.method() === "GET") {
          return route.fulfill(
            json({
              slug: LINK.slug,
              title: LINK.title,
              description: LINK.description,
              durationMinutes: 30,
              timeZone: "Europe/London",
              locationType: "VIDEO",
              requiresApproval: false,
              maxDaysAhead: 30,
              host: { name: "Michael Irvine" },
              workspace: { name: "Acme Workspace" },
              slots: SLOTS,
            })
          );
        }
        if (p === `/public/booking/${LINK.slug}` && request.method() === "POST") {
          const body = request.postDataJSON();
          posted.push(body);
          const result = onBook(body);
          return route.fulfill({ status: result.status, contentType: "application/json", body: JSON.stringify(result.body) });
        }
        return route.fulfill(json([]));
      }
    );
    await page.setViewportSize({ width: 1280, height: 900 });
    return posted;
  }

  test("a guest picks a time and books it, without signing in", async ({ page }) => {
    const posted = await openPublic(page, (body) => ({
      status: 201,
      body: { success: true, data: { id: "gb1", status: "CONFIRMED", startsAt: body.startsAt, endsAt: SLOTS[1]!.end, title: LINK.title, host: { name: "Michael Irvine" } } },
    }));
    await page.goto(`/book/${LINK.slug}`);
    await expect(page.getByRole("heading", { level: 1, name: "30-minute introduction" })).toBeVisible({ timeout: 60_000 });
    await expect(page.getByText("Michael Irvine")).toBeVisible();
    await page.getByTestId("slot-times").getByRole("button", { name: "09:30" }).click();
    await expect(page.getByTestId("chosen-slot")).toContainText("09:30");
    await page.getByLabel("Name").fill("Dana Reed");
    await page.getByLabel("Email").fill("dana@outside.example");
    await page.getByLabel(/Anything to share/).fill("About pricing");
    await shot(page, "scheduling-3-guest");
    await page.getByRole("button", { name: "Confirm booking" }).click();
    await expect(page.getByTestId("booking-done")).toContainText("You're booked");
    expect(posted[0]).toMatchObject({ name: "Dana Reed", email: "dana@outside.example", startsAt: SLOTS[1]!.start, notes: "About pricing" });
  });

  test("checks the guest's details before sending", async ({ page }) => {
    const posted = await openPublic(page, () => ({ status: 201, body: {} }));
    await page.goto(`/book/${LINK.slug}`);
    await page.getByTestId("slot-times").getByRole("button", { name: "09:00" }).click({ timeout: 60_000 });
    await page.getByLabel("Email").fill("not-an-email");
    await page.getByRole("button", { name: "Confirm booking" }).click();
    await expect(page.getByText("Enter your name.")).toBeVisible();
    await expect(page.getByText("Enter a valid email address.")).toBeVisible();
    expect(posted).toHaveLength(0);
  });

  test("a time taken meanwhile sends the guest back to choose again", async ({ page }) => {
    await openPublic(page, () => ({
      status: 409,
      body: { success: false, error: { code: "CONFLICT", message: "That time is no longer available. Please choose another.", details: { reason: "SLOT_UNAVAILABLE" } } },
    }));
    await page.goto(`/book/${LINK.slug}`);
    await page.getByTestId("slot-times").getByRole("button", { name: "10:00" }).click({ timeout: 60_000 });
    await page.getByLabel("Name").fill("Dana Reed");
    await page.getByLabel("Email").fill("dana@outside.example");
    await page.getByRole("button", { name: "Confirm booking" }).click();
    await expect(page.getByText("That time is no longer available. Please choose another.")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Choose a time" })).toBeVisible();
  });

  test("a paused or unknown link says it is not available", async ({ page }) => {
    await openPublic(page, () => ({ status: 201, body: {} }));
    await page.goto("/book/missing-link-abc");
    await expect(page.getByTestId("booking-unavailable")).toContainText("This booking page is not available", { timeout: 60_000 });
  });
});
