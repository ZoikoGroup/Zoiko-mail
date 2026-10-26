import { test, expect } from "@playwright/test";
import { COLLEAGUES, me, noContent, openWorkGraph, shot, team } from "./workgraph-harness";

/**
 * Work Graph — Commitments & Follow-ups, against an in-memory stand-in for the API.
 *
 * What these protect: the register shows what the server says (owner, due time in
 * its own zone, status, evidence) and says plainly when a source is restricted;
 * every action sends exactly what was chosen; and nothing Alet found becomes a
 * commitment until a person confirms it.
 */

type Item = ReturnType<typeof commitment>;

function commitment(id: string, title: string, extra: Record<string, unknown> = {}) {
  return {
    id,
    title,
    description: null as string | null,
    stream: { id: "s1", title: "Q4 Launch Readiness" } as { id: string; title: string } | null,
    owner: team("Launch Operations"),
    expectedFrom: null as string | null,
    dueAt: null as string | null,
    timeZone: "Europe/London",
    status: "IN_PROGRESS",
    display: "IN_PROGRESS",
    visibility: "PRIVATE",
    recordedAt: null,
    fromSuggestion: false,
    createdBy: { name: "Michael Irvine", email: "michael@acme.test", isMe: true },
    isMine: false,
    canEdit: true,
    isCreator: true,
    blocking: { blocked: 0, deliverables: [] as string[] },
    evidence: [] as unknown[],
    createdAt: "2026-10-20T00:00:00.000Z",
    updatedAt: "2026-10-20T00:00:00.000Z",
    ...extra,
  };
}

const email = (id: string, label: string, canOpen = true) => ({ id, kind: "EMAIL", label, occurredAt: "2026-10-21T09:00:00.000Z", refId: canOpen ? "msg-2" : null, canOpen, openPath: canOpen ? "/mail?open=msg-2&folder=INBOX" : null, addedByMe: true });

function seed(): Item[] {
  return [
    commitment("c1", "Partner launch confirmation", {
      owner: team("Partner Relations"),
      expectedFrom: "External partner",
      dueAt: "2026-10-26T10:00:00.000Z",
      status: "AWAITING",
      display: "AWAITING",
      description: "Partner is expected to confirm the agreed launch handoff requirements.",
      evidence: [email("e1", "Launch partner handoff")],
    }),
    commitment("c2", "Legal review acknowledgment", { owner: me, isMine: true, dueAt: "2026-10-22T16:00:00.000Z", display: "PAST_DUE", evidence: [email("e2", "Counsel feedback")] }),
    commitment("c3", "Finalize release assets", {
      owner: team("Product"),
      dueAt: "2026-10-27T14:00:00.000Z",
      evidence: [{ id: "e3", kind: "MEETING", label: "Restricted meeting", occurredAt: "2026-10-21T14:00:00.000Z", refId: null, canOpen: false, openPath: null, addedByMe: false }],
    }),
    commitment("c4", "Send handoff summary", { owner: team("Client Success"), dueAt: "2026-10-30T12:00:00.000Z", status: "RECORDED", display: "RECORDED", recordedAt: "2026-10-23T00:00:00.000Z" }),
  ];
}

const SUGGESTIONS = [
  { id: "s-a", kind: "COMMITMENT", actionType: "COMMITMENT_EXTRACTION", title: "Request final release-note review", dueAt: "2026-10-28T12:00:00.000Z", priority: "HIGH", excerpt: "…please review the release notes by Wednesday…", confidence: 0.8, source: { messageId: "msg-1", subject: "Creative sign-off", openPath: "/mail?open=msg-1&folder=INBOX" }, createdAt: "2026-10-22T00:00:00.000Z" },
  { id: "s-b", kind: "COMMITMENT", actionType: "REPLY_OWED", title: "Confirm stakeholder availability", dueAt: null, priority: null, excerpt: null, confidence: null, source: null, createdAt: "2026-10-22T00:00:00.000Z" },
];

async function open(page: import("@playwright/test").Page, path = "/mail/work-graph/commitments") {
  let items = seed();
  let suggestions = [...SUGGESTIONS];
  const api = await openWorkGraph(page, path, ({ path: p, method, url, body }) => {
    if (p === "/workgraph/commitments" && method === "GET") {
      const tab = url.searchParams.get("tab") ?? "all";
      const q = (url.searchParams.get("q") ?? "").toLowerCase();
      const shown = items.filter((c) => (tab === "awaiting" ? c.status === "AWAITING" : tab === "mine" ? c.isMine : true) && (!q || c.title.toLowerCase().includes(q)));
      return { items: shown, summary: { confirmed: items.length, awaiting: items.filter((c) => c.status === "AWAITING").length, pastDue: items.filter((c) => c.display === "PAST_DUE").length, suggestions: suggestions.length } };
    }
    if (p === "/workgraph/commitments" && method === "POST") {
      const created = commitment("c-new", body.title, { description: body.description, owner: body.ownerLabel ? team(body.ownerLabel) : me, expectedFrom: body.expectedFrom, dueAt: body.dueAt, status: body.expectedFrom ? "AWAITING" : "IN_PROGRESS", display: body.expectedFrom ? "AWAITING" : "IN_PROGRESS" });
      items = [created, ...items];
      return created;
    }
    const m = p.match(/^\/workgraph\/commitments\/([^/]+)$/);
    if (m && method === "PATCH") {
      const item = items.find((c) => c.id === m[1])!;
      Object.assign(item, body, { display: body.status ?? item.display, updatedAt: new Date().toISOString() });
      return item;
    }
    if (m && method === "DELETE") {
      items = items.filter((c) => c.id !== m[1]);
      return noContent();
    }
    if (p === "/workgraph/suggestions" && method === "GET") return suggestions;
    const sm = p.match(/^\/workgraph\/suggestions\/([^/]+)\/(confirm|dismiss)$/);
    if (sm && sm[2] === "confirm") {
      const s = suggestions.find((x) => x.id === sm[1])!;
      suggestions = suggestions.filter((x) => x.id !== sm[1]);
      const created = commitment("c-sug", s.title, { fromSuggestion: true, owner: me, isMine: true, stream: null });
      items = [created, ...items];
      return { kind: "COMMITMENT", item: created };
    }
    if (sm && sm[2] === "dismiss") {
      suggestions = suggestions.filter((x) => x.id !== sm[1]);
      return noContent();
    }
    if (p === "/workgraph/streams") return [{ id: "s1", title: "Q4 Launch Readiness" }];
    if (p === "/workgraph/dependencies") return [];
    if (p === "/workgraph/decisions") return { items: [], summary: { recorded: 0, awaiting: 0, blocked: 0, suggestions: 0 } };
    return undefined;
  });
  await expect(page.getByRole("heading", { level: 1, name: "Sema — Commitments & Follow-ups" })).toBeVisible({ timeout: 60_000 });
  return api;
}

const list = (page: import("@playwright/test").Page) => page.getByTestId("commitment-list");
const detail = (page: import("@playwright/test").Page) => page.getByTestId("commitment-detail");

test("shows the register with owners, due times in their own zone, statuses and evidence", async ({ page }) => {
  await open(page);
  const stats = page.getByTestId("commitment-stats");
  await expect(stats).toContainText("4");
  await expect(stats).toContainText("Confirmed commitments");
  await expect(stats).toContainText("Awaiting responses");
  await expect(stats).toContainText("Past due");
  await expect(stats).toContainText("AI suggestions");

  const first = list(page).getByRole("button", { name: /Partner launch confirmation/ });
  await expect(first).toContainText("Email · Launch partner handoff");
  await expect(first).toContainText("Partner Relations");
  await expect(first).toContainText("26 Oct · 10:00");
  await expect(first).toContainText("Europe/London");
  await expect(first).toContainText("Awaiting");
  await expect(list(page).getByRole("button", { name: /Legal review acknowledgment/ })).toContainText("Past due");
  await expect(list(page).getByRole("button", { name: /Legal review acknowledgment/ })).toContainText("My responsibility");
  await expect(list(page).getByRole("button", { name: /Send handoff summary/ })).toContainText("Recorded");

  // The first is open in the panel.
  await expect(detail(page).getByTestId("detail-title")).toHaveText("Partner launch confirmation");
  await expect(detail(page)).toContainText("Partner is expected to confirm");
  await expect(detail(page)).toContainText("External partner");
  await expect(detail(page).getByRole("link", { name: "Launch partner handoff" })).toHaveAttribute("href", "/mail?open=msg-2&folder=INBOX");
  await shot(page, "workgraph-1-commitments");
});

test("names a source the viewer cannot open only as restricted", async ({ page }) => {
  await open(page);
  await list(page).getByRole("button", { name: /Finalize release assets/ }).click();
  await expect(detail(page)).toContainText("Restricted meeting");
  await expect(detail(page)).toContainText("you cannot open this source");
  await expect(detail(page).getByRole("button", { name: "View source" })).toBeDisabled();
});

test("filters by tab and search, asking the server for each", async ({ page }) => {
  const api = await open(page);
  await page.getByRole("tab", { name: "Awaiting others" }).click();
  await expect(list(page).getByRole("button")).toHaveCount(1);
  expect(api.requests.some((r) => r.path === "/workgraph/commitments" && r.query.tab === "awaiting")).toBe(true);
  await page.getByRole("tab", { name: /All confirmed/ }).click();
  await page.getByLabel("Search commitments").fill("legal");
  await expect(list(page).getByRole("button")).toHaveCount(1);
  expect(api.requests.some((r) => r.query.q === "legal")).toBe(true);
  await page.getByLabel("Search commitments").fill("nothing like this");
  await expect(list(page)).toContainText("No commitment matches your search.");
});

test("creates a commitment with a team owner, a due time in a chosen zone, and an email as evidence", async ({ page }) => {
  const api = await open(page);
  await page.getByRole("button", { name: "New commitment" }).first().click();
  const d = page.getByRole("dialog");
  await d.getByRole("button", { name: "Create commitment" }).click();
  await expect(d).toContainText("Give the commitment a title.");
  expect(api.writes.filter((w) => w.method === "POST" && w.path.startsWith("/workgraph"))).toHaveLength(0);

  await d.getByLabel("What was promised").fill("Countersign the partner agreement");
  await d.getByLabel("Details").fill("Sent for signature on Monday.");
  await d.getByLabel("Accountable owner").fill("Legal Operations");
  await expect(d).toContainText("Not a colleague, so this is saved as a team name.");
  await d.getByLabel("Expected from (if someone else delivers it)").fill("External partner");
  await d.getByLabel("Due date").fill("2026-11-02");
  await d.getByLabel("Time", { exact: true }).fill("14:00");
  await d.getByLabel("Time zone").selectOption("Europe/London");
  await d.getByRole("combobox", { name: "Accountable owner" }).blur();
  await d.getByTestId("source-picker").getByRole("button", { name: /Creative sign-off/ }).click();
  await expect(d.getByTestId("pending-sources")).toContainText("Email: Creative sign-off");
  await d.getByRole("button", { name: "Create commitment" }).click();
  await expect.poll(() => api.writes.find((w) => w.method === "POST" && w.path === "/workgraph/commitments")?.body).toEqual({
    title: "Countersign the partner agreement",
    description: "Sent for signature on Monday.",
    streamId: null,
    ownerLabel: "Legal Operations",
    expectedFrom: "External partner",
    dueAt: "2026-11-02T14:00:00.000Z",
    timeZone: "Europe/London",
    visibility: "PRIVATE",
    evidence: [{ kind: "EMAIL", refId: "msg-1" }],
  });
  await expect(list(page).getByRole("button", { name: /Countersign the partner agreement/ })).toContainText("Awaiting");
});

test("picks a colleague as owner by address", async ({ page }) => {
  const api = await open(page);
  await page.getByRole("button", { name: "New commitment" }).first().click();
  const d = page.getByRole("dialog");
  await d.getByLabel("What was promised").fill("Review the data policy");
  await d.getByLabel("Accountable owner").fill("pri");
  await d.getByRole("option", { name: /Priya Shah/ }).click();
  await d.getByRole("button", { name: "Create commitment" }).click();
  await expect.poll(() => api.writes.find((w) => w.path === "/workgraph/commitments")?.body).toMatchObject({ ownerEmail: COLLEAGUES[0]!.email });
  expect((api.writes.find((w) => w.path === "/workgraph/commitments")!.body as Record<string, unknown>).ownerLabel).toBeUndefined();
});

test("records a commitment as fulfilled, and reopens it", async ({ page }) => {
  const api = await open(page);
  await detail(page).getByRole("button", { name: "Mark recorded" }).click();
  await expect.poll(() => api.writes.find((w) => w.method === "PATCH" && w.path === "/workgraph/commitments/c1")?.body).toEqual({ status: "RECORDED" });
  await expect(detail(page).getByRole("button", { name: "Reopen" })).toBeVisible();
  await detail(page).getByRole("button", { name: "Reopen" }).click();
  await expect.poll(() => api.writes.filter((w) => w.path === "/workgraph/commitments/c1").map((w) => (w.body as { status: string }).status)).toEqual(["RECORDED", "IN_PROGRESS"]);
});

test("edits a commitment, keeping what was not changed", async ({ page }) => {
  const api = await open(page);
  await detail(page).getByRole("button", { name: "Edit" }).click();
  const d = page.getByRole("dialog");
  await expect(d.getByLabel("What was promised")).toHaveValue("Partner launch confirmation");
  await expect(d.getByLabel("Due date")).toHaveValue("2026-10-26");
  await expect(d.getByLabel("Time zone")).toHaveValue("Europe/London");
  await d.getByLabel("What was promised").fill("Partner launch confirmation (revised)");
  await d.getByRole("button", { name: "Save changes" }).click();
  await expect.poll(() => api.writes.find((w) => w.method === "PATCH" && w.path === "/workgraph/commitments/c1")?.body).toMatchObject({ title: "Partner launch confirmation (revised)", dueAt: "2026-10-26T10:00:00.000Z", timeZone: "Europe/London" });
});

test("plans a follow-up as a calendar event at the due time", async ({ page }) => {
  await open(page);
  await detail(page).getByRole("button", { name: "Plan follow-up" }).click();
  const d = page.getByRole("dialog");
  await expect(d.getByLabel("Title")).toHaveValue("Follow up: Partner launch confirmation");
});

test("deletes only after confirming", async ({ page }) => {
  const api = await open(page);
  await detail(page).getByRole("button", { name: "Delete" }).click();
  await expect(page.getByRole("dialog")).toContainText("Delete “Partner launch confirmation”?");
  expect(api.writes.some((w) => w.method === "DELETE")).toBe(false);
  await page.getByRole("dialog").getByRole("button", { name: "Delete" }).click();
  await expect.poll(() => api.writes.some((w) => w.method === "DELETE" && w.path === "/workgraph/commitments/c1")).toBe(true);
  await expect(list(page).getByRole("button", { name: /Partner launch confirmation/ })).toHaveCount(0);
});

test("suggestions are only suggestions until confirmed", async ({ page }) => {
  const api = await open(page);
  await expect(page.getByTestId("commitment-stats")).toContainText("2");
  await page.getByRole("tab", { name: /Suggested/ }).click();
  const suggestions = page.getByTestId("suggestion-list");
  await expect(suggestions).toContainText("Request final release-note review");
  await expect(suggestions).toContainText("Nothing becomes a commitment until you confirm it");
  await expect(suggestions.getByRole("link", { name: "Email · Creative sign-off" })).toHaveAttribute("href", "/mail?open=msg-1&folder=INBOX");
  expect(api.writes.some((w) => w.path.startsWith("/workgraph/commitments"))).toBe(false);

  await suggestions.getByRole("button", { name: "Confirm" }).first().click();
  await expect.poll(() => api.writes.some((w) => w.method === "POST" && w.path === "/workgraph/suggestions/s-a/confirm")).toBe(true);
  // The confirmed one leaves the list; the other remains.
  await expect(suggestions.getByRole("button", { name: "Confirm" })).toHaveCount(1);
  await suggestions.getByRole("button", { name: "Dismiss" }).click();
  await expect.poll(() => api.writes.some((w) => w.method === "POST" && w.path === "/workgraph/suggestions/s-b/dismiss")).toBe(true);
  await expect(suggestions).toContainText("No suggestions waiting");
});

test("on a phone, the Work Graph pages are one tap away", async ({ page }) => {
  await open(page, "/mail/work-graph/commitments");
  await page.setViewportSize({ width: 390, height: 800 });
  const strip = page.getByRole("navigation", { name: "Work Graph pages" });
  await expect(strip.getByRole("link", { name: "Decisions" })).toBeVisible();
  await strip.getByRole("link", { name: "Decisions" }).click();
  await expect(page).toHaveURL(/\/mail\/work-graph\/decisions$/);
});

test("the pages fit a phone without scrolling sideways", async ({ page }) => {
  await open(page, "/mail/work-graph/commitments");
  await page.setViewportSize({ width: 390, height: 800 });
  await expect(list(page).getByRole("button", { name: /Partner launch confirmation/ })).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(1);
  await shot(page, "workgraph-5-phone");
});
