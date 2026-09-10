import { test, expect, type Page, type Route } from "@playwright/test";

/**
 * Action Inbox (AI extraction review), draft-generation polling, Commitments
 * and connected accounts — all driven against a stubbed API, because the
 * subject is the client wiring (drawer, optimistic review, draft polling,
 * connect buttons) rather than the server producing the data. The backend
 * suite covers the server side.
 *
 * Route precedence note: when several page.route() patterns match a URL the
 * most recently registered handler wins, so the catch-all is registered FIRST
 * and every specific stub AFTER it.
 */

const API = "**/api/v1";

function signedIn(workspace: string, role: string = workspace) {
  const session = {
    accessToken: "stub-access-token",
    refreshToken: "stub-refresh-token",
    expiresIn: "12h",
    user: { id: "u1", email: "someone@zoiko.test", displayName: "Someone" },
    tenant: { id: "t1", name: "Stub Workspace", planCode: "starter" },
    membership: { id: "m1", role },
    workspace,
  };
  return { success: true, data: { state: "SIGNED_IN", session, ...session } };
}

const REPLY_ACTION = {
  id: "act-1",
  tenantId: "t1",
  createdByUserId: "u1",
  messageId: "msg-1",
  threadId: "thr-1",
  actionType: "REPLY_OWED",
  inputHash: "hash",
  output: { text: "Confirm the final meeting time for the demo", dueAt: null, priority: "MEDIUM" },
  confidenceScore: 0.86,
  sourceExcerpt: "Can you confirm the final meeting time for the demo?",
  status: "COMPLETED",
  createdAt: "2026-09-01T10:00:00.000Z",
  updatedAt: "2026-09-01T10:00:00.000Z",
};

const DISMISSED_ACTION = {
  id: "act-2",
  tenantId: "t1",
  createdByUserId: "u1",
  messageId: null,
  threadId: null,
  actionType: "COMMITMENT_EXTRACTION",
  inputHash: "hash2",
  output: { text: "Old dismissed commitment", dueAt: null, priority: "LOW" },
  confidenceScore: 0.4,
  sourceExcerpt: "Please send the follow-up",
  status: "DISMISSED",
  createdAt: "2026-09-01T09:00:00.000Z",
  updatedAt: "2026-09-01T09:00:00.000Z",
};

const SOURCE_MESSAGE = {
  id: "msg-1",
  tenantId: "t1",
  threadId: "thr-1",
  subject: "Re: Demo time",
  textBody: "Can you confirm the final meeting time for the demo?",
  htmlBody: null,
  status: "RECEIVED",
  sentAt: "2026-09-01T09:30:00.000Z",
  scheduledAt: null,
  authorUserId: "u0",
  fromAddress: "alex@example.com",
  fromName: "Alex Rivera",
  createdAt: "2026-09-01T09:30:00.000Z",
  recipients: [
    { id: "r1", email: "someone@zoiko.test", type: "TO", deliveryStatus: "DELIVERED" },
    { id: "r2", email: "priya@example.com", type: "CC", deliveryStatus: "DELIVERED" },
  ],
  attachments: [],
  author: { id: "u0", email: "alex@example.com", displayName: "Alex Rivera" },
};

const SOURCE_MAIL_ITEM = {
  id: "item-1",
  messageId: "msg-1",
  folder: "INBOX",
  isRead: true,
  isStarred: false,
  createdAt: "2026-09-01T09:30:00.000Z",
  updatedAt: "2026-09-01T09:30:00.000Z",
  labels: [],
  message: SOURCE_MESSAGE,
};

const COMMITMENT_FROM_AI = {
  id: "comm-1",
  tenantId: "t1",
  messageId: "msg-1",
  threadId: "thr-1",
  ownerUserId: "u1",
  createdByUserId: "u1",
  text: "Confirm the final meeting time for the demo",
  dueAt: null,
  priority: "MEDIUM",
  status: "OPEN",
  snoozedUntil: null,
  sourceAiActionId: "act-1",
  createdAt: "2026-09-01T10:05:00.000Z",
  updatedAt: "2026-09-01T10:05:00.000Z",
};

function json(route: Route, data: unknown, status = 200) {
  return route.fulfill({
    status,
    contentType: "application/json",
    body: JSON.stringify({ success: true, data }),
  });
}

// Everything a shell reads once a session exists. Registered FIRST so the
// specific stubs (registered after it) take precedence.
function stubSessionReads(page: Page) {
  return page.route(`${API}/**`, (route) => {
    if (route.request().url().includes("/auth/")) return route.fallback();
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ success: true, data: { items: [], count: 0 } }),
    });
  });
}

async function signIn(page: Page) {
  // /auth/login already returns { success, data }, so it ships as-is.
  await page.route(`${API}/auth/login`, (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(signedIn("MEMBER")),
    })
  );
  await page.route(`${API}/auth/me`, (route) =>
    json(route, {
      id: "u1",
      email: "someone@zoiko.test",
      displayName: "Someone",
      tenant: { id: "t1", name: "Stub Workspace", planCode: "starter" },
      membership: { id: "m1", role: "MEMBER" },
      workspace: "MEMBER",
    })
  );

  await page.goto("/login");
  await page.getByPlaceholder("john@example.com").fill("someone@zoiko.test");
  await page.getByPlaceholder("Enter your password").fill("Password123!");
  await page.getByRole("button", { name: "Sign In", exact: true }).click();
  await expect(page).toHaveURL(/\/inbox$/, { timeout: 60_000 });
}

test.beforeEach(async ({ page }) => {
  // Catch-all FIRST (lowest precedence); specific stubs registered after it.
  await stubSessionReads(page);

  // AI action list.
  await page.route(`${API}/ai/actions`, (route) =>
    json(route, { actions: [REPLY_ACTION, DISMISSED_ACTION] })
  );
  // Review flips the stubbed action's status.
  await page.route(`${API}/ai/actions/*/review`, (route) => {
    const body = route.request().postDataJSON();
    const status = body?.status === "CONFIRMED" ? "CONFIRMED" : "DISMISSED";
    const base = status === "CONFIRMED" ? REPLY_ACTION : DISMISSED_ACTION;
    return json(route, { ...base, status });
  });
  // Source message for the drawer.
  await page.route(`${API}/mail/msg-1`, (route) => json(route, SOURCE_MAIL_ITEM));
  // Commitments tab (a commitment materialized from act-1).
  await page.route(`${API}/actions`, (route) => json(route, { actions: [COMMITMENT_FROM_AI] }));
  // Draft generation polling: nothing for the first few ticks, then a draft.
  let draftTicks = 0;
  await page.route(/\/api\/v1\/mail\?folder=DRAFTS/, (route) => {
    draftTicks += 1;
    if (draftTicks < 4) {
      return json(route, { items: [], pagination: { total: 0, totalPages: 0, page: 1, limit: 50 } });
    }
    return json(route, {
      items: [
        {
          id: "item-draft",
          messageId: "draft-1",
          folder: "DRAFTS",
          isRead: false,
          isStarred: false,
          createdAt: "2026-09-01T10:10:00.000Z",
          updatedAt: "2026-09-01T10:10:00.000Z",
          labels: [],
          message: {
            id: "draft-1",
            subject: "Re: Demo time",
            textBody: "Hi Alex, yes \u2014 Thursday 2pm works for us.",
            htmlBody: null,
            status: "DRAFT",
            sentAt: null,
            scheduledAt: null,
            threadId: "thr-1",
            authorUserId: "u1",
            fromAddress: "someone@zoiko.test",
            fromName: "Someone",
            createdAt: "2026-09-01T10:10:00.000Z",
            sourceAiActionId: "act-1",
            recipients: [{ id: "r1", email: "alex@example.com", type: "TO", deliveryStatus: "QUEUED" }],
            attachments: [],
            author: { id: "u1", email: "someone@zoiko.test", displayName: "Someone" },
          },
        },
      ],
      pagination: { total: 1, totalPages: 1, page: 1, limit: 50 },
    });
  });
});

test("Action Inbox reviews an AI action and resolves the generated draft", async ({ page }) => {
  await signIn(page);

  // Card renders with the human type label, status and confidence.
  await expect(page.getByText("Reply owed", { exact: true })).toBeVisible();
  await expect(page.getByText("Ready to review", { exact: true })).toBeVisible();

  // Open the detail drawer.
  await page.getByRole("button", { name: /Confirm the final meeting time/ }).first().click();
  await expect(page.getByText("Why was this flagged?", { exact: false })).toBeVisible();
  await expect(page.getByText(/sounds like it expects a reply/i)).toBeVisible();
  await expect(page.getByText(/Can you confirm the final meeting time/).first()).toBeVisible();

  // Source message shows in the drawer.
  await expect(page.getByText("Re: Demo time")).toBeVisible();
  await expect(page.getByText(/Alex Rivera/)).toBeVisible();

  // Confirm & generate draft.
  await page.getByRole("button", { name: "Confirm & generate draft" }).click();
  await expect(page.getByText(/Generating a draft reply/)).toBeVisible();

  // Poll resolves to the generated draft panel.
  await expect(page.getByText("Draft ready")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText("Hi Alex, yes \u2014 Thursday 2pm works for us.")).toBeVisible();
  await expect(page.getByRole("link", { name: "Open in Webmail" })).toBeVisible();
});

test("Dismissing an action leaves no commitment and the drawer reflects it", async ({ page }) => {
  await signIn(page);

  await page.getByRole("button", { name: /Confirm the final meeting time/ }).first().click();
  await page.getByRole("button", { name: "Dismiss", exact: true }).click();
  await expect(page.getByText(/Dismissed \u2014 no commitment or draft was created/)).toBeVisible();

  // Dismissing leaves the (now-dismissed) drawer open; close it so it can't
  // sit over the tabs, then prove the dismissal materialized nothing.
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Commitments" }).click();
  await expect(page.getByText("From AI")).toBeVisible();
  await expect(page.getByText("Confirm the final meeting time for the demo")).toBeVisible();
});

test("Connected accounts page offers Google and Microsoft 365 connect and disconnect", async ({ page }) => {
  // Mutable account list so a disconnect is visible on refetch.
  const accounts: unknown[] = [
    {
      id: "c1",
      provider: "GMAIL",
      email: "someone@zoiko.test",
      scopes: ["https://www.googleapis.com/auth/gmail.readonly"],
      status: "ACTIVE",
      watchExpiresAt: null,
      lastSyncedAt: "2026-09-01T10:00:00.000Z",
      lastErrorCode: null,
      disconnectedAt: null,
      createdAt: "2026-09-01T09:00:00.000Z",
      updatedAt: "2026-09-01T09:00:00.000Z",
    },
  ];
  await page.route(`${API}/connectors`, (route) => json(route, { accounts }));
  await page.route(`${API}/connectors/*`, (route) => {
    if (route.request().method() === "DELETE") {
      const id = route.request().url().split("/").pop();
      const idx = accounts.findIndex((a: any) => a.id === id);
      if (idx >= 0) accounts.splice(idx, 1);
      return json(route, { ok: true });
    }
    return route.fallback();
  });
  await page.route(`${API}/connectors/auth/microsoft`, (route) =>
    route.fulfill({
      status: 500,
      contentType: "application/json",
      body: JSON.stringify({ success: false, error: { code: "PROVIDER_ERROR", message: "Microsoft OAuth misconfigured" } }),
    })
  );

  await signIn(page);
  await page.goto("/connected-accounts");
  await expect(page.getByRole("heading", { name: "Connected accounts" })).toBeVisible();
  await expect(page.getByText("Gmail", { exact: true })).toBeVisible();

  // Connect panel lists both providers.
  await page.getByRole("button", { name: /Connect account/ }).click();
  await expect(page.getByRole("button", { name: /Continue with Google/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /Continue with Microsoft 365/ })).toBeVisible();

  // Microsoft OAuth failure surfaces the backend's message, not a dead-end.
  await page.getByRole("button", { name: /Continue with Microsoft 365/ }).click();
  await expect(page.getByText("Microsoft OAuth misconfigured")).toBeVisible({ timeout: 15_000 });

  // Disconnect requires a confirmation and removes the account.
  await page.getByRole("button", { name: "Disconnect", exact: true }).first().click();
  await expect(page.getByText(/Disconnect someone@zoiko.test/)).toBeVisible();
  await page.getByRole("button", { name: "Disconnect", exact: true }).last().click();
  await expect(page.getByText("No accounts connected")).toBeVisible({ timeout: 15_000 });
});