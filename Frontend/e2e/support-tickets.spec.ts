import { test, expect, type Page } from "@playwright/test";

/**
 * A ticket from raised to resolved — P2-6.
 *
 * The queue is where Runbook §5's promise either holds or quietly does not.
 * §5 sets the response target by severity, and the whole point of putting it
 * on screen is that the person on duty can tell a fifteen-minute promise from
 * a one-business-day one without doing the arithmetic themselves.
 *
 * Asserted on the requests that leave, not the markup: a comment that renders
 * but never reaches the server, or an "internal note" that goes out visible
 * to the customer, both look correct on screen. The second of those is the
 * one that would matter.
 */

const API = "**/api/v1";

const json = (data: unknown) => ({
  status: 200,
  contentType: "application/json",
  body: JSON.stringify({ success: true, data }),
});

interface Sent {
  method: string;
  url: string;
  body: Record<string, unknown> | null;
}

const STAFF = { id: "s1", email: "agent@zoiko.test", displayName: "Agent" };

interface Comment {
  id: string;
  body: string;
  isInternal: boolean;
  author: typeof STAFF;
  authorType: string;
  createdAt: string;
}

function ticket(over: Record<string, unknown> = {}) {
  return {
    id: "tk1",
    ticketNumber: 1042,
    tenantId: "t1",
    tenantName: "Acme Corp",
    subject: "External mail bouncing since 09:00",
    description: "Customer reports every outbound message to gmail.com is bouncing.",
    category: "DELIVERY",
    severity: "URGENT",
    status: "OPEN",
    openedBy: { id: "u2", email: "devon@acme.test", displayName: "Devon" },
    openedByType: "TENANT",
    assignedStaff: null,
    slaDueAt: new Date(Date.now() + 15 * 60_000).toISOString(),
    slaTarget: "15 minutes",
    slaOverdue: false,
    resolvedAt: null,
    closedAt: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    comments: [] as Comment[],
    ...over,
  };
}

/**
 * A Zoiko staff session.
 *
 * Staff hold no tenant membership, so /support decides which console to draw
 * from the platform token in localStorage rather than from /auth/me. Seeding
 * it before the first navigation is what makes this the staff console.
 */
async function signInAsStaff(page: Page): Promise<{ sent: Sent[]; state: { current: any } }> {
  const sent: Sent[] = [];
  const state = { current: ticket() };

  await page.addInitScript(() => {
    window.localStorage.setItem("zoiko.platform_token", "stub-platform-token");
  });

  await page.route(`${API}/**`, (route) => {
    const request = route.request();
    sent.push({
      method: request.method(),
      url: request.url(),
      body: request.postDataJSON?.() ?? null,
    });
    return route.fulfill(json({ items: [], count: 0 }));
  });

  // The console reads every one of these on mount, several with `.length`
  // or a nested property, so an incomplete fixture crashes it during
  // hydration rather than failing an assertion — which reads as a missing
  // button instead of a broken stub.
  await page.route(`${API}/support/platform/overview`, (route) =>
    route.fulfill(
      json({
        stats: {
          activeTenants: 4,
          tenantMembers: 31,
          activeMailboxes: 27,
          configuredDomains: 6,
          providerAccounts: 9,
          failedSends24h: 2,
          syncFailures24h: 0,
          failedJobs: 0,
          retryJobs: 1,
        },
        ticketStats: { open: 1, overdue: 0, urgent: 1, byStatus: { OPEN: 1 } },
        recentTickets: [],
        providerHealth: { byProvider: [], byStatus: [], matrix: [] },
        issues: [],
      })
    )
  );

  await page.route(`${API}/support/platform/tickets/staff`, (route) =>
    route.fulfill(json({ staff: [STAFF] }))
  );

  await page.route(`${API}/support/platform/tickets?*`, (route) =>
    route.fulfill(json({ tickets: [state.current] }))
  );
  await page.route(`${API}/support/platform/tickets`, (route) => {
    const request = route.request();
    sent.push({ method: request.method(), url: request.url(), body: request.postDataJSON?.() ?? null });
    if (request.method() === "GET") return route.fulfill(json({ tickets: [state.current] }));
    state.current = ticket({ ...(request.postDataJSON?.() ?? {}), id: "tk1", ticketNumber: 1043 });
    return route.fulfill(json(state.current));
  });

  await page.route(`${API}/support/platform/tickets/tk1`, (route) => {
    const request = route.request();
    if (request.method() === "PATCH") {
      const patch = request.postDataJSON?.() ?? {};
      sent.push({ method: "PATCH", url: request.url(), body: patch });
      state.current = {
        ...state.current,
        ...patch,
        assignedStaff: patch.assignedStaffId ? STAFF : state.current.assignedStaff,
      };
    }
    return route.fulfill(json(state.current));
  });

  await page.route(`${API}/support/platform/tickets/tk1/comments`, (route) => {
    const request = route.request();
    const body = request.postDataJSON?.() ?? {};
    sent.push({ method: request.method(), url: request.url(), body });
    const comment: Comment = {
      id: `c${state.current.comments.length + 1}`,
      body: body.body,
      isInternal: Boolean(body.internal),
      author: STAFF,
      authorType: "STAFF",
      createdAt: new Date().toISOString(),
    };
    state.current = { ...state.current, comments: [...state.current.comments, comment] };
    return route.fulfill(json(comment));
  });

  return { sent, state };
}

async function openQueue(page: Page) {
  await page.goto("/support");
  // The staff console is code-split and the page mounts it on the platform
  // token, so the first paint is a loader rather than the console.
  await page.getByRole("button", { name: /Tickets/i }).first().click({ timeout: 60_000 });
}

test.describe("the ticket queue", () => {
  test("states the response target in the runbook's own words", async ({ page }) => {
    test.setTimeout(180_000);
    await signInAsStaff(page);
    await openQueue(page);

    await expect(page.getByText("External mail bouncing since 09:00")).toBeVisible({
      timeout: 60_000,
    });

    // §5: URGENT is a fifteen-minute initial response. A due timestamp alone
    // states a deadline without the promise behind it, so nobody skimming
    // the queue can tell a tight target from a generous one.
    await expect(page.getByText("15 minutes").first()).toBeVisible();
  });
});

test.describe("working a ticket", () => {
  test("assign, reply, resolve — and each one reaches the server", async ({ page }) => {
    test.setTimeout(180_000);
    const { sent } = await signInAsStaff(page);
    await openQueue(page);

    await page.getByText("External mail bouncing since 09:00").click({ timeout: 60_000 });
    await expect(page.getByRole("heading", { name: /External mail bouncing/i })).toBeVisible();

    // Assign.
    await page.getByRole("combobox").nth(2).selectOption(STAFF.id);
    await expect
      .poll(() => sent.filter((s) => s.method === "PATCH" && s.body?.assignedStaffId).length)
      .toBeGreaterThan(0);

    // Reply to the customer.
    await page.getByPlaceholder(/Reply to the tenant/i).fill("We can see the bounces — investigating now.");
    await page.getByRole("button", { name: "Send reply" }).click();
    await expect.poll(() => sent.filter((s) => s.url.includes("/comments")).length).toBeGreaterThan(0);

    const reply = sent.find((s) => s.url.includes("/comments"));
    expect(reply?.body?.body).toContain("investigating now");
    // The visibility toggle is the thing worth asserting: a note the agent
    // meant to keep internal, sent as a customer-visible reply, looks
    // identical on this screen and is not retractable.
    //
    // Compared to `false` rather than checked for falsiness. The field is
    // `internal`, and an earlier version of this line looked for
    // `isInternal` — which is undefined, which is falsy, so the assertion
    // passed without ever reading the flag it exists to check.
    expect(reply?.body?.internal).toBe(false);

    // Resolve.
    await page.getByRole("combobox").first().selectOption("RESOLVED");
    await expect
      .poll(() => sent.filter((s) => s.method === "PATCH" && s.body?.status === "RESOLVED").length)
      .toBeGreaterThan(0);
  });

  test("an internal note is sent as internal", async ({ page }) => {
    test.setTimeout(180_000);
    const { sent } = await signInAsStaff(page);
    await openQueue(page);

    await page.getByText("External mail bouncing since 09:00").click({ timeout: 60_000 });
    await expect(page.getByRole("heading", { name: /External mail bouncing/i })).toBeVisible();

    await page.getByRole("button", { name: "Internal note" }).click();
    await page.getByPlaceholder(/Internal note/i).fill("Provider confirms an IP reputation block.");
    await page.getByRole("button", { name: "Add note" }).click();

    await expect.poll(() => sent.filter((s) => s.url.includes("/comments")).length).toBeGreaterThan(0);
    const note = sent.find((s) => s.url.includes("/comments"));
    expect(note?.body?.internal).toBe(true);
  });
});
