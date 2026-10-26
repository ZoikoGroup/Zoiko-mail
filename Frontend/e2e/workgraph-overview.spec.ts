import { test, expect, type Page } from "@playwright/test";
import { noContent, openWorkGraph, shot } from "./workgraph-harness";

/**
 * Work Graph — Overview, against an in-memory stand-in for the API.
 *
 * What these protect: the map draws exactly the nodes and lines the server
 * says exist; selecting a node shows its own details and sources; filters ask
 * the server (or hide a kind) rather than pretend; a source the viewer cannot
 * open cannot be "viewed"; and cutting a link only removes the link.
 */

const evidence = (id: string, kind: string, label: string, openPath: string | null) => ({ id, kind, label, occurredAt: "2026-10-20T09:00:00.000Z", refId: openPath ? "ref-1" : null, canOpen: Boolean(openPath), openPath, addedByMe: true });

function node(id: string, type: string, title: string, subtitle: string, tone: string, detail: Record<string, unknown> = {}) {
  return {
    id,
    type,
    title,
    subtitle,
    tone,
    detail: { eyebrow: "Selected object", description: null, pills: ["Scoped to your access"], rows: [], evidence: [], sourcePath: null, sourceLabel: "View source", reviewPath: null, ...detail },
  };
}

const STREAM = { id: "s1", title: "Q4 Launch Readiness", description: "Coordinates launch preparation.", owner: { kind: "TEAM", name: "Launch Operations", email: null, isMe: false }, nextCheckpointAt: "2026-10-27T10:00:00.000Z", timeZone: "Europe/London", status: "ACTIVE", visibility: "WORKSPACE", counts: { commitments: 2, decisions: 1, dependencies: 1 }, canEdit: true, isCreator: true, evidence: [] };

function overview(links = "confirmed") {
  const nodes = [
    node("STREAM:s1", "STREAM", "Q4 Launch Readiness", "Workstream · Active", "info", {
      description: "Coordinates launch preparation across correspondence, decisions, meetings and tasks.",
      pills: ["Scoped to your access", "Evidence linked"],
      rows: [["Accountable owner", "Launch Operations"], ["Next checkpoint", "27 Oct 2026"], ["Confirmed connections", "6 evidence-backed links"]],
      evidence: [evidence("ev-s", "EMAIL", "Creative sign-off", "/mail?open=msg-1&folder=INBOX")],
      sourcePath: "/mail?open=msg-1&folder=INBOX",
      reviewPath: "/mail/work-graph/commitments",
    }),
    node("OWNER:Launch Operations", "OWNER", "Launch operations", "Accountable owner", "ok", { rows: [["Role", "Accountable owner"]] }),
    node("COMMITMENT:c1", "COMMITMENT", "Partner response", "Commitment · Awaited", "warn", {
      rows: [["Accountable owner", "Partner Relations"], ["Due", "26 Oct 2026"], ["Status", "Awaiting"]],
      evidence: [evidence("ev-c", "EMAIL", "Creative sign-off", "/mail?open=msg-1&folder=INBOX")],
      sourcePath: "/mail?open=msg-1&folder=INBOX",
      reviewPath: "/mail/work-graph/commitments?id=c1",
    }),
    node("DECISION:d1", "DECISION", "Launch date approved", "Decision · Recorded", "ok", { rows: [["Decision owner", "Comms Lead"], ["Status", "Approved"]], reviewPath: "/mail/work-graph/decisions?id=d1" }),
    node("DELIVERABLE:p1", "DELIVERABLE", "Release communications", "Deliverable · Blocked", "crit", { rows: [["Waiting on", "Launch date approved"]], reviewPath: "/mail/work-graph/dependencies?id=p1" }),
    node("EMAIL:ev-c", "EMAIL", "Creative sign-off", "Email thread · 20 Oct", "info", { pills: ["Scoped to your access", "Evidence linked"], sourcePath: "/mail?open=msg-1&folder=INBOX" }),
    node("MEETING:ev-m", "MEETING", "Restricted meeting", "Meeting · 21 Oct", "info", { pills: ["Scoped to your access", "Restricted source"], sourcePath: null }),
  ];
  const edges = [
    { from: "OWNER:Launch Operations", to: "STREAM:s1", kind: "CONFIRMED" },
    { from: "STREAM:s1", to: "COMMITMENT:c1", kind: "CONFIRMED" },
    { from: "STREAM:s1", to: "DECISION:d1", kind: "CONFIRMED" },
    { from: "STREAM:s1", to: "DELIVERABLE:p1", kind: "CONFIRMED" },
    { from: "EMAIL:ev-c", to: "COMMITMENT:c1", kind: "CONFIRMED" },
    { from: "MEETING:ev-m", to: "DECISION:d1", kind: "CONFIRMED" },
  ];
  if (links === "all") {
    nodes.push(node("SUGGESTION:s-a", "SUGGESTION", "Support sign-off → launch plan", "Suggested · review required", "info", { eyebrow: "Suggested by Alet", pills: ["Unconfirmed", "Review required"], rows: [["Status", "Not a commitment until you confirm it"]] }));
    edges.push({ from: "SUGGESTION:s-a", to: "STREAM:s1", kind: "SUGGESTED" });
  }
  return {
    streams: [{ id: "s1", title: "Q4 Launch Readiness" }, { id: "s2", title: "Data migration" }],
    stream: STREAM,
    nodes,
    edges,
    hidden: 0,
    attention: {
      commitments: [{ id: "c1", title: "Partner response awaited", due: "26 Oct", pastDue: true }, { id: "c2", title: "Finalize release notes", due: "27 Oct", pastDue: false }],
      suggestions: [{ id: "s-a", title: "Support sign-off → launch plan", kind: "COMMITMENT" }],
      pendingDecisions: 1,
    },
    suggestions: 1,
  };
}

async function open(page: Page, { empty = false, path = "/mail/work-graph" } = {}) {
  const api = await openWorkGraph(page, path, ({ path: p, method, url, body }) => {
    if (p === "/workgraph/overview") return empty ? { streams: [], stream: null, nodes: [], edges: [], hidden: 0, attention: { commitments: [], suggestions: [], pendingDecisions: 0 }, suggestions: 0 } : overview(url.searchParams.get("links") ?? "confirmed");
    if (p === "/workgraph/streams" && method === "GET") return [STREAM, { ...STREAM, id: "s2", title: "Data migration" }];
    if (p === "/workgraph/streams" && method === "POST") return { ...STREAM, id: "s-new", title: body.title };
    if (p === "/workgraph/commitments" && method === "GET") return { items: [{ id: "c1", title: "Partner response", canEdit: true, status: "AWAITING", display: "AWAITING", owner: { kind: "TEAM", name: "Partner Relations", email: null, isMe: false }, stream: { id: "s1", title: "Q4 Launch Readiness" }, evidence: [], blocking: { blocked: 0, deliverables: [] }, timeZone: "UTC", dueAt: null, expectedFrom: null, description: null, visibility: "PRIVATE", recordedAt: null, fromSuggestion: false, createdBy: { name: "M", email: "m@x", isMe: true }, isMine: false, isCreator: true, createdAt: "", updatedAt: "" }], summary: { confirmed: 1, awaiting: 1, pastDue: 0, suggestions: 0 } };
    if (p === "/workgraph/decisions" && method === "GET") return { items: [], summary: { recorded: 0, awaiting: 0, blocked: 0, suggestions: 0 } };
    if (p === "/workgraph/dependencies" && method === "GET") return [];
    if (p === "/workgraph/commitments/c1" && method === "PATCH") return { id: "c1" };
    if (p === "/workgraph/dependencies/p1" && method === "PATCH") return { id: "p1" };
    if (p.startsWith("/workgraph/evidence/") && method === "DELETE") return noContent();
    if (p === "/workgraph/evidence" && method === "POST") return [evidence("ev-new", "EMAIL", "Launch partner handoff", "/mail?open=msg-2&folder=INBOX")];
    return undefined;
  });
  await expect(page.getByRole("heading", { level: 1, name: "Sema Work Graph" })).toBeVisible({ timeout: 60_000 });
  return api;
}

const canvas = (page: Page) => page.getByTestId("graph-canvas");
const panel = (page: Page) => page.getByTestId("node-panel");

test("draws the workstream with its owner, items and sources, and opens the workstream in the panel", async ({ page }) => {
  await open(page);
  await expect(page.getByRole("button", { name: /Q4 Launch Readiness, Workstream/ })).toBeVisible();
  for (const type of ["OWNER", "COMMITMENT", "DECISION", "DELIVERABLE", "EMAIL", "MEETING"]) await expect(canvas(page).locator(`[data-node="${type}"]`)).toHaveCount(1);
  await expect(canvas(page).locator("line[data-edge='CONFIRMED']")).toHaveCount(6);
  await expect(canvas(page).locator("line[data-edge='SUGGESTED']")).toHaveCount(0);
  await expect(page.getByText("7 objects")).toBeVisible();
  await expect(page.getByText("Confirmed relationship")).toBeVisible();
  await expect(page.getByText("Suggested (review required)")).toBeVisible();

  await expect(panel(page).getByTestId("node-title")).toHaveText("Q4 Launch Readiness");
  await expect(panel(page)).toContainText("Coordinates launch preparation");
  await expect(panel(page)).toContainText("Evidence linked");
  await expect(panel(page)).toContainText("Accountable owner");
  await expect(panel(page)).toContainText("Launch Operations");
  await expect(panel(page)).toContainText("6 evidence-backed links");
  await expect(panel(page)).toContainText("Email: Creative sign-off");
  await shot(page, "workgraph-4-overview");
});

test("selecting a node shows that object, and its source opens only if the viewer can open it", async ({ page }) => {
  const api = await open(page);
  await canvas(page).locator("[data-node='COMMITMENT']").click();
  await expect(panel(page).getByTestId("node-title")).toHaveText("Partner response");
  await expect(panel(page)).toContainText("Partner Relations");
  await expect(panel(page)).toContainText("Awaiting");
  await expect(panel(page).getByRole("button", { name: "View source" })).toBeEnabled();

  await canvas(page).locator("[data-node='MEETING']").click();
  await expect(panel(page).getByTestId("node-title")).toHaveText("Restricted meeting");
  await expect(panel(page)).toContainText("Restricted source");
  await expect(panel(page).getByRole("button", { name: "View source" })).toBeDisabled();

  await canvas(page).locator("[data-node='EMAIL']").click();
  await panel(page).getByRole("button", { name: "View source" }).click();
  // The Mail page reads the link (?open=…&folder=…) and tidies the address bar.
  await expect(page).toHaveURL(/\/mail$/);
  await expect.poll(() => api.requests.some((r) => r.path === "/mail" && r.query.folder === "INBOX")).toBe(true);
});

test("switches to a list of the same objects", async ({ page }) => {
  await open(page);
  await page.getByRole("tab", { name: "List" }).click();
  const list = page.getByTestId("graph-list");
  await expect(list.getByRole("button")).toHaveCount(7);
  await list.getByRole("button", { name: /Launch date approved/ }).click();
  await expect(panel(page).getByTestId("node-title")).toHaveText("Launch date approved");
  await page.getByRole("tab", { name: "Graph" }).click();
  await expect(canvas(page)).toBeVisible();
});

test("hides a kind of object from the map without asking the server", async ({ page }) => {
  const api = await open(page);
  const before = api.requests.filter((r) => r.path === "/workgraph/overview").length;
  await page.getByRole("button", { name: "Filters" }).click();
  await page.getByRole("checkbox", { name: "Sources" }).uncheck();
  await expect(canvas(page).locator("[data-node='EMAIL']")).toHaveCount(0);
  await expect(canvas(page).locator("[data-node='MEETING']")).toHaveCount(0);
  await expect(canvas(page).locator("[data-node='COMMITMENT']")).toHaveCount(1);
  await expect(canvas(page).locator("line[data-edge]")).toHaveCount(4);
  await expect(page.getByText("5 objects")).toBeVisible();
  expect(api.requests.filter((r) => r.path === "/workgraph/overview").length).toBe(before);
});

test("draws suggestions dashed, and only when asked", async ({ page }) => {
  const api = await open(page);
  await page.getByLabel("Links").selectOption("all");
  await expect(canvas(page).locator("[data-node='SUGGESTION']")).toHaveCount(1);
  await expect(canvas(page).locator("line[data-edge='SUGGESTED']")).toHaveCount(1);
  expect(api.requests.some((r) => r.path === "/workgraph/overview" && r.query.links === "all")).toBe(true);
  await canvas(page).locator("[data-node='SUGGESTION']").click();
  await expect(panel(page)).toContainText("Suggested by Alet");
  await expect(panel(page)).toContainText("Not a commitment until you confirm it");
});

test("scope, time window, workstream and search all go to the server", async ({ page }) => {
  const api = await open(page);
  await page.getByLabel("Scope").selectOption("owned");
  await expect.poll(() => api.requests.some((r) => r.path === "/workgraph/overview" && r.query.scope === "owned")).toBe(true);
  await page.getByLabel("Time window").selectOption("90");
  await expect.poll(() => api.requests.some((r) => r.query.days === "90")).toBe(true);
  await page.getByLabel("Workstream", { exact: true }).selectOption("s2");
  await expect.poll(() => api.requests.some((r) => r.query.streamId === "s2")).toBe(true);
  await page.getByLabel("Search connected work").fill("launch");
  await expect.poll(() => api.requests.some((r) => r.query.q === "launch")).toBe(true);
});

test("cuts a link without touching the record or its source", async ({ page }) => {
  const api = await open(page);
  await canvas(page).locator("[data-node='COMMITMENT']").click();
  await panel(page).getByRole("button", { name: "Review links" }).click();
  const d = page.getByRole("dialog");
  await expect(d).toContainText("The record itself, and its sources, are kept");
  await d.getByRole("button", { name: "Remove from this workstream" }).click();
  await expect.poll(() => api.writes.find((w) => w.method === "PATCH" && w.path === "/workgraph/commitments/c1")?.body).toEqual({ streamId: null });
  await expect(d).toContainText("Removed from the workstream.");
  await d.getByRole("button", { name: "Done" }).click();

  await canvas(page).locator("[data-node='EMAIL']").click();
  await panel(page).getByRole("button", { name: "Review links" }).click();
  await expect(page.getByRole("dialog")).toContainText("The email, meeting or document is not changed.");
  await page.getByRole("dialog").getByRole("button", { name: "Remove this link" }).click();
  await expect.poll(() => api.writes.some((w) => w.method === "DELETE" && w.path === "/workgraph/evidence/ev-c")).toBe(true);
});

test("adds a relationship: puts an item in a workstream, or links a source", async ({ page }) => {
  const api = await open(page);
  await page.getByRole("button", { name: "Add relationship" }).click();
  const d = page.getByRole("dialog");
  await d.getByLabel("Commitment or decision").selectOption({ label: "Commitment · Partner response" });
  await d.getByLabel("Workstream", { exact: true }).selectOption({ label: "Data migration" });
  await d.getByRole("button", { name: "Add to workstream" }).click();
  await expect.poll(() => api.writes.find((w) => w.method === "PATCH" && w.path === "/workgraph/commitments/c1")?.body).toEqual({ streamId: "s2" });
  await expect(d).toContainText("Added to the workstream.");

  await d.getByRole("radio", { name: "Link a source" }).click();
  await d.getByLabel("Attach it to").selectOption({ label: "Commitment · Partner response" });
  await d.getByTestId("source-picker").getByRole("button", { name: /Launch partner handoff/ }).click();
  await expect.poll(() => api.writes.find((w) => w.method === "POST" && w.path === "/workgraph/evidence")?.body).toEqual({
    subjectType: "COMMITMENT",
    subjectId: "c1",
    evidence: { kind: "EMAIL", refId: "msg-2" },
  });
  await d.getByRole("radio", { name: "Blocked by" }).click();
  await expect(page.getByRole("dialog")).toContainText("Add dependency");
});

test("shows what needs attention and the integrity rules", async ({ page }) => {
  await open(page);
  await expect(page.getByText("Partner response awaited")).toBeVisible();
  await expect(page.getByText("Past due · 26 Oct")).toBeVisible();
  await expect(page.getByText("1 decision awaiting approval")).toBeVisible();
  await expect(page.getByText("Support sign-off → launch plan", { exact: true }).last()).toBeVisible();
  await expect(page.getByText("No suggestion applied automatically")).toBeVisible();
  await expect(page.getByText("Source permissions checked")).toBeVisible();
  await expect(page.getByText("Changes require attribution")).toBeVisible();
});

test("starts with a workstream when there is none, and creates one", async ({ page }) => {
  const api = await open(page, { empty: true });
  const empty = page.getByTestId("graph-empty");
  await expect(empty).toContainText("Start with a workstream");
  await empty.getByRole("button", { name: "New workstream" }).click();
  const d = page.getByRole("dialog");
  await d.getByRole("button", { name: "Create workstream" }).click();
  await expect(d).toContainText("Give the workstream a name.");
  await d.getByLabel("Name").fill("Q4 Launch Readiness");
  await d.getByLabel("Accountable owner").fill("Launch Operations");
  await d.getByLabel("Next checkpoint").fill("2026-10-27");
  await d.getByLabel("Time zone").selectOption("Europe/London");
  await d.getByRole("button", { name: "Create workstream" }).click();
  await expect.poll(() => api.writes.find((w) => w.method === "POST" && w.path === "/workgraph/streams")?.body).toMatchObject({
    title: "Q4 Launch Readiness",
    ownerLabel: "Launch Operations",
    nextCheckpointAt: "2026-10-27T10:00:00.000Z",
    timeZone: "Europe/London",
    visibility: "PRIVATE",
  });
});
