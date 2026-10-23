import { test, expect, type Page } from "@playwright/test";
import { json } from "./admin-harness";

/**
 * Meeting Rooms & Resources (Calendar step 4), against an in-memory stand-in
 * for the calendar API.
 *
 * What these protect: the board shows each resource's day from the server
 * (booked, yours, pending, free, needs approval); a free slot can be reviewed
 * and booked with exactly what was entered; filters narrow the board;
 * Owners and Admins see approvals and resource management, members do not.
 * The board is moved to tomorrow so no hour has already passed.
 */

const tomorrow = (hh: number, mm = 0) => {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1, hh, mm);
};
const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

const resource = (id: string, name: string, extra: Record<string, unknown> = {}) => ({
  id,
  kind: "ROOM",
  name,
  description: null,
  capacity: 8,
  location: "London HQ",
  floor: "Floor 3",
  features: ["Video conferencing", "Large display"],
  requiresApproval: false,
  isActive: true,
  createdAt: "",
  updatedAt: "",
  ...extra,
});

const RESOURCES = [
  resource("r-atlas", "Atlas Boardroom", { capacity: 12, floor: "Floor 4", requiresApproval: true }),
  resource("r-horizon", "Horizon Room"),
  resource("r-cedar", "Cedar Meeting Room", { capacity: 6, floor: "Floor 2", features: ["Whiteboard"] }),
  resource("r-av", "Portable AV Kit", { kind: "EQUIPMENT", capacity: null, features: [] }),
];

const booking = (id: string, resourceId: string, title: string, hour: number, extra: Record<string, unknown> = {}) => ({
  id,
  resourceId,
  startsAt: tomorrow(hour).toISOString(),
  endsAt: tomorrow(hour + 1).toISOString(),
  status: "CONFIRMED",
  isMine: false,
  title,
  bookedBy: "Sarah Chen",
  eventId: null,
  ...extra,
});

const BOOKINGS = [
  booking("b1", "r-atlas", "Board meeting", 9),
  booking("b2", "r-horizon", "Product sync", 10, { isMine: true, eventId: "e2" }),
  booking("b3", "r-cedar", "Design review", 15, { status: "PENDING" }),
];

const view = (id: string, name: string, status: string, hour: number, title: string) => ({
  id,
  startsAt: tomorrow(hour).toISOString(),
  endsAt: tomorrow(hour + 1).toISOString(),
  status,
  attendeeCount: 6,
  note: null,
  createdAt: "",
  resource: { id: "r-atlas", name, kind: "ROOM", location: "London HQ", floor: "Floor 4", capacity: 12 },
  event: { id: `ev-${id}`, title },
  bookedBy: { name: "Dana Reed", email: "dana@acme.test" },
  isMine: true,
});

interface Api {
  writes: Array<{ method: string; path: string; body: unknown }>;
  pending: unknown[];
  mine: unknown[];
}

async function open(page: Page, { manager, empty = false }: { manager: boolean; empty?: boolean }): Promise<Api> {
  const api: Api = {
    writes: [],
    pending: [view("p1", "Atlas Boardroom", "PENDING", 13, "Quarterly planning")],
    mine: [view("m1", "Horizon Room", "CONFIRMED", 10, "Product sync")],
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
      if (p === "/calendar/calendars") return route.fulfill(json([]));
      if (p === "/calendar/people") return route.fulfill(json([{ email: "sarah@acme.test", name: "Sarah Chen" }]));
      if (p === "/calendar/resources/board") return route.fulfill(json(empty ? { resources: [], bookings: [] } : { resources: RESOURCES, bookings: BOOKINGS }));
      if (p === "/calendar/resources" && method === "GET") return route.fulfill(json(empty ? [] : RESOURCES));
      if (p === "/calendar/resources" && method === "POST") return route.fulfill({ ...json({ ...resource("r-new", body.name), ...body }), status: 201 });
      if (p === "/calendar/bookings/mine") return route.fulfill(json(api.mine));
      if (p === "/calendar/bookings/pending") {
        if (!manager) return route.fulfill({ status: 403, contentType: "application/json", body: JSON.stringify({ success: false, error: { code: "FORBIDDEN", message: "Only Owners and Admins" } }) });
        return route.fulfill(json(api.pending));
      }
      if (/^\/calendar\/bookings\/[^/]+\/decision$/.test(p)) {
        api.pending = [];
        return route.fulfill(json([]));
      }
      if (/^\/calendar\/bookings\/[^/]+\/cancel$/.test(p)) {
        api.mine = api.mine.map((b) => ({ ...(b as object), status: "CANCELLED" }));
        return route.fulfill({ status: 204, body: "" });
      }
      const bookMatch = p.match(/^\/calendar\/resources\/([^/]+)\/book$/);
      if (bookMatch) {
        const r = RESOURCES.find((x) => x.id === bookMatch[1])!;
        return route.fulfill({ ...json({ bookingId: "bk-new", eventId: "ev-new", status: r.requiresApproval ? "PENDING" : "CONFIRMED" }), status: 201 });
      }
      return route.fulfill(json([]));
    }
  );
  await page.setViewportSize({ width: 1600, height: 950 });
  await page.goto("/login/member");
  await page.getByPlaceholder("john@example.com").fill("michael@acme.test");
  await page.getByPlaceholder("Enter your password").fill("Password123!");
  await page.getByRole("button", { name: "Sign In to Member Workspace" }).click();
  await expect(page).toHaveURL(/\/mail$/, { timeout: 60_000 });
  await page.goto("/mail/calendar/rooms");
  await expect(page.getByRole("heading", { level: 1, name: "Meeting Rooms & Resources" })).toBeVisible({ timeout: 60_000 });
  await page.getByLabel("Day").fill(ymd(tomorrow(0)));
  return api;
}

async function shot(page: Page, name: string) {
  if (process.env.E2E_SCREENSHOTS) await page.screenshot({ path: `${process.env.E2E_SCREENSHOTS}/${name}.png` });
}

test("the board shows each resource's day: booked, mine, pending, free and approval-only", async ({ page }) => {
  await open(page, { manager: true });
  const board = page.getByTestId("availability-board");
  const atlas = board.getByRole("row", { name: /Atlas Boardroom/ });
  await expect(atlas).toContainText("Board meeting");
  await expect(atlas.getByRole("button", { name: /10:00 approval needed/ })).toContainText("Approval needed");
  const horizon = board.getByRole("row", { name: /Horizon Room/ });
  await expect(horizon).toContainText("Product sync");
  await expect(horizon).toContainText("Yours");
  await expect(board.getByRole("row", { name: /Cedar Meeting Room/ })).toContainText("Pending approval");
  await expect(horizon.getByRole("button", { name: /11:00 available/ })).toContainText("Available");
  await shot(page, "rooms-1-board");
});

test("a free slot is reviewed and booked with what was entered", async ({ page }) => {
  const api = await open(page, { manager: false });
  await page.getByTestId("availability-board").getByRole("button", { name: "Horizon Room 13:00 available" }).click();
  const preview = page.getByTestId("booking-preview");
  await expect(preview).toContainText("13:00–14:00");
  await expect(preview).toContainText("Horizon Room");
  await expect(page.getByTestId("resource-card")).toContainText("Video conferencing");
  await preview.getByLabel("Attendees").fill("5");
  await preview.getByRole("button", { name: /Review booking/ }).click();

  const dialog = page.getByRole("dialog", { name: "Book Horizon Room" });
  await dialog.getByLabel("Meeting title").fill("Client demo");
  await dialog.getByLabel("Invite people (optional)").fill("sarah");
  await dialog.getByRole("option", { name: /Sarah Chen/ }).click();
  await shot(page, "rooms-2-book");
  await dialog.getByRole("button", { name: "Confirm booking" }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole("status")).toContainText("Booked. The meeting is in your calendar.");
  expect(api.writes.find((w) => w.path === "/calendar/resources/r-horizon/book")?.body).toMatchObject({
    title: "Client demo",
    startsAt: tomorrow(13).toISOString(),
    endsAt: tomorrow(14).toISOString(),
    attendees: ["sarah@acme.test"],
    attendeeCount: 5,
  });
});

test("a room that needs approval is requested, not confirmed", async ({ page }) => {
  await open(page, { manager: false });
  await page.getByTestId("availability-board").getByRole("button", { name: "Atlas Boardroom 11:00 approval needed" }).click();
  await expect(page.getByTestId("booking-preview")).toContainText("needs approval");
  await page.getByTestId("booking-preview").getByRole("button", { name: /Review booking/ }).click();
  const dialog = page.getByRole("dialog", { name: "Book Atlas Boardroom" });
  await dialog.getByLabel("Meeting title").fill("Board prep");
  await dialog.getByRole("button", { name: "Request booking" }).click();
  await expect(page.getByRole("status")).toContainText("Booking requested");
});

test("too many people for the room is flagged, and alternatives are offered", async ({ page }) => {
  await open(page, { manager: false });
  await page.getByTestId("availability-board").getByRole("button", { name: "Cedar Meeting Room 11:00 available" }).click();
  const preview = page.getByTestId("booking-preview");
  await preview.getByLabel("Attendees").fill("8");
  await expect(preview).toContainText("too small for 8");
  await preview.getByRole("button", { name: "Alternatives" }).click();
  const alternatives = page.getByTestId("alternatives");
  await expect(alternatives).toContainText("Horizon Room");
  await expect(alternatives).toContainText("Atlas Boardroom");
  await alternatives.getByRole("button", { name: /Horizon Room/ }).click();
  await expect(preview).toContainText("Horizon Room");
});

test("filters narrow the board", async ({ page }) => {
  await open(page, { manager: false });
  const board = page.getByTestId("availability-board");
  await page.getByLabel("Capacity").selectOption("12");
  await expect(board.getByRole("row", { name: /Atlas Boardroom/ })).toBeVisible();
  await expect(board.getByRole("row", { name: /Horizon Room/ })).toHaveCount(0);
  await page.getByLabel("Capacity").selectOption("0");
  await page.getByLabel("Features").selectOption("Whiteboard");
  await expect(board.getByRole("row", { name: /Cedar Meeting Room/ })).toBeVisible();
  await expect(board.getByRole("row", { name: /Atlas Boardroom/ })).toHaveCount(0);
});

test("a member sees their reservations and can cancel one, but no approvals", async ({ page }) => {
  const api = await open(page, { manager: false });
  await expect(page.getByRole("button", { name: /Pending approvals/ })).toHaveCount(0);
  await page.getByRole("button", { name: "My reservations" }).first().click();
  const list = page.getByTestId("my-reservations");
  await expect(list).toContainText("Horizon Room · Product sync");
  await expect(list).toContainText("Confirmed");
  await list.getByRole("button", { name: "Cancel booking" }).click();
  await expect.poll(() => api.writes.some((w) => w.path === "/calendar/bookings/m1/cancel")).toBe(true);
  await expect(list).toContainText("Cancelled");
});

test("an Owner or Admin approves bookings and adds resources", async ({ page }) => {
  const api = await open(page, { manager: true });
  await page.getByRole("button", { name: /Pending approvals/ }).click();
  const pending = page.getByTestId("pending-approvals");
  await expect(pending).toContainText("Atlas Boardroom · Quarterly planning");
  await expect(pending).toContainText("requested by Dana Reed");
  await shot(page, "rooms-3-approvals");
  await pending.getByRole("button", { name: "Approve" }).click();
  await expect.poll(() => api.writes.find((w) => w.path === "/calendar/bookings/p1/decision")?.body).toEqual({ approve: true });

  await page.getByRole("button", { name: "Add resource" }).first().click();
  const dialog = page.getByRole("dialog", { name: "Add a room or resource" });
  await dialog.getByLabel("Name").fill("Focus Pod");
  await dialog.getByLabel("Seats").fill("4");
  await dialog.getByLabel("Location").fill("London HQ");
  await dialog.getByLabel("Features (comma separated)").fill("Quiet, Whiteboard");
  await dialog.getByLabel("Bookings need approval from an Owner or Admin").check();
  await dialog.getByRole("button", { name: "Add", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  expect(api.writes.find((w) => w.path === "/calendar/resources" && w.method === "POST")?.body).toEqual({
    kind: "ROOM",
    name: "Focus Pod",
    capacity: 4,
    location: "London HQ",
    floor: null,
    features: ["Quiet", "Whiteboard"],
    description: null,
    requiresApproval: true,
  });
});

test("New booking opens the booking form, with a choice of room", async ({ page }) => {
  const api = await open(page, { manager: false });
  await page.getByRole("button", { name: "New booking" }).click();
  const dialog = page.getByRole("dialog", { name: /^Book / });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel("Room or resource").selectOption("r-cedar");
  await expect(dialog).toHaveAccessibleName("Book Cedar Meeting Room");
  await dialog.getByLabel("Meeting title").fill("Retro");
  await dialog.getByRole("button", { name: "Confirm booking" }).click();
  await expect(dialog).toHaveCount(0);
  expect(api.writes.some((w) => w.path === "/calendar/resources/r-cedar/book")).toBe(true);
});

test("with no rooms yet, New booking tells a member why", async ({ page }) => {
  await open(page, { manager: false, empty: true });
  await page.getByRole("button", { name: "New booking" }).click();
  await expect(page.getByRole("status")).toContainText("There are no rooms or resources to book yet");
});

test("with no rooms yet, New booking takes an Owner or Admin to add one", async ({ page }) => {
  await open(page, { manager: true, empty: true });
  await page.getByRole("button", { name: "New booking" }).click();
  await expect(page.getByRole("dialog", { name: "Add a room or resource" })).toBeVisible();
});
