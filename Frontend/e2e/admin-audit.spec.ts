import { test, expect, type Page } from "@playwright/test";

/**
 * The audit screen, which used to answer confidently from a 50-row window.
 *
 * It fetched a fixed 50 events and then filtered them in the browser, so a
 * category or a date range searched only the newest 50 and reported "no
 * events match" when the matching rows were older than that — the worst
 * possible failure on the screen someone opens to investigate an incident.
 * Two of the five chips were worse still: Admin and Support tested an
 * `actorType` the mapper can only ever set to "user" or "system", so they
 * matched nothing in any workspace.
 *
 * Everything asserted here is therefore about what the browser *asks the
 * server for*. A screen that filters correctly over the wrong rows looks
 * exactly like one that works.
 */

const API = "**/api/v1";

const ADMIN_CAPABILITIES = [
  "mail.own.rw",
  "commitments.own.manage",
  "people.read",
  "people.invite.member",
  "people.member.manage",
  "workspace.settings.read",
  "workspace.settings.write",
  "workspace.mailboxes.manage",
  "workspace.domains.manage",
  "workspace.groups.manage",
  "policy.write",
  "audit.read",
];

const json = (data: unknown) => ({
  status: 200,
  contentType: "application/json",
  body: JSON.stringify({ success: true, data }),
});

function event(over: { id?: string; eventType?: string } = {}) {
  return {
    id: over.id ?? "e1",
    eventType: over.eventType ?? "LOGIN_SUCCESS",
    targetType: "Session",
    targetId: "abcdef1234",
    createdAt: "2026-09-01T09:00:00.000Z",
    actorUserId: "u1",
    actor: { id: "u1", email: "admin@zoiko.test", displayName: "Admin" },
  };
}

/** Every audit request the page made, as parsed query strings. */
interface Asked {
  list: URLSearchParams[];
  exports: URLSearchParams[];
}

async function openAudit(
  page: Page,
  opts: { events?: unknown[]; total?: number } = {}
): Promise<Asked> {
  const asked: Asked = { list: [], exports: [] };

  await page.route(`${API}/**`, (route) => route.fulfill(json({ items: [], count: 0 })));

  const session = {
    accessToken: "stub-access-token",
    refreshToken: "stub-refresh-token",
    expiresIn: "12h",
    user: { id: "u1", email: "admin@zoiko.test", displayName: "Admin" },
    tenant: { id: "t1", name: "Acme Corp", planCode: "starter" },
    membership: { id: "m1", role: "ADMIN" },
    workspace: "ADMIN",
  };
  await page.route(`${API}/auth/login`, (route) =>
    route.fulfill(json({ state: "SIGNED_IN", session, ...session }))
  );
  await page.route(`${API}/auth/me`, (route) =>
    route.fulfill(
      json({
        ...session.user,
        tenant: session.tenant,
        membership: session.membership,
        workspace: "ADMIN",
      })
    )
  );
  await page.route(`${API}/users/me/capabilities`, (route) =>
    route.fulfill(json({ capabilities: ADMIN_CAPABILITIES, decisions: [] }))
  );
  await page.route(`${API}/tenants/current`, (route) =>
    route.fulfill(
      json({
        id: "t1",
        name: "Acme Corp",
        status: "ACTIVE",
        planCode: "starter",
        timezone: "Europe/London",
        allowedDomains: ["acme.test"],
      })
    )
  );

  const events = opts.events ?? [event()];
  const total = opts.total ?? events.length;

  // Anchored to /api/v1: an unanchored pattern also matches the page URL
  // /admin/audit and would fulfil the navigation itself with JSON.
  await page.route(/\/api\/v1\/audit\/events\/export(\?|$)/, (route) => {
    asked.exports.push(new URL(route.request().url()).searchParams);
    return route.fulfill({
      status: 200,
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": 'attachment; filename="audit-log-2026-09-15.csv"',
        // The API is a different origin from the web app, and
        // Content-Disposition is not CORS-safelisted — without this the
        // browser hides it from the page and the download falls back to a
        // generic name. The server sends it; the stub must too, or this test
        // would pass against a server that does not.
        "access-control-expose-headers": "Content-Disposition",
      },
      body: "created_at,event_type\n2026-09-01T09:00:00.000Z,LOGIN_SUCCESS\n",
    });
  });

  await page.route(/\/api\/v1\/audit\/events(\?|$)/, (route) => {
    const params = new URL(route.request().url()).searchParams;
    asked.list.push(params);
    const limit = Number(params.get("limit") ?? 25);
    return route.fulfill(
      json({
        events,
        pagination: {
          page: Number(params.get("page") ?? 1),
          limit,
          total,
          totalPages: Math.max(1, Math.ceil(total / limit)),
        },
      })
    );
  });

  await page.goto("/login");
  await page.getByPlaceholder("john@example.com").fill("admin@zoiko.test");
  await page.getByPlaceholder("Enter your password").fill("Password123!");
  await page.getByRole("button", { name: "Sign In", exact: true }).click();
  await expect(page).toHaveURL(/\/admin$/, { timeout: 60_000 });

  await page.goto("/admin/audit");
  await expect(page.getByRole("heading", { name: "Audit logs" })).toBeVisible();
  return asked;
}

const latestList = (asked: Asked) => asked.list[asked.list.length - 1];

test.describe("filtering happens on the server", () => {
  test("a category is sent as prefixes rather than decided in the browser", async ({
    page,
  }) => {
    const asked = await openAudit(page);

    await page.getByRole("button", { name: "Identity", exact: true }).click();

    await expect
      .poll(() => latestList(asked)?.getAll("eventTypePrefix"))
      .toEqual(["LOGIN_", "SIGNED_IN", "SESSION_", "PASSWORD_", "MFA_"]);
  });

  test("a date range is sent as instants covering the whole day", async ({ page }) => {
    const asked = await openAudit(page);

    await page.getByLabel("From", { exact: true }).fill("2026-09-01");
    await page.getByLabel("To", { exact: true }).fill("2026-09-02");

    // The end must cover the last moment of the day, or events after midnight
    // on the closing date are silently excluded from the answer.
    await expect.poll(() => latestList(asked)?.get("from")).toBe("2026-09-01T00:00:00.000Z");
    await expect.poll(() => latestList(asked)?.get("to")).toBe("2026-09-02T23:59:59.999Z");
  });

  test("an inverted range is refused here rather than sent and rendered as a failure", async ({
    page,
  }) => {
    await openAudit(page);

    await page.getByLabel("From", { exact: true }).fill("2026-09-10");
    await page.getByLabel("To", { exact: true }).fill("2026-09-01");

    await expect(page.getByText("The end date is before the start date.")).toBeVisible();
    await expect(page.getByRole("button", { name: /Export CSV/ })).toBeDisabled();
  });

  test("All events sends no prefix at all", async ({ page }) => {
    const asked = await openAudit(page);

    // The screen's own first read — not the dashboard's, which is also an
    // audit call and happens first because sign-in lands on /admin.
    const opening = latestList(asked)!;
    // No category, so the screen opens on the whole log rather than a slice.
    expect(opening.getAll("eventTypePrefix")).toEqual([]);
    expect(opening.get("page")).toBe("1");
    expect(opening.get("limit")).toBe("25");
  });
});

test.describe("paging", () => {
  test("asks for the next page rather than slicing what it already has", async ({ page }) => {
    const asked = await openAudit(page, { total: 120 });

    await expect(page.getByText(/Page 1 of 5/)).toBeVisible();
    await page.getByRole("button", { name: "Next" }).click();

    await expect.poll(() => latestList(asked)?.get("page")).toBe("2");
    await expect(page.getByText(/Page 2 of 5/)).toBeVisible();
  });

  test("Previous is unavailable on the first page", async ({ page }) => {
    await openAudit(page, { total: 120 });
    await expect(page.getByRole("button", { name: "Previous" })).toBeDisabled();
  });

  test("Next is unavailable on the last page", async ({ page }) => {
    await openAudit(page, { total: 10 });
    await expect(page.getByRole("button", { name: "Next" })).toBeDisabled();
  });

  test("changing a filter returns to page one", async ({ page }) => {
    const asked = await openAudit(page, { total: 120 });

    await page.getByRole("button", { name: "Next" }).click();
    await expect.poll(() => latestList(asked)?.get("page")).toBe("2");

    // Page 7 of a different filter is a different set of rows; staying there
    // would show an arbitrary slice of the new result.
    await page.getByRole("button", { name: "Mail", exact: true }).click();
    await expect.poll(() => latestList(asked)?.get("page")).toBe("1");
  });

  test("the count reported is the server's total, not the page length", async ({ page }) => {
    await openAudit(page, { total: 120 });
    await expect(page.getByText("120 events")).toBeVisible();
  });
});

test.describe("export", () => {
  test("downloads with the current filters and without a page", async ({ page }) => {
    const asked = await openAudit(page);

    await page.getByRole("button", { name: "Identity", exact: true }).click();
    await page.getByLabel("From", { exact: true }).fill("2026-09-01");

    const download = page.waitForEvent("download");
    await page.getByRole("button", { name: /Export CSV/ }).click();
    await download;

    const sent = asked.exports[asked.exports.length - 1]!;
    expect(sent.getAll("eventTypePrefix")).toEqual([
      "LOGIN_",
      "SIGNED_IN",
      "SESSION_",
      "PASSWORD_",
      "MFA_",
    ]);
    expect(sent.get("from")).toBe("2026-09-01T00:00:00.000Z");
    // An export that paginated would be the defect it exists to fix.
    expect(sent.get("page")).toBeNull();
    expect(sent.get("limit")).toBeNull();
  });

  test("saves under the filename the server chose", async ({ page }) => {
    await openAudit(page);

    const download = page.waitForEvent("download");
    await page.getByRole("button", { name: /Export CSV/ }).click();
    const file = await download;

    expect(file.suggestedFilename()).toBe("audit-log-2026-09-15.csv");
  });
});

test.describe("the dead chips are gone", () => {
  test("Admin and Support are no longer offered, because they matched nothing", async ({
    page,
  }) => {
    await openAudit(page);

    // Both tested actorType === "admin" / "support", and the mapper only ever
    // produces "user" or "system" — so they were permanently empty filters.
    const chips = page.locator("button", { hasText: /^(Admin|Support)$/ });
    await expect(chips).toHaveCount(0);
  });
});
