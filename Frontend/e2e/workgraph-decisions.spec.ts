import { test, expect, type Page } from "@playwright/test";
import { colleague, expectNothingClipped, me, noContent, openWorkGraph, refused, shot, team } from "./workgraph-harness";

/**
 * Work Graph — Decisions & Dependencies, against an in-memory stand-in for the API.
 *
 * What these protect: the approve action is offered only to the person
 * authorised to give it (and says who is, to everyone else); an outcome sends
 * exactly what was chosen; a deliverable's state, and what it waits on, are
 * shown as the server reports them; and an approver has to be a colleague.
 */

type Decision = ReturnType<typeof decision>;

function decision(id: string, title: string, extra: Record<string, unknown> = {}) {
  return {
    id,
    title,
    rationale: null as string | null,
    stream: { id: "s1", title: "Partner launch" } as { id: string; title: string } | null,
    owner: team("Comms Lead"),
    approver: { name: "Launch Sponsor", email: "sponsor@acme.test", isMe: false } as { name: string; email: string; isMe: boolean } | null,
    reviewAt: "2026-10-26T11:00:00.000Z",
    timeZone: "Europe/London",
    status: "PENDING",
    decidedAt: null as string | null,
    decidedBy: null as string | null,
    decisionNote: null as string | null,
    supersededBy: null,
    visibility: "WORKSPACE",
    fromSuggestion: false,
    createdBy: { name: "Michael Irvine", email: "michael@acme.test", isMe: true },
    canDecide: false,
    authority: "Only Launch Sponsor can approve this.",
    canEdit: true,
    isCreator: true,
    impact: { blocked: 0, deliverables: [] as string[] },
    evidence: [] as unknown[],
    createdAt: "2026-10-20T00:00:00.000Z",
    updatedAt: "2026-10-20T00:00:00.000Z",
    ...extra,
  };
}

function dependency(id: string, deliverable: string, extra: Record<string, unknown> = {}) {
  return {
    id,
    deliverable,
    description: null,
    owner: team("Comms"),
    blocker: { type: "DECISION", id: "d1", title: "Approve partner launch messaging", status: "PENDING" },
    state: "WAITING",
    stateLabel: "Waiting on approval",
    notified: false,
    resolvedAt: null as string | null,
    stream: { id: "s1", title: "Partner launch" },
    visibility: "WORKSPACE",
    isMine: false,
    canEdit: true,
    createdAt: "2026-10-20T00:00:00.000Z",
    ...extra,
  };
}

function seed(): Decision[] {
  return [
    decision("d1", "Approve partner launch messaging", {
      rationale: "Partner emails and release notes require explicit sponsor approval before distribution.",
      impact: { blocked: 2, deliverables: ["Partner email sequence", "Release notes"] },
      evidence: [{ id: "ev1", kind: "MEETING", label: "Launch review", occurredAt: "2026-10-22T11:00:00.000Z", refId: "ev-1", canOpen: true, openPath: "/mail/calendar?date=2026-10-22", addedByMe: true }],
    }),
    decision("d2", "Approve retention matrix", { owner: team("Privacy Lead"), approver: { name: "Michael Irvine", email: "michael@acme.test", isMe: true }, canDecide: true, authority: "Only Michael Irvine can approve this.", reviewAt: "2026-10-27T14:00:00.000Z", impact: { blocked: 1, deliverables: ["Data policy"] } }),
    decision("d3", "Confirm pilot scope", { status: "APPROVED", approver: null, decidedAt: "2026-10-22T16:00:00.000Z", decidedBy: "Product Lead", decisionNote: "Pilot with two teams.", reviewAt: "2026-10-22T16:30:00.000Z", authority: "Nobody was named." }),
    decision("d4", "Replace legacy template rule", { status: "SUPERSEDED", approver: null, owner: team("Operations"), decidedAt: "2026-10-19T10:00:00.000Z", decidedBy: "Product Lead", supersededBy: { id: "d3", title: "Confirm pilot scope" } }),
  ];
}

async function open(page: Page, path = "/mail/work-graph/decisions") {
  let decisions = seed();
  let dependencies = [
    dependency("p1", "Partner email sequence"),
    dependency("p2", "Release communications", { state: "BLOCKED", stateLabel: "Blocked · owner notified", notified: true, blocker: { type: "DECISION", id: "d2", title: "Approve retention matrix", status: "DEFERRED" } }),
    dependency("p3", "Press release", { state: "UNBLOCKED", stateLabel: "Unblocked", resolvedAt: "2026-10-23T00:00:00.000Z" }),
  ];
  const api = await openWorkGraph(page, path, ({ path: p, method, url, body }) => {
    if (p === "/workgraph/decisions" && method === "GET") {
      const tab = url.searchParams.get("tab") ?? "all";
      const q = (url.searchParams.get("q") ?? "").toLowerCase();
      const shown = decisions.filter((d) => (tab === "awaiting" ? d.status === "PENDING" : tab === "approved" ? d.status === "APPROVED" : true) && (!q || d.title.toLowerCase().includes(q)));
      return { items: shown, summary: { recorded: decisions.length, awaiting: decisions.filter((d) => d.status === "PENDING").length, blocked: dependencies.filter((x) => !x.resolvedAt).length, suggestions: 1 } };
    }
    if (p === "/workgraph/decisions" && method === "POST") {
      const created = decision("d-new", body.title, { rationale: body.rationale, approver: body.approverEmail ? colleague("Priya Shah", body.approverEmail) : null, canDecide: false });
      decisions = [created, ...decisions];
      return created;
    }
    const decideMatch = p.match(/^\/workgraph\/decisions\/([^/]+)\/decision$/);
    if (decideMatch) {
      const d = decisions.find((x) => x.id === decideMatch[1])!;
      if (!d.canDecide) return refused(403, "FORBIDDEN", d.authority);
      Object.assign(d, { status: body.outcome, decidedAt: "2026-10-26T09:00:00.000Z", decidedBy: "Michael Irvine", decisionNote: body.note ?? null, canDecide: body.outcome !== "SUPERSEDED", updatedAt: new Date().toISOString() });
      return d;
    }
    const dm = p.match(/^\/workgraph\/decisions\/([^/]+)$/);
    if (dm && method === "PATCH") return Object.assign(decisions.find((d) => d.id === dm[1])!, body);
    if (dm && method === "DELETE") {
      decisions = decisions.filter((d) => d.id !== dm[1]);
      return noContent();
    }
    if (p === "/workgraph/dependencies" && method === "GET") return dependencies.filter((d) => !url.searchParams.get("q") || d.deliverable.toLowerCase().includes(url.searchParams.get("q")!.toLowerCase())).filter((d) => url.searchParams.get("state") !== "open" || !d.resolvedAt);
    if (p === "/workgraph/dependencies" && method === "POST") {
      const created = dependency("p-new", body.deliverable, { blocker: { type: body.blockerType, id: body.blockerId, title: decisions.find((d) => d.id === body.blockerId)?.title ?? "Item", status: "PENDING" } });
      dependencies = [created, ...dependencies];
      return created;
    }
    const pm = p.match(/^\/workgraph\/dependencies\/([^/]+)$/);
    if (pm && method === "PATCH") {
      const dep = dependencies.find((d) => d.id === pm[1])!;
      Object.assign(dep, body.resolved ? { resolvedAt: "2026-10-26T09:00:00.000Z", state: "UNBLOCKED", stateLabel: "Unblocked" } : { resolvedAt: null, state: "WAITING", stateLabel: "Waiting on approval" });
      return dep;
    }
    if (pm && method === "DELETE") {
      dependencies = dependencies.filter((d) => d.id !== pm[1]);
      return noContent();
    }
    if (p === "/workgraph/suggestions") return [{ id: "s-d", kind: "DECISION", actionType: "APPROVAL", title: "Approve the pricing change", dueAt: null, priority: null, excerpt: "…needs your approval…", confidence: 0.7, source: null, createdAt: "2026-10-22T00:00:00.000Z" }];
    if (p === "/workgraph/streams") return [{ id: "s1", title: "Partner launch" }];
    if (p === "/workgraph/commitments") return { items: [], summary: { confirmed: 0, awaiting: 0, pastDue: 0, suggestions: 0 } };
    return undefined;
  });
  await expect(page.getByRole("heading", { level: 1, name: "Sema — Decisions & Dependencies" })).toBeVisible({ timeout: 60_000 });
  return api;
}

const list = (page: Page) => page.getByTestId("decision-list");
const detail = (page: Page) => page.getByTestId("decision-detail");

test("shows the decision register with owners, review dates, status and impact", async ({ page }) => {
  await open(page);
  const stats = page.getByTestId("decision-stats");
  await expect(stats).toContainText("Recorded decisions");
  await expect(stats).toContainText("Awaiting approval");
  await expect(stats).toContainText("Blocked deliverables");
  await expect(stats).toContainText("Alet suggestion");
  const first = list(page).getByRole("button", { name: /Approve partner launch messaging/ });
  await expect(first).toContainText("Comms Lead");
  await expect(first).toContainText("26 Oct · 11:00");
  await expect(first).toContainText("Pending");
  await expect(first).toContainText("2 blocked");
  await expect(list(page).getByRole("button", { name: /Confirm pilot scope/ })).toContainText("Approved");
  await expect(list(page).getByRole("button", { name: /Confirm pilot scope/ })).toContainText("0 blocked");
  await expect(list(page).getByRole("button", { name: /Replace legacy template rule/ })).toContainText("Superseded");
  await expect(detail(page).getByTestId("detail-title")).toHaveText("Approve partner launch messaging");
  await expect(detail(page)).toContainText("Launch Sponsor");
  await expect(detail(page)).toContainText("2 deliverables blocked: Partner email sequence, Release notes");
  await expect(detail(page).getByTestId("decision-evidence")).toContainText("Private source content remains restricted to authorized users.");
  await shot(page, "workgraph-2-decisions");
  await expectNothingClipped(page);
});

test("offers approval only to the authorised approver, and says who is for everyone else", async ({ page }) => {
  await open(page);
  // Not the approver: disabled, with the reason.
  const review = detail(page).getByRole("button", { name: "Review approval" });
  await expect(review).toBeDisabled();
  await expect(detail(page)).toContainText("Only Launch Sponsor can approve this.");
  // The approver can.
  await list(page).getByRole("button", { name: /Approve retention matrix/ }).click();
  await expect(detail(page).getByTestId("detail-title")).toHaveText("Approve retention matrix");
  await expect(detail(page).getByRole("button", { name: "Review approval" })).toBeEnabled();
  // A replaced decision is final.
  await list(page).getByRole("button", { name: /Replace legacy template rule/ }).click();
  await expect(detail(page).getByRole("button", { name: "Review approval" })).toBeDisabled();
});

test("approves with a note, and the outcome is shown with who gave it", async ({ page }) => {
  const api = await open(page);
  await list(page).getByRole("button", { name: /Approve retention matrix/ }).click();
  await detail(page).getByRole("button", { name: "Review approval" }).click();
  const d = page.getByRole("dialog");
  await expect(d).toContainText("Your outcome is recorded against your name.");
  await expect(d.getByRole("radio", { name: "Approve" })).toBeChecked();
  await d.getByLabel("Note (optional)").fill("Go ahead");
  await d.getByRole("button", { name: "Approve decision" }).click();
  await expect.poll(() => api.writes.find((w) => w.path === "/workgraph/decisions/d2/decision")?.body).toEqual({ outcome: "APPROVED", note: "Go ahead" });
  await expect(list(page).getByRole("button", { name: /Approve retention matrix/ })).toContainText("Approved");
  await expect(detail(page)).toContainText("Approved by");
  await expect(detail(page)).toContainText("Michael Irvine");
});

test("defers, and replacing needs another decision chosen", async ({ page }) => {
  const api = await open(page);
  await list(page).getByRole("button", { name: /Approve retention matrix/ }).click();
  await detail(page).getByRole("button", { name: "Review approval" }).click();
  const d = page.getByRole("dialog");
  await d.getByRole("radio", { name: "Replace with another decision" }).check();
  await d.getByRole("button", { name: "Replace decision" }).click();
  await expect(d).toContainText("Choose the decision that replaces it.");
  expect(api.writes.some((w) => w.path.endsWith("/decision"))).toBe(false);
  await d.getByLabel("Replaced by").selectOption({ label: "Confirm pilot scope" });
  await d.getByRole("button", { name: "Replace decision" }).click();
  await expect.poll(() => api.writes.find((w) => w.path === "/workgraph/decisions/d2/decision")?.body).toEqual({ outcome: "SUPERSEDED", supersededById: "d3" });
});

test("shows the server's refusal when someone else's approval is attempted", async ({ page }) => {
  await open(page);
  // The first decision is not ours to approve; open the dialog the only way the stub allows.
  await list(page).getByRole("button", { name: /Approve retention matrix/ }).click();
  await detail(page).getByRole("button", { name: "Review approval" }).click();
  const d = page.getByRole("dialog");
  await page.route("**/api/v1/workgraph/decisions/d2/decision", (route) =>
    route.fulfill({ status: 403, contentType: "application/json", body: JSON.stringify({ success: false, error: { code: "FORBIDDEN", message: "Only Launch Sponsor can give an outcome on this decision." }, requestId: "e2e" }) })
  );
  await d.getByRole("button", { name: "Approve decision" }).click();
  await expect(d.getByRole("alert")).toContainText("Only Launch Sponsor can give an outcome on this decision.");
});

test("records a decision, and an approver must be a colleague", async ({ page }) => {
  const api = await open(page);
  await page.getByRole("button", { name: "Record decision" }).first().click();
  const d = page.getByRole("dialog");
  await d.getByLabel("The decision").fill("Adopt the new retention policy");
  await d.getByLabel("What needs deciding, and why").fill("Aligns with the data policy.");
  await d.getByLabel("Authorized approver").fill("The steering group");
  await d.getByRole("button", { name: "Record decision" }).click();
  await expect(d).toContainText("Choose a colleague");
  expect(api.writes.some((w) => w.method === "POST" && w.path === "/workgraph/decisions")).toBe(false);
  await d.getByLabel("Authorized approver").fill("pri");
  await d.getByRole("option", { name: /Priya Shah/ }).click();
  await d.getByRole("button", { name: "Record decision" }).click();
  await expect.poll(() => api.writes.find((w) => w.method === "POST" && w.path === "/workgraph/decisions")?.body).toMatchObject({
    title: "Adopt the new retention policy",
    rationale: "Aligns with the data policy.",
    approverEmail: "priya@acme.test",
    visibility: "PRIVATE",
  });
});

test("filters by tab", async ({ page }) => {
  const api = await open(page);
  await page.getByRole("tab", { name: /Awaiting approval/ }).click();
  await expect(list(page).getByRole("button")).toHaveCount(2);
  expect(api.requests.some((r) => r.path === "/workgraph/decisions" && r.query.tab === "awaiting")).toBe(true);
  await page.getByRole("tab", { name: "Approved" }).click();
  await expect(list(page).getByRole("button")).toHaveCount(1);
});

test("lists dependencies with what they wait on, and resolves or removes one", async ({ page }) => {
  const api = await open(page, "/mail/work-graph/dependencies");
  const table = page.getByTestId("dependency-table");
  await expect(page.getByRole("tab", { name: /Dependencies/ })).toHaveAttribute("aria-selected", "true");
  const rows = table.getByTestId("dependency-row");
  await expect(rows).toHaveCount(3);
  await expect(rows.nth(0)).toContainText("Partner email sequence");
  await expect(rows.nth(0)).toContainText("Waiting on approval");
  await expect(rows.nth(0)).toContainText("Approve partner launch messaging");
  await expect(rows.nth(1)).toContainText("Blocked · owner notified");
  await expect(rows.nth(2)).toContainText("Unblocked");
  await shot(page, "workgraph-3-dependencies");

  await rows.nth(0).getByRole("button", { name: "Resolve" }).click();
  await expect.poll(() => api.writes.find((w) => w.method === "PATCH" && w.path === "/workgraph/dependencies/p1")?.body).toEqual({ resolved: true });
  await expect(rows.nth(0)).toContainText("Unblocked");
  await rows.nth(1).getByRole("button", { name: "Remove Release communications" }).click();
  await expect.poll(() => api.writes.some((w) => w.method === "DELETE" && w.path === "/workgraph/dependencies/p2")).toBe(true);
  await expect(rows).toHaveCount(2);
});

test("adds a dependency waiting on a decision", async ({ page }) => {
  const api = await open(page, "/mail/work-graph/dependencies");
  await page.getByRole("button", { name: "Add dependency" }).first().click();
  const d = page.getByRole("dialog");
  await d.getByLabel("What is blocked").fill("Customer announcement");
  await d.getByRole("button", { name: "Add dependency" }).click();
  await expect(d).toContainText("Choose what it is waiting on.");
  await d.getByLabel("Which one").selectOption({ label: "Approve partner launch messaging" });
  await d.getByRole("button", { name: "Add dependency" }).click();
  await expect.poll(() => api.writes.find((w) => w.method === "POST" && w.path === "/workgraph/dependencies")?.body).toMatchObject({
    deliverable: "Customer announcement",
    blockerType: "DECISION",
    blockerId: "d1",
    visibility: "PRIVATE",
  });
  // Only open decisions can be waited on.
  await page.getByRole("button", { name: "Add dependency" }).first().click();
  const again = page.getByRole("dialog");
  const options = await again.getByLabel("Which one").locator("option").allTextContents();
  expect(options).not.toContain("Confirm pilot scope");
  expect(options).not.toContain("Replace legacy template rule");
});

test("suggested decisions are confirmed by a person", async ({ page }) => {
  await open(page);
  await page.getByRole("tab", { name: /Suggested/ }).click();
  const suggestions = page.getByTestId("suggestion-list");
  await expect(suggestions).toContainText("Approve the pricing change");
  await expect(suggestions).toContainText("only the authorized approver can grant it");
});

test("nothing is clipped on a short window: the table shows whole rows and the tabs have no scrollbar", async ({ page }) => {
  await open(page, "/mail/work-graph/dependencies");
  await page.setViewportSize({ width: 1900, height: 640 });
  const table = page.getByTestId("dependency-table");
  const rows = table.getByTestId("dependency-row");
  await expect(rows).toHaveCount(3);

  // Whole table: its content is not taller than the box that holds it.
  const clipped = await table.evaluate((el) => el.scrollHeight - el.clientHeight);
  expect(clipped, "the table's contents are cut off").toBeLessThanOrEqual(0);
  // Every row is fully inside the table's box once scrolled to.
  await rows.last().scrollIntoViewIfNeeded();
  const tableBox = (await table.boundingBox())!;
  const lastBox = (await rows.last().boundingBox())!;
  expect(lastBox.y + lastBox.height, "the last row spills past the table").toBeLessThanOrEqual(tableBox.y + tableBox.height + 1);

  // The tab strip scrolls sideways when it must, never up and down: it draws no vertical scrollbar.
  const tabs = page.getByRole("tablist", { name: "Decisions" });
  expect(await tabs.evaluate((el) => (el as HTMLElement).offsetWidth - el.clientWidth), "the tabs show a vertical scrollbar").toBeLessThanOrEqual(0);
  expect(await tabs.evaluate((el) => getComputedStyle(el).overflowY)).toBe("hidden");
  await shot(page, "workgraph-6-dependencies-short");
});

// `me` is referenced so the fixture helpers stay in step with the harness.
void me;
