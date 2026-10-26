import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { prisma } from "../src/config/prisma.js";
import { withCrossTenant } from "../src/config/tenantScope.js";
import { lifecycleService } from "../src/modules/lifecycle/lifecycle.service.js";
import { authHeader, loginUser, registerUser } from "./helpers.js";

const app = createApp();

/**
 * The Work Graph: commitments, decisions, dependencies, evidence, Alet's
 * suggestions and the overview map.
 *
 * What these protect: privacy (a private item does not exist for anyone it was
 * not shared with); approvals only by the named approver; a deliverable
 * unblocks itself when its blocker is settled; sources are only attached if the
 * caller can open them, and are withheld from people who cannot; and nothing
 * Alet found becomes a commitment until a person confirms it.
 */

let counter = 0;
const uid = () => `${Date.now().toString(36)}${(counter++).toString(36)}`;

type Person = { email: string; token: string; userId: string; tenantId: string; membershipId: string };

async function workspace(): Promise<{ owner: Person; join: () => Promise<Person> }> {
  const reg = await registerUser(app, { email: `wg-owner-${uid()}@zoiko.test` });
  const owner: Person = { email: reg.email, token: reg.accessToken as string, userId: reg.userId, tenantId: reg.tenantId, membershipId: reg.membershipId };
  const join = async (): Promise<Person> => {
    const user = await registerUser(app, { email: `wg-member-${uid()}@zoiko.test` });
    await request(app).post("/api/v1/membership/members").set(authHeader(owner.token)).send({ email: user.email, role: "MEMBER" }).expect(201);
    const login = await loginUser(app, user.email, user.password, owner.tenantId, user.mfaSecret);
    const membership = await prisma.tenantMembership.findFirstOrThrow({ where: { tenantId: owner.tenantId, userId: user.userId } });
    return { email: user.email, token: login.accessToken as string, userId: user.userId, tenantId: owner.tenantId, membershipId: membership.id };
  };
  return { owner, join };
}

const api = (p: Person) => ({
  get: (path: string) => request(app).get(`/api/v1/workgraph${path}`).set(authHeader(p.token)),
  post: (path: string, body: object = {}) => request(app).post(`/api/v1/workgraph${path}`).set(authHeader(p.token)).send(body),
  patch: (path: string, body: object) => request(app).patch(`/api/v1/workgraph${path}`).set(authHeader(p.token)).send(body),
  del: (path: string) => request(app).delete(`/api/v1/workgraph${path}`).set(authHeader(p.token)),
});

const inDays = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString();
const bell = (p: Person) => prisma.notification.findMany({ where: { tenantId: p.tenantId, userId: p.userId } });

async function commitment(p: Person, extra: Record<string, unknown> = {}) {
  return (await api(p).post("/commitments", { title: "Confirm launch handoff", ...extra }).expect(201)).body.data as Commitment;
}
async function decision(p: Person, extra: Record<string, unknown> = {}) {
  return (await api(p).post("/decisions", { title: "Approve partner messaging", ...extra }).expect(201)).body.data as Decision;
}

interface Commitment {
  id: string;
  title: string;
  status: string;
  display: string;
  owner: { kind: string; name: string; isMe: boolean };
  evidence: Array<{ id: string; kind: string; label: string; canOpen: boolean; refId: string | null; openPath: string | null }>;
  blocking: { blocked: number };
  canEdit: boolean;
  recordedAt: string | null;
}
interface Decision {
  id: string;
  status: string;
  canDecide: boolean;
  authority: string;
  impact: { blocked: number; deliverables: string[] };
  supersededBy: { id: string } | null;
  decidedBy: string | null;
}

/** A message in the person's own inbox, so it can be linked as evidence. */
async function inboxMessage(p: Person, subject: string) {
  const mailbox = await prisma.mailbox.upsert({
    where: { membershipId: p.membershipId },
    update: {},
    create: { tenantId: p.tenantId, membershipId: p.membershipId, address: `${uid()}@zoiko.test` },
  });
  return prisma.emailMessage.create({
    data: {
      tenantId: p.tenantId,
      authorUserId: p.userId,
      subject,
      textBody: "Please confirm.",
      status: "RECEIVED",
      sentAt: new Date(),
      providerType: "GMAIL",
      providerMessageId: `wg-${uid()}`,
      fromAddress: "partner@outside.example",
      fromName: "Partner",
      mailboxItems: { create: { tenantId: p.tenantId, mailboxId: mailbox.id, folder: "INBOX", isRead: false } },
      securityFlags: {},
    },
  });
}

async function ownEvent(p: Person, title: string) {
  const calendar = (await request(app).get("/api/v1/calendar/calendars").set(authHeader(p.token)).expect(200)).body.data[0];
  const start = new Date(Date.now() + 2 * 86_400_000);
  const res = await request(app)
    .post("/api/v1/calendar/events")
    .set(authHeader(p.token))
    .send({ calendarId: calendar.id, title, startsAt: start.toISOString(), endsAt: new Date(start.getTime() + 3_600_000).toISOString() })
    .expect(201);
  return res.body.data as { id: string };
}

describe("commitments", () => {
  it("start with the caller as owner, and with sensible defaults", async () => {
    const { owner } = await workspace();
    const c = await commitment(owner);
    expect(c).toMatchObject({ status: "IN_PROGRESS", display: "IN_PROGRESS", owner: { kind: "MEMBER", isMe: true }, canEdit: true });
    const waiting = await commitment(owner, { title: "Partner replies", expectedFrom: "External partner" });
    expect(waiting.status).toBe("AWAITING");
    const team = await commitment(owner, { title: "Legal review", ownerLabel: "Legal Operations" });
    expect(team.owner).toMatchObject({ kind: "TEAM", name: "Legal Operations", isMe: false });
  });

  it("list by tab, search and window, with the numbers the page shows", async () => {
    const { owner } = await workspace();
    await commitment(owner, { title: "Mine, in progress", dueAt: inDays(3) });
    await commitment(owner, { title: "Waiting on partner", expectedFrom: "Partner", dueAt: inDays(2) });
    const late = await commitment(owner, { title: "Legal acknowledgment", dueAt: inDays(-2) });
    await commitment(owner, { title: "Other team's", ownerLabel: "Product" });
    const done = await commitment(owner, { title: "Old and recorded" });
    await api(owner).patch(`/commitments/${done.id}`, { status: "RECORDED" }).expect(200);

    const all = (await api(owner).get("/commitments").expect(200)).body.data;
    expect(all.summary).toMatchObject({ confirmed: 5, awaiting: 1, pastDue: 1, suggestions: 0 });
    expect(all.items.find((i: Commitment) => i.id === late.id).display).toBe("PAST_DUE");
    // Soonest first, undated last.
    expect(all.items[0].title).toBe("Legal acknowledgment");

    expect((await api(owner).get("/commitments?tab=awaiting").expect(200)).body.data.items.map((i: Commitment) => i.title)).toEqual(["Waiting on partner"]);
    expect((await api(owner).get("/commitments?tab=mine").expect(200)).body.data.items).toHaveLength(4);
    expect((await api(owner).get("/commitments?q=legal").expect(200)).body.data.items.map((i: Commitment) => i.title)).toEqual(["Legal acknowledgment"]);
    // Finished ones only stay while recent.
    await prisma.workCommitment.update({ where: { id: done.id }, data: { recordedAt: new Date(Date.now() - 90 * 86_400_000) } });
    expect((await api(owner).get("/commitments?days=30").expect(200)).body.data.items.map((i: Commitment) => i.title)).not.toContain("Old and recorded");
    expect((await api(owner).get("/commitments?days=0").expect(200)).body.data.items.map((i: Commitment) => i.title)).toContain("Old and recorded");
  });

  it("are private unless shared, assignable, and editable only by their creator or owner", async () => {
    const { owner, join } = await workspace();
    const colleague = await join();
    const outsider = await join();
    const priv = await commitment(owner, { title: "Private promise" });
    const shared = await commitment(owner, { title: "Shared promise", visibility: "WORKSPACE" });
    const assigned = await commitment(owner, { title: "Yours to do", ownerEmail: colleague.email });

    await api(outsider).get(`/commitments/${priv.id}`).expect(404);
    await api(outsider).patch(`/commitments/${priv.id}`, { title: "Mine now" }).expect(404);
    expect((await api(outsider).get("/commitments").expect(200)).body.data.items.map((i: Commitment) => i.title)).toEqual(["Shared promise"]);
    // Shared: readable, not editable.
    await api(outsider).patch(`/commitments/${shared.id}`, { title: "Changed" }).expect(403);
    await api(outsider).del(`/commitments/${shared.id}`).expect(403);
    // Assigned: the new owner sees it though it is private, and may update it, and was told.
    expect((await api(colleague).get(`/commitments/${assigned.id}`).expect(200)).body.data).toMatchObject({ isMine: true, canEdit: true });
    expect((await bell(colleague)).some((n) => n.title === "Commitment assigned to you: Yours to do")).toBe(true);
    await api(colleague).patch(`/commitments/${assigned.id}`, { status: "RECORDED" }).expect(200);
    // Only the creator changes who it is shared with.
    await api(colleague).patch(`/commitments/${assigned.id}`, { visibility: "WORKSPACE" }).expect(403);
    await api(owner).patch(`/commitments/${assigned.id}`, { visibility: "WORKSPACE" }).expect(200);
  });

  it("record when fulfilled, and reopen", async () => {
    const { owner } = await workspace();
    const c = await commitment(owner);
    const recorded = (await api(owner).patch(`/commitments/${c.id}`, { status: "RECORDED" }).expect(200)).body.data;
    expect(recorded.display).toBe("RECORDED");
    expect(recorded.recordedAt).toBeTruthy();
    expect((await api(owner).patch(`/commitments/${c.id}`, { status: "IN_PROGRESS" }).expect(200)).body.data.recordedAt).toBeNull();
  });

  it("reject bad input and unknown owners", async () => {
    const { owner } = await workspace();
    await api(owner).post("/commitments", { title: "" }).expect(400);
    await api(owner).post("/commitments", { title: "x", ownerEmail: "nobody@outside.example" }).expect(404);
    await api(owner).post("/commitments", { title: "x", timeZone: "Mars/Olympus" }).expect(400);
    await api(owner).post("/commitments", { title: "x", unknownField: 1 }).expect(400);
    await api(owner).patch(`/commitments/${(await commitment(owner)).id}`, {}).expect(400);
  });

  it("are isolated between workspaces", async () => {
    const a = await workspace();
    const b = await workspace();
    const c = await commitment(a.owner, { visibility: "WORKSPACE" });
    expect((await api(b.owner).get("/commitments").expect(200)).body.data.items).toEqual([]);
    await api(b.owner).get(`/commitments/${c.id}`).expect(404);
    await api(b.owner).patch(`/commitments/${c.id}`, { title: "x" }).expect(404);
  });
});

describe("evidence", () => {
  it("links a message from the caller's own mailbox, naming it by the message itself", async () => {
    const { owner } = await workspace();
    const message = await inboxMessage(owner, "Creative sign-off");
    const c = await commitment(owner, { evidence: [{ kind: "EMAIL", refId: message.id, label: "A spoofed name" }] });
    expect(c.evidence).toHaveLength(1);
    expect(c.evidence[0]).toMatchObject({ kind: "EMAIL", label: "Creative sign-off", canOpen: true, openPath: `/mail?open=${message.id}&folder=INBOX` });
  });

  it("refuses a message or meeting the caller cannot open", async () => {
    const { owner, join } = await workspace();
    const colleague = await join();
    const theirs = await inboxMessage(colleague, "Not for you");
    const meeting = await ownEvent(colleague, "Private 1:1");
    await api(owner).post("/commitments", { title: "x", evidence: [{ kind: "EMAIL", refId: theirs.id }] }).expect(404);
    await api(owner).post("/commitments", { title: "x", evidence: [{ kind: "MEETING", refId: meeting.id }] }).expect(404);
    await api(owner).post("/commitments", { title: "x", evidence: [{ kind: "EMAIL" }] }).expect(400);
  });

  it("attaches later, once per source, and removes", async () => {
    const { owner } = await workspace();
    const c = await commitment(owner);
    const meeting = await ownEvent(owner, "Release review");
    const added = await api(owner).post("/evidence", { subjectType: "COMMITMENT", subjectId: c.id, evidence: { kind: "MEETING", refId: meeting.id } }).expect(201);
    expect(added.body.data).toHaveLength(1);
    expect(added.body.data[0]).toMatchObject({ label: "Release review", canOpen: true });
    await api(owner).post("/evidence", { subjectType: "COMMITMENT", subjectId: c.id, evidence: { kind: "MEETING", refId: meeting.id } }).expect(409);
    await api(owner).post("/evidence", { subjectType: "COMMITMENT", subjectId: c.id, evidence: { kind: "DOCUMENT", label: "Launch plan v3" } }).expect(201);
    expect((await api(owner).get(`/commitments/${c.id}`).expect(200)).body.data.evidence).toHaveLength(2);
    await api(owner).del(`/evidence/${added.body.data[0].id}`).expect(204);
    expect((await api(owner).get(`/commitments/${c.id}`).expect(200)).body.data.evidence).toHaveLength(1);
  });

  it("withholds the name of a source from someone who cannot open it", async () => {
    const { owner, join } = await workspace();
    const colleague = await join();
    const meeting = await ownEvent(owner, "Confidential board prep");
    const c = await commitment(owner, { visibility: "WORKSPACE", evidence: [{ kind: "MEETING", refId: meeting.id }] });
    const seen = (await api(colleague).get(`/commitments/${c.id}`).expect(200)).body.data;
    expect(seen.evidence[0]).toMatchObject({ canOpen: false, label: "Restricted meeting", refId: null, openPath: null });
    expect(JSON.stringify(seen)).not.toContain("Confidential board prep");
    // Their own view of it is unchanged.
    expect((await api(owner).get(`/commitments/${c.id}`).expect(200)).body.data.evidence[0]).toMatchObject({ canOpen: true, label: "Confidential board prep" });
    // And a colleague cannot attach to something that is not theirs.
    await api(colleague).post("/evidence", { subjectType: "COMMITMENT", subjectId: c.id, evidence: { kind: "NOTE", label: "x" } }).expect(403);
  });
});

describe("decisions", () => {
  it("can be approved only by the named approver", async () => {
    const { owner, join } = await workspace();
    const approver = await join();
    const bystander = await join();
    const d = await decision(owner, { approverEmail: approver.email, visibility: "WORKSPACE" });
    expect(d).toMatchObject({ status: "PENDING", canDecide: false });
    expect((await bell(approver)).some((n) => n.title === "Approval requested: Approve partner messaging")).toBe(true);

    // Not the creator, not an Owner, not a bystander — only the approver.
    await api(owner).post(`/decisions/${d.id}/decision`, { outcome: "APPROVED" }).expect(403);
    await api(bystander).post(`/decisions/${d.id}/decision`, { outcome: "APPROVED" }).expect(403);
    expect((await api(approver).get(`/decisions/${d.id}`).expect(200)).body.data.canDecide).toBe(true);
    const approved = (await api(approver).post(`/decisions/${d.id}/decision`, { outcome: "APPROVED", note: "Go ahead" }).expect(200)).body.data;
    expect(approved).toMatchObject({ status: "APPROVED", decidedBy: expect.any(String), canDecide: true });
    expect((await bell(owner)).some((n) => n.title === "Decision approved: Approve partner messaging")).toBe(true);
    const trail = await prisma.auditEvent.findMany({ where: { tenantId: owner.tenantId, eventType: "WORK_DECISION_DECIDED", targetId: d.id } });
    expect(trail).toHaveLength(1);
    expect(trail[0]!.actorUserId).toBe(approver.userId);
  });

  it("with no approver named, are approved only by a workspace Owner or Admin", async () => {
    const { owner, join } = await workspace(); // the workspace Owner
    const member = await join();
    const d = await decision(member, { visibility: "WORKSPACE" });
    expect(d.authority).toMatch(/Owner or Admin/);
    await api(member).post(`/decisions/${d.id}/decision`, { outcome: "APPROVED" }).expect(403);
    await api(owner).post(`/decisions/${d.id}/decision`, { outcome: "APPROVED" }).expect(200);
  });

  it("move only where they may, and a replacement is required to supersede", async () => {
    const { owner } = await workspace();
    const a = await decision(owner, { title: "Old rule" });
    const b = await decision(owner, { title: "New rule" });
    await api(owner).post(`/decisions/${a.id}/decision`, { outcome: "SUPERSEDED" }).expect(400);
    await api(owner).post(`/decisions/${a.id}/decision`, { outcome: "SUPERSEDED", supersededById: a.id }).expect(400);
    await api(owner).post(`/decisions/${a.id}/decision`, { outcome: "DEFERRED" }).expect(200);
    await api(owner).post(`/decisions/${a.id}/decision`, { outcome: "APPROVED" }).expect(200);
    const replaced = (await api(owner).post(`/decisions/${a.id}/decision`, { outcome: "SUPERSEDED", supersededById: b.id }).expect(200)).body.data;
    expect(replaced).toMatchObject({ status: "SUPERSEDED", canDecide: false, supersededBy: { id: b.id } });
    // Final.
    const stuck = await api(owner).post(`/decisions/${a.id}/decision`, { outcome: "APPROVED" }).expect(409);
    expect(JSON.stringify(stuck.body)).toContain("INVALID_TRANSITION");
    // Settled decisions cannot be re-approved either.
    await api(owner).post(`/decisions/${b.id}/decision`, { outcome: "APPROVED" }).expect(200);
    await api(owner).post(`/decisions/${b.id}/decision`, { outcome: "DEFERRED" }).expect(409);
  });

  it("list awaiting first, count what matters, and keep an approver's view", async () => {
    const { owner, join } = await workspace();
    const approver = await join();
    await decision(owner, { title: "Pending one", approverEmail: approver.email });
    const done = await decision(owner, { title: "Settled one" });
    await api(owner).post(`/decisions/${done.id}/decision`, { outcome: "APPROVED" }).expect(200);
    const res = (await api(owner).get("/decisions").expect(200)).body.data;
    expect(res.items.map((i: { title: string }) => i.title)).toEqual(["Pending one", "Settled one"]);
    expect(res.summary).toMatchObject({ recorded: 2, awaiting: 1, blocked: 0 });
    expect((await api(owner).get("/decisions?tab=approved").expect(200)).body.data.items).toHaveLength(1);
    // A private decision still reaches the person named to approve it.
    expect((await api(approver).get("/decisions").expect(200)).body.data.items.map((i: { title: string }) => i.title)).toEqual(["Pending one"]);
  });

  it("cannot be changed by the approver, only decided", async () => {
    const { owner, join } = await workspace();
    const approver = await join();
    const d = await decision(owner, { approverEmail: approver.email });
    await api(approver).patch(`/decisions/${d.id}`, { title: "Rewritten" }).expect(403);
    await api(owner).patch(`/decisions/${d.id}`, { rationale: "Because." }).expect(200);
    await api(owner).post(`/decisions/${d.id}/decision`, { outcome: "APPROVED" }).expect(403);
    await api(approver).post(`/decisions/${d.id}/decision`, { outcome: "APPROVED" }).expect(200);
    await api(owner).patch(`/decisions/${d.id}`, { approverEmail: owner.email }).expect(409);
  });
});

describe("dependencies", () => {
  it("wait on a decision, unblock when it is approved, and tell the owner", async () => {
    const { owner, join } = await workspace();
    const member = await join();
    const d = await decision(owner, { visibility: "WORKSPACE" });
    const dep = (
      await api(owner).post("/dependencies", { deliverable: "Partner email sequence", ownerEmail: member.email, blockerType: "DECISION", blockerId: d.id }).expect(201)
    ).body.data;
    expect(dep).toMatchObject({ state: "WAITING", stateLabel: "Waiting on approval", blocker: { type: "DECISION", id: d.id } });
    expect((await bell(member)).some((n) => n.title === "Blocked: Partner email sequence")).toBe(true);
    expect((await api(owner).get(`/decisions/${d.id}`).expect(200)).body.data.impact).toMatchObject({ blocked: 1, deliverables: ["Partner email sequence"] });
    expect((await api(owner).get("/decisions").expect(200)).body.data.summary.blocked).toBe(1);

    await api(owner).post(`/decisions/${d.id}/decision`, { outcome: "APPROVED" }).expect(200);
    const after = (await api(owner).get("/dependencies").expect(200)).body.data[0];
    expect(after).toMatchObject({ state: "UNBLOCKED", stateLabel: "Unblocked" });
    expect(after.resolvedAt).toBeTruthy();
    expect((await bell(member)).some((n) => n.title === "Unblocked: Partner email sequence")).toBe(true);
    expect((await api(owner).get(`/decisions/${d.id}`).expect(200)).body.data.impact.blocked).toBe(0);
  });

  it("become blocked, once, when the decision is deferred", async () => {
    const { owner, join } = await workspace();
    const member = await join();
    const d = await decision(owner);
    await api(owner).post("/dependencies", { deliverable: "Release communications", ownerEmail: member.email, blockerType: "DECISION", blockerId: d.id }).expect(201);
    await api(owner).post(`/decisions/${d.id}/decision`, { outcome: "DEFERRED", note: "Next quarter" }).expect(200);
    const dep = (await api(owner).get("/dependencies").expect(200)).body.data[0];
    expect(dep).toMatchObject({ state: "BLOCKED", stateLabel: "Blocked · owner notified" });
    const told = (await bell(member)).filter((n) => n.title === "Blocked: Release communications");
    // Told when it was created; deferring does not repeat it.
    expect(told).toHaveLength(1);
  });

  it("wait on a commitment, and unblock when it is recorded", async () => {
    const { owner } = await workspace();
    const c = await commitment(owner, { title: "Legal sign-off", dueAt: inDays(5) });
    await api(owner).post("/dependencies", { deliverable: "Press release", blockerType: "COMMITMENT", blockerId: c.id }).expect(201);
    expect((await api(owner).get("/dependencies").expect(200)).body.data[0]).toMatchObject({ state: "WAITING", stateLabel: "Waiting on commitment" });
    expect((await api(owner).get(`/commitments/${c.id}`).expect(200)).body.data.blocking.blocked).toBe(1);
    await api(owner).patch(`/commitments/${c.id}`, { status: "RECORDED" }).expect(200);
    expect((await api(owner).get("/dependencies").expect(200)).body.data[0].state).toBe("UNBLOCKED");
  });

  it("show as blocked when what they wait on is overdue, and refuse a blocker already settled", async () => {
    const { owner } = await workspace();
    const late = await commitment(owner, { title: "Overdue thing", dueAt: inDays(-3) });
    await api(owner).post("/dependencies", { deliverable: "Needs it", blockerType: "COMMITMENT", blockerId: late.id }).expect(201);
    expect((await api(owner).get("/dependencies").expect(200)).body.data[0].state).toBe("BLOCKED");
    const done = await decision(owner);
    await api(owner).post(`/decisions/${done.id}/decision`, { outcome: "APPROVED" }).expect(200);
    await api(owner).post("/dependencies", { deliverable: "Too late", blockerType: "DECISION", blockerId: done.id }).expect(409);
  });

  it("cannot be created on something the caller cannot see, and hold back deleting their blocker", async () => {
    const { owner, join } = await workspace();
    const colleague = await join();
    const hidden = await decision(owner, { title: "Private decision" });
    await api(colleague).post("/dependencies", { deliverable: "Sneaky", blockerType: "DECISION", blockerId: hidden.id }).expect(404);
    await api(owner).post("/dependencies", { deliverable: "Waiting", blockerType: "DECISION", blockerId: hidden.id }).expect(201);
    const refused = await api(owner).del(`/decisions/${hidden.id}`).expect(409);
    expect(JSON.stringify(refused.body)).toContain("HAS_DEPENDENCIES");
  });

  it("can be resolved by hand and deleted by their creator", async () => {
    const { owner, join } = await workspace();
    const colleague = await join();
    const d = await decision(owner, { visibility: "WORKSPACE" });
    const dep = (await api(owner).post("/dependencies", { deliverable: "Manual", blockerType: "DECISION", blockerId: d.id, visibility: "WORKSPACE" }).expect(201)).body.data;
    await api(colleague).patch(`/dependencies/${dep.id}`, { resolved: true }).expect(403);
    expect((await api(owner).patch(`/dependencies/${dep.id}`, { resolved: true }).expect(200)).body.data.state).toBe("UNBLOCKED");
    await api(colleague).del(`/dependencies/${dep.id}`).expect(403);
    await api(owner).del(`/dependencies/${dep.id}`).expect(204);
    expect((await api(owner).get("/dependencies").expect(200)).body.data).toEqual([]);
  });
});

describe("Alet's suggestions", () => {
  async function suggest(p: Person, text: string, extra: { actionType?: "COMMITMENT_EXTRACTION" | "APPROVAL"; messageId?: string } = {}) {
    return prisma.aIAction.create({
      data: {
        tenantId: p.tenantId,
        createdByUserId: p.userId,
        actionType: extra.actionType ?? "COMMITMENT_EXTRACTION",
        messageId: extra.messageId ?? null,
        inputHash: `h-${uid()}`,
        output: { text, dueAt: inDays(4), priority: "HIGH" },
        sourceExcerpt: "…I will send it by Friday…",
        confidenceScore: 0.8,
        status: "COMPLETED",
      },
    });
  }

  it("are only suggestions until a person confirms them, then become real, with the email as evidence", async () => {
    const { owner } = await workspace();
    const message = await inboxMessage(owner, "Launch handoff");
    const s = await suggest(owner, "Send the handoff summary by Friday", { messageId: message.id });
    expect((await api(owner).get("/commitments").expect(200)).body.data).toMatchObject({ items: [], summary: { confirmed: 0, suggestions: 1 } });
    const listed = (await api(owner).get("/suggestions").expect(200)).body.data;
    expect(listed).toHaveLength(1);
    expect(listed[0]).toMatchObject({ kind: "COMMITMENT", title: "Send the handoff summary by Friday", source: { subject: "Launch handoff" } });

    const confirmed = (await api(owner).post(`/suggestions/${s.id}/confirm`, { ownerLabel: "Client Success" }).expect(201)).body.data;
    expect(confirmed.kind).toBe("COMMITMENT");
    expect(confirmed.item).toMatchObject({ title: "Send the handoff summary by Friday", fromSuggestion: true, owner: { name: "Client Success" } });
    expect(confirmed.item.evidence[0]).toMatchObject({ kind: "EMAIL", label: "Launch handoff" });
    expect((await prisma.aIAction.findUniqueOrThrow({ where: { id: s.id } })).status).toBe("CONFIRMED");
    expect((await api(owner).get("/suggestions").expect(200)).body.data).toEqual([]);
    await api(owner).post(`/suggestions/${s.id}/confirm`, {}).expect(404);
  });

  it("record an approval it spotted as a pending decision — never an approved one", async () => {
    const { owner } = await workspace();
    const s = await suggest(owner, "Approve the retention matrix", { actionType: "APPROVAL" });
    const confirmed = (await api(owner).post(`/suggestions/${s.id}/confirm`, {}).expect(201)).body.data;
    expect(confirmed.kind).toBe("DECISION");
    expect(confirmed.item).toMatchObject({ status: "PENDING", fromSuggestion: true });
  });

  it("can be dismissed, and belong only to the person they were found for", async () => {
    const { owner, join } = await workspace();
    const colleague = await join();
    const s = await suggest(owner, "Follow up with finance");
    expect((await api(colleague).get("/suggestions").expect(200)).body.data).toEqual([]);
    await api(colleague).post(`/suggestions/${s.id}/confirm`, {}).expect(404);
    await api(colleague).post(`/suggestions/${s.id}/dismiss`).expect(404);
    await api(owner).post(`/suggestions/${s.id}/dismiss`).expect(204);
    expect((await prisma.aIAction.findUniqueOrThrow({ where: { id: s.id } })).status).toBe("DISMISSED");
    expect((await api(owner).get("/suggestions").expect(200)).body.data).toEqual([]);
  });
});

describe("workstreams and the overview", () => {
  it("start empty, then draw the stream with its owner, items and sources", async () => {
    const { owner } = await workspace();
    expect((await api(owner).get("/overview").expect(200)).body.data).toMatchObject({ streams: [], stream: null, nodes: [], edges: [] });

    const stream = (await api(owner).post("/streams", { title: "Q4 Launch Readiness", ownerLabel: "Launch Operations", description: "Coordinates the launch." }).expect(201)).body.data;
    const message = await inboxMessage(owner, "Creative sign-off");
    const c = await commitment(owner, { title: "Partner launch confirmation", streamId: stream.id, dueAt: inDays(-1), evidence: [{ kind: "EMAIL", refId: message.id }] });
    const d = await decision(owner, { title: "Launch date approved", streamId: stream.id });
    await api(owner).post("/dependencies", { deliverable: "Release communications", streamId: stream.id, blockerType: "DECISION", blockerId: d.id }).expect(201);

    const map = (await api(owner).get("/overview").expect(200)).body.data;
    expect(map.stream).toMatchObject({ id: stream.id, title: "Q4 Launch Readiness", counts: { commitments: 1, decisions: 1, dependencies: 1 } });
    const types = map.nodes.map((n: { type: string }) => n.type).sort();
    expect(types).toEqual(["COMMITMENT", "DECISION", "DELIVERABLE", "EMAIL", "OWNER", "STREAM"]);
    // Every line joins two nodes that are on the map.
    const ids = new Set(map.nodes.map((n: { id: string }) => n.id));
    for (const e of map.edges) {
      expect(ids.has(e.from) && ids.has(e.to)).toBe(true);
      expect(e.kind).toBe("CONFIRMED");
    }
    const center = map.nodes.find((n: { type: string }) => n.type === "STREAM");
    expect(center.detail.rows).toEqual(expect.arrayContaining([["Accountable owner", "Launch Operations"], ["Confirmed connections", "5 evidence-backed links"]]));
    const late = map.nodes.find((n: { id: string }) => n.id === `COMMITMENT:${c.id}`);
    expect(late).toMatchObject({ tone: "crit", subtitle: "Commitment · Past due" });
    expect(late.detail.evidence[0]).toMatchObject({ label: "Creative sign-off", canOpen: true });
    expect(map.attention.commitments.map((a: { title: string }) => a.title)).toContain("Partner launch confirmation");
    expect(map.attention.pendingDecisions).toBe(1);
  });

  it("show only what the caller may see, and filter by owner", async () => {
    const { owner, join } = await workspace();
    const colleague = await join();
    const stream = (await api(owner).post("/streams", { title: "Shared launch", visibility: "WORKSPACE" }).expect(201)).body.data;
    await commitment(owner, { title: "Private inside shared", streamId: stream.id });
    await commitment(owner, { title: "Visible inside shared", streamId: stream.id, visibility: "WORKSPACE" });
    const theirs = (await api(colleague).get(`/overview?streamId=${stream.id}`).expect(200)).body.data;
    expect(theirs.nodes.map((n: { title: string }) => n.title)).toContain("Visible inside shared");
    expect(theirs.nodes.map((n: { title: string }) => n.title)).not.toContain("Private inside shared");
    expect((await api(colleague).get("/overview?scope=owned").expect(200)).body.data.nodes.filter((n: { type: string }) => n.type === "COMMITMENT")).toEqual([]);
  });

  it("keep the map to a readable size and say what it left out", async () => {
    const { owner } = await workspace();
    const stream = (await api(owner).post("/streams", { title: "Busy" }).expect(201)).body.data;
    for (let i = 0; i < 11; i++) await commitment(owner, { title: `Item ${i}`, streamId: stream.id });
    const map = (await api(owner).get("/overview").expect(200)).body.data;
    expect(map.nodes.filter((n: { type: string }) => n.type === "COMMITMENT")).toHaveLength(8);
    expect(map.hidden).toBe(3);
  });

  it("deleting a stream keeps what was in it", async () => {
    const { owner } = await workspace();
    const stream = (await api(owner).post("/streams", { title: "Temporary" }).expect(201)).body.data;
    const c = await commitment(owner, { streamId: stream.id });
    await api(owner).del(`/streams/${stream.id}`).expect(204);
    expect((await api(owner).get(`/commitments/${c.id}`).expect(200)).body.data.stream).toBeNull();
  });

  it("refuse putting something in a workstream the caller cannot see", async () => {
    const { owner, join } = await workspace();
    const colleague = await join();
    const stream = (await api(owner).post("/streams", { title: "Private stream" }).expect(201)).body.data;
    await api(colleague).post("/commitments", { title: "x", streamId: stream.id }).expect(404);
  });
});

describe("when two things happen at once", () => {
  it("applies only one of two simultaneous outcomes on a decision", async () => {
    const { owner } = await workspace();
    const d = await decision(owner);
    const [a, b] = await Promise.all([
      api(owner).post(`/decisions/${d.id}/decision`, { outcome: "APPROVED" }),
      api(owner).post(`/decisions/${d.id}/decision`, { outcome: "DEFERRED" }),
    ]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
    const trail = await prisma.auditEvent.findMany({ where: { tenantId: owner.tenantId, eventType: "WORK_DECISION_DECIDED", targetId: d.id } });
    expect(trail).toHaveLength(1);
  });

  it("answers a source attached twice at once with a conflict, not an error", async () => {
    const { owner } = await workspace();
    const c = await commitment(owner);
    const meeting = await ownEvent(owner, "Release review");
    const body = { subjectType: "COMMITMENT", subjectId: c.id, evidence: { kind: "MEETING", refId: meeting.id } };
    const results = await Promise.all([api(owner).post("/evidence", body), api(owner).post("/evidence", body)]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
    expect((await api(owner).get(`/commitments/${c.id}`).expect(200)).body.data.evidence).toHaveLength(1);
  });
});

describe("workstream and decision housekeeping", () => {
  it("does not let new things be put into an archived workstream, but leaves what is already there editable", async () => {
    const { owner } = await workspace();
    const stream = (await api(owner).post("/streams", { title: "Old launch" }).expect(201)).body.data;
    const inside = await commitment(owner, { streamId: stream.id });
    await api(owner).patch(`/streams/${stream.id}`, { status: "ARCHIVED" }).expect(200);

    const refused = await api(owner).post("/commitments", { title: "Late addition", streamId: stream.id }).expect(409);
    expect(JSON.stringify(refused.body)).toContain("STREAM_ARCHIVED");
    const other = await commitment(owner, { title: "Elsewhere" });
    await api(owner).patch(`/commitments/${other.id}`, { streamId: stream.id }).expect(409);
    // Editing something already inside it still works, with its workstream sent along unchanged.
    await api(owner).patch(`/commitments/${inside.id}`, { title: "Renamed", streamId: stream.id }).expect(200);
    // Reopened, it takes new items again.
    await api(owner).patch(`/streams/${stream.id}`, { status: "ACTIVE" }).expect(200);
    await api(owner).patch(`/commitments/${other.id}`, { streamId: stream.id }).expect(200);
  });

  it("clears the replaced-by pointer when the replacement is deleted", async () => {
    const { owner } = await workspace();
    const old = await decision(owner, { title: "Old rule" });
    const next = await decision(owner, { title: "New rule" });
    await api(owner).post(`/decisions/${old.id}/decision`, { outcome: "SUPERSEDED", supersededById: next.id }).expect(200);
    await api(owner).del(`/decisions/${next.id}`).expect(204);
    const after = (await api(owner).get(`/decisions/${old.id}`).expect(200)).body.data;
    expect(after).toMatchObject({ status: "SUPERSEDED", supersededBy: null });
  });

  it("says when a list was cut short", async () => {
    const { owner } = await workspace();
    await prisma.workCommitment.createMany({
      data: Array.from({ length: 301 }, (_, i) => ({ tenantId: owner.tenantId, title: `Bulk ${i}`, ownerMembershipId: owner.membershipId, createdByMembershipId: owner.membershipId })),
    });
    const res = (await api(owner).get("/commitments").expect(200)).body.data;
    expect(res.items).toHaveLength(300);
    expect(res.truncated).toBe(true);
    expect(res.summary.confirmed).toBe(301);
    expect((await api(owner).get("/commitments?q=Bulk 7").expect(200)).body.data.truncated).toBe(false);
  });
});

describe("erasing a member", () => {
  const erase = (tenantId: string, userId: string, actor: string) =>
    withCrossTenant(() => lifecycleService.anonymizeUser(tenantId, userId, { tenantId, userId: actor }));

  it("deletes what they kept private, and keeps what they shared as a former member's", async () => {
    const { owner, join } = await workspace();
    const leaver = await join();
    const message = await inboxMessage(leaver, "The leaver's own thread");

    const kept = await commitment(leaver, { title: "Private to the leaver" });
    const privateStream = (await api(leaver).post("/streams", { title: "Private stream" }).expect(201)).body.data;
    const shared = await commitment(leaver, {
      title: "Shared with the team",
      visibility: "WORKSPACE",
      ownerEmail: owner.email,
      evidence: [{ kind: "EMAIL", refId: message.id }, { kind: "NOTE", label: "Agreed on the call" }],
    });
    const assigned = await commitment(leaver, { title: "Private but owned by the owner", ownerEmail: owner.email });
    const decisionShared = await decision(leaver, { title: "Shared decision", visibility: "WORKSPACE" });
    await api(leaver).post("/dependencies", { deliverable: "Waits on the shared decision", blockerType: "DECISION", blockerId: decisionShared.id, visibility: "WORKSPACE" }).expect(201);
    expect((await api(leaver).get("/commitments").expect(200)).body.data.items).toHaveLength(3);

    await erase(owner.tenantId, leaver.userId, owner.userId);

    // Gone: the private ones that nobody else needs.
    expect(await prisma.workCommitment.findUnique({ where: { id: kept.id } })).toBeNull();
    expect(await prisma.workStream.findUnique({ where: { id: privateStream.id } })).toBeNull();
    // Kept: what was shared with the workspace, or owned by somebody else — without an author.
    const seen = (await api(owner).get("/commitments?days=0").expect(200)).body.data.items as Array<Commitment & { createdBy: { name: string } }>;
    expect(seen.map((c) => c.title).sort()).toEqual(["Private but owned by the owner", "Shared with the team"]);
    expect(seen.every((c) => c.createdBy.name === "Former member")).toBe(true);
    expect((await prisma.workCommitment.findUniqueOrThrow({ where: { id: shared.id } })).createdByMembershipId).toBeNull();
    expect((await prisma.workCommitment.findUniqueOrThrow({ where: { id: assigned.id } })).createdByMembershipId).toBeNull();
    // Their own mail is gone, so the links to it are; a note they wrote for the team stays.
    const evidence = (await api(owner).get(`/commitments/${shared.id}`).expect(200)).body.data.evidence as Array<{ kind: string }>;
    expect(evidence.map((e) => e.kind)).toEqual(["NOTE"]);
    // The team's dependency on the shared decision is intact.
    const deps = (await api(owner).get("/dependencies").expect(200)).body.data as Array<{ deliverable: string; state: string }>;
    expect(deps).toEqual([expect.objectContaining({ deliverable: "Waits on the shared decision", state: "WAITING" })]);
    expect((await api(owner).get(`/decisions/${decisionShared.id}`).expect(200)).body.data.createdBy.name).toBe("Former member");
  });
});
