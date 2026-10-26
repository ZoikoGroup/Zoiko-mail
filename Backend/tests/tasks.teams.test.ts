import request from "supertest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../src/app.js";
import { prisma } from "../src/config/prisma.js";
import { sseManager } from "../src/common/sse/sse.manager.js";
import { taskService } from "../src/modules/task/task.service.js";
import { authHeader, registerUser } from "./helpers.js";

const app = createApp();

/**
 * Tasks (Phase 2): team workspaces are the shared mailboxes an admin creates
 * under Groups, and a team's tasks belong to everyone who can read that
 * mailbox. Work can be handed to a teammate, reminders arrive once, the
 * history exports safely, and everyone a task concerns hears it change.
 */

let sequence = 0;
const unique = (prefix: string) => `${prefix}-${Date.now()}-${++sequence}`;

type Person = { token: string; userId: string; membershipId: string; tenantId: string };

async function workspace() {
  const owner = await registerUser(app, { email: `${unique("tt-owner")}@zoiko.test` });
  const join = async (): Promise<Person> => {
    const email = `${unique("tt-member")}@zoiko.test`;
    const user = await registerUser(app, { email });
    const added = await request(app).post("/api/v1/membership/members").set(authHeader(owner.accessToken)).send({ email, role: "MEMBER" }).expect(201);
    const login = await request(app)
      .post("/api/v1/auth/login")
      .send({ email, password: user.password, tenantId: owner.tenantId, workspace: "MEMBER" })
      .expect(200);
    const session = login.body.data.session ?? login.body.data;
    return { token: session.accessToken as string, userId: user.userId, membershipId: added.body.data.id as string, tenantId: owner.tenantId };
  };
  /** A shared mailbox — a team — with these people on it. */
  const team = async (members: Person[], displayName?: string) => {
    const created = await request(app)
      .post("/api/v1/mail/admin/shared-mailboxes")
      .set(authHeader(owner.accessToken))
      .send({ address: `${unique("ops")}@shared.test`, type: "SHARED" })
      .expect(201);
    for (const m of members) {
      await request(app)
        .post(`/api/v1/mail/admin/shared-mailboxes/${created.body.data.id}/assignees`)
        .set(authHeader(owner.accessToken))
        .send({ membershipId: m.membershipId, canRead: true })
        .expect(200);
    }
    if (displayName) await prisma.mailbox.update({ where: { id: created.body.data.id }, data: { displayName } });
    return created.body.data as { id: string; address: string };
  };
  return { owner, join, team };
}

const api = (p: Person) => ({
  get: (path: string) => request(app).get(`/api/v1/tasks${path}`).set(authHeader(p.token)),
  post: (path: string, body: object = {}) => request(app).post(`/api/v1/tasks${path}`).set(authHeader(p.token)).send(body),
  patch: (path: string, body: object) => request(app).patch(`/api/v1/tasks${path}`).set(authHeader(p.token)).send(body),
  delete: (path: string) => request(app).delete(`/api/v1/tasks${path}`).set(authHeader(p.token)),
});

const ids = (res: request.Response) => (res.body.data.items as Array<{ id: string }>).map((t) => t.id);

afterEach(() => vi.restoreAllMocks());

describe("team tasks", () => {
  it("belong to everyone on the team, and to nobody outside it", async () => {
    const ws = await workspace();
    const [lead, mate, outsider] = [await ws.join(), await ws.join(), await ws.join()];
    const ops = await ws.team([lead, mate], "Client Operations");

    // The sidebar's teams: only the ones I am on.
    const teams = (await api(lead).get("/teams").expect(200)).body.data;
    expect(teams).toEqual([expect.objectContaining({ id: ops.id, name: "Client Operations", memberCount: 2, counts: expect.objectContaining({ open: 0 }) })]);
    expect((await api(outsider).get("/teams").expect(200)).body.data).toEqual([]);

    const task = (await api(lead).post("/", { title: "Finalize partner launch checklist", teamId: ops.id, ownerUserId: mate.userId, dueAt: new Date(Date.now() + 86_400_000).toISOString() }).expect(201)).body.data;
    expect(task).toMatchObject({ team: { id: ops.id, name: "Client Operations" }, owner: { id: mate.userId }, isAssigned: true });

    expect(ids(await api(lead).get(`/?view=team&teamId=${ops.id}`).expect(200))).toEqual([task.id]);
    expect(ids(await api(mate).get(`/?view=team&teamId=${ops.id}`).expect(200))).toEqual([task.id]);
    expect((await api(lead).get("/teams").expect(200)).body.data[0].counts).toMatchObject({ open: 1, dueNext3Days: 1, assignedToMe: 0 });

    await api(outsider).get(`/?view=team&teamId=${ops.id}`).expect(404);
    await api(outsider).get(`/${task.id}`).expect(404);
    await api(outsider).post("/", { title: "Sneak in", teamId: ops.id }).expect(404);
    await api(lead).get("/?view=team").expect(400);
  });

  it("can be worked by any teammate, but only deleted by their creator", async () => {
    const ws = await workspace();
    const [lead, mate, third] = [await ws.join(), await ws.join(), await ws.join()];
    const ops = await ws.team([lead, mate, third]);
    const task = (await api(lead).post("/", { title: "Publish updated support guide", teamId: ops.id, ownerUserId: mate.userId }).expect(201)).body.data;

    // Neither owner nor creator, but on the team.
    await api(third).get(`/${task.id}`).expect(200);
    await api(third).patch(`/${task.id}`, { status: "IN_PROGRESS" }).expect(200);
    await api(third).delete(`/${task.id}`).expect(403);
    const done = (await api(third).post(`/${task.id}/complete`).expect(200)).body.data;
    expect(done.completedBy.id).toBe(third.userId);

    // Team history, and the team's completions this week.
    expect(ids(await api(lead).get("/?view=completed&scope=team").expect(200))).toEqual([task.id]);
    expect((await api(lead).get("/summary").expect(200)).body.data.counts.teamCompletionsThisWeek).toBe(1);
  });

  it("go only to people on the team, and a handover tells the new owner", async () => {
    const ws = await workspace();
    const [lead, mate, outsider] = [await ws.join(), await ws.join(), await ws.join()];
    const ops = await ws.team([lead, mate]);

    await api(lead).post("/", { title: "Nope", teamId: ops.id, ownerUserId: outsider.userId }).expect(400);

    const people = (await api(lead).get(`/assignees?teamId=${ops.id}`).expect(200)).body.data as Array<{ id: string; isMe: boolean }>;
    expect(people.map((p) => p.id).sort()).toEqual([lead.userId, mate.userId].sort());
    expect(people.find((p) => p.id === lead.userId)?.isMe).toBe(true);
    await api(outsider).get(`/assignees?teamId=${ops.id}`).expect(404);

    const task = (await api(lead).post("/", { title: "Approve Q4 onboarding copy", teamId: ops.id }).expect(201)).body.data;
    await api(lead).patch(`/${task.id}`, { ownerUserId: outsider.userId }).expect(400);
    const handed = (await api(lead).patch(`/${task.id}`, { ownerUserId: mate.userId }).expect(200)).body.data;
    expect(handed.owner.id).toBe(mate.userId);
    expect(await prisma.notification.count({ where: { userId: mate.userId, title: "Task assigned to you" } })).toBe(1);
    expect(await prisma.auditEvent.count({ where: { targetId: task.id, eventType: "TASK_REASSIGNED" } })).toBe(1);

    // Personal work moves onto a team only if I am on it, and only with an owner who is.
    const other = await ws.team([mate]);
    const mine = (await api(lead).post("/", { title: "Personal" }).expect(201)).body.data;
    await api(lead).patch(`/${mine.id}`, { teamId: other.id }).expect(404);
    const moved = (await api(lead).patch(`/${mine.id}`, { teamId: ops.id }).expect(200)).body.data;
    expect(moved.team.id).toBe(ops.id);
    expect((await api(lead).patch(`/${mine.id}`, { teamId: null }).expect(200)).body.data.team).toBeNull();
  });

  it("from a shared inbox's email belong to that team, and show the email to the team", async () => {
    const ws = await workspace();
    const [lead, mate] = [await ws.join(), await ws.join()];
    const ops = await ws.team([lead, mate]);
    const message = await prisma.emailMessage.create({
      data: {
        tenantId: lead.tenantId,
        authorUserId: lead.userId,
        subject: "Escalation #1042",
        status: "RECEIVED",
        fromAddress: "customer@outside.test",
        fromName: "Dana Customer",
        sentAt: new Date(),
        mailboxItems: { create: { tenantId: lead.tenantId, mailboxId: ops.id, folder: "INBOX", isRead: false } },
      },
    });

    const task = (await api(lead).post(`/from-message/${message.id}`, { mailboxId: ops.id }).expect(201)).body.data;
    expect(task).toMatchObject({ title: "Follow up: Escalation #1042", team: { id: ops.id } });
    expect(task.linkedEmail).toMatchObject({ accessible: true, subject: "Escalation #1042", mailboxId: ops.id, folder: "INBOX" });
    const seen = (await api(mate).get(`/${task.id}`).expect(200)).body.data;
    expect(seen.linkedEmail).toMatchObject({ accessible: true, mailboxId: ops.id });
  });

  it("tell everyone they concern when they change", async () => {
    const ws = await workspace();
    const [lead, mate, outsider] = [await ws.join(), await ws.join(), await ws.join()];
    const ops = await ws.team([lead, mate]);
    const sent = vi.spyOn(sseManager, "sendToUser");
    const task = (await api(lead).post("/", { title: "Prepare monthly operations review", teamId: ops.id }).expect(201)).body.data;
    sent.mockClear();

    await api(lead).post(`/${task.id}/reschedule`, { dueAt: new Date(Date.now() + 2 * 86_400_000).toISOString() }).expect(200);
    const told = sent.mock.calls.filter(([, e]) => e.type === "TASK_UPDATED").map(([userId]) => userId);
    expect(new Set(told)).toEqual(new Set([lead.userId, mate.userId]));
    expect(told).not.toContain(outsider.userId);
  });
});

describe("task reminders", () => {
  it("arrive once, again only when moved, and never for finished work", async () => {
    const ws = await workspace();
    const me = await ws.join();
    const sent = vi.spyOn(sseManager, "sendToUser");
    const past = new Date(Date.now() - 60_000).toISOString();
    const task = (await api(me).post("/", { title: "Review partnership agreement", reminderAt: past }).expect(201)).body.data;
    const done = (await api(me).post("/", { title: "Already done", reminderAt: past }).expect(201)).body.data;
    await api(me).post(`/${done.id}/complete`).expect(200);
    const future = (await api(me).post("/", { title: "Later", reminderAt: new Date(Date.now() + 3_600_000).toISOString() }).expect(201)).body.data;

    const reminders = () => prisma.notification.findMany({ where: { userId: me.userId, title: { startsWith: "Reminder:" } } });

    await taskService.processDueReminders();
    expect((await reminders()).map((n) => n.title)).toEqual(["Reminder: Review partnership agreement"]);
    expect(sent.mock.calls.some(([userId, e]) => userId === me.userId && e.type === "NOTIFICATION")).toBe(true);
    expect((await api(me).get(`/${task.id}`).expect(200)).body.data.reminderSentAt).toBeTruthy();

    await taskService.processDueReminders();
    expect(await reminders()).toHaveLength(1);

    // Moving the reminder arms it again.
    await api(me).patch(`/${task.id}`, { reminderAt: past }).expect(200);
    await taskService.processDueReminders();
    expect(await reminders()).toHaveLength(2);
    expect((await api(me).get(`/${future.id}`).expect(200)).body.data.reminderSentAt).toBeNull();
  });
});

describe("task export", () => {
  it("writes the completed history as CSV that cannot run as a formula", async () => {
    const ws = await workspace();
    const me = await ws.join();
    const plain = (await api(me).post("/", { title: "Send October reporting pack" }).expect(201)).body.data;
    const risky = (await api(me).post("/", { title: "=HYPERLINK(\"http://evil\")", description: "line one, with comma" }).expect(201)).body.data;
    await api(me).post("/", { title: "Still open" }).expect(201);
    await api(me).post(`/${plain.id}/complete`).expect(200);
    await api(me).post(`/${risky.id}/complete`).expect(200);

    const res = await request(app).get("/api/v1/tasks/export?days=30").set(authHeader(me.token)).expect(200);
    expect(res.headers["content-type"]).toContain("text/csv");
    expect(res.headers["content-disposition"]).toMatch(/completed-tasks-\d{4}-\d{2}-\d{2}\.csv/);
    const lines = res.text.replace(/^﻿/, "").trim().split("\n");
    expect(lines[0]).toBe("Title,Description,Priority,Team,Owner,Owner email,Completed by,Completed at,Due,Original due,Linked email");
    expect(lines).toHaveLength(3);
    expect(res.text).toContain(`"'=HYPERLINK(""http://evil"")","line one, with comma"`);
    expect(res.text).not.toContain("Still open");
    expect(await prisma.auditEvent.count({ where: { tenantId: me.tenantId, eventType: "TASKS_EXPORTED" } })).toBe(1);
  });
});
