import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { prisma } from "../src/config/prisma.js";
import { dayBounds } from "../src/modules/task/task.dates.js";
import { authHeader, loginUser, registerUser } from "./helpers.js";

const app = createApp();

/**
 * Tasks (Phase 1): the views behind My Tasks, Today, Upcoming, Overdue and
 * Completed, built on commitments. Days are the person's days, completed work
 * is a record, and a task belongs to its owner and its creator only.
 */

let counter = 0;
const uid = () => `${Date.now().toString(36)}${(counter++).toString(36)}`;
const ZONE = "Europe/London";

type Person = { email: string; token: string; userId: string; tenantId: string; membershipId: string };

async function workspace(): Promise<Person & { join: () => Promise<Person> }> {
  const reg = await registerUser(app, { email: `task-owner-${uid()}@zoiko.test` });
  const me: Person = { email: reg.email, token: reg.accessToken as string, userId: reg.userId, tenantId: reg.tenantId, membershipId: reg.membershipId };
  const join = async (): Promise<Person> => {
    const user = await registerUser(app, { email: `task-member-${uid()}@zoiko.test` });
    await request(app).post("/api/v1/membership/members").set(authHeader(me.token)).send({ email: user.email, role: "MEMBER" }).expect(201);
    const login = await loginUser(app, user.email, user.password, me.tenantId, user.mfaSecret);
    const membership = await prisma.tenantMembership.findFirstOrThrow({ where: { tenantId: me.tenantId, userId: user.userId } });
    return { email: user.email, token: login.accessToken as string, userId: user.userId, tenantId: me.tenantId, membershipId: membership.id };
  };
  return { ...me, join };
}

const api = (p: Person) => ({
  get: (path: string) => request(app).get(`/api/v1/tasks${path}`).set(authHeader(p.token)),
  post: (path: string, body: object = {}) => request(app).post(`/api/v1/tasks${path}`).set(authHeader(p.token)).send(body),
  put: (path: string, body: object) => request(app).put(`/api/v1/tasks${path}`).set(authHeader(p.token)).send(body),
  patch: (path: string, body: object) => request(app).patch(`/api/v1/tasks${path}`).set(authHeader(p.token)).send(body),
  delete: (path: string) => request(app).delete(`/api/v1/tasks${path}`).set(authHeader(p.token)),
});

const ids = (res: request.Response) => (res.body.data.items as Array<{ id: string }>).map((t) => t.id);

async function seedInboxMessage(p: Person, subject = "Q4 proposal revisions") {
  const mailbox = await prisma.mailbox.upsert({
    where: { membershipId: p.membershipId },
    update: {},
    create: { tenantId: p.tenantId, membershipId: p.membershipId, address: `inbox-${uid()}@zoiko.test` },
  });
  const thread = await prisma.messageThread.create({
    data: { tenantId: p.tenantId, subjectNormalized: subject.toLowerCase(), participants: ["lena@example.com"], firstMessageAt: new Date(), lastMessageAt: new Date() },
  });
  return prisma.emailMessage.create({
    data: {
      tenantId: p.tenantId,
      authorUserId: p.userId,
      threadId: thread.id,
      subject,
      textBody: "Please review the revised proposal.",
      status: "RECEIVED",
      sentAt: new Date(),
      fromAddress: "lena@example.com",
      fromName: "Lena Carter",
      mailboxItems: { create: { tenantId: p.tenantId, mailboxId: mailbox.id, folder: "INBOX", isRead: false } },
      securityFlags: {},
    },
  });
}

describe("task day boundaries", () => {
  it("follow the zone across the day the clocks go back", () => {
    // Sunday 25 October 2026: BST ends at 01:00 UTC, so the day is 25 hours long.
    const b = dayBounds(ZONE, new Date("2026-10-25T12:00:00Z"));
    expect(b.today).toBe("2026-10-25");
    expect(b.startOfToday.toISOString()).toBe("2026-10-24T23:00:00.000Z");
    expect(b.startOfTomorrow.toISOString()).toBe("2026-10-26T00:00:00.000Z");
    expect(b.startOfWeek.toISOString()).toBe("2026-10-18T23:00:00.000Z");
  });

  it("put just after local midnight on the local date, not the UTC one", () => {
    const b = dayBounds(ZONE, new Date("2026-10-23T23:30:00Z"));
    expect(b.today).toBe("2026-10-24");
  });
});

describe("tasks", () => {
  it("sort each task into the right view and count it on the cards", async () => {
    const ws = await workspace();
    const b = dayBounds(ZONE);
    const hour = 3_600_000;
    const make = async (title: string, dueAt: Date | null, extra: object = {}) =>
      (await api(ws).post("/", { title, dueAt: dueAt?.toISOString() ?? null, ...extra }).expect(201)).body.data;

    const overdue = await make("Overdue", new Date(b.dayStart(-2).getTime() + 10 * hour), { priority: "HIGH" });
    const today = await make("Due today", new Date(b.startOfToday.getTime() + hour));
    const soon = await make("In three days", new Date(b.dayStart(3).getTime() + 9 * hour));
    const later = await make("In twenty days", new Date(b.dayStart(20).getTime() + 9 * hour));
    const undated = await make("Someday", null, { status: "PLANNED" });

    expect(overdue).toMatchObject({ dueState: "overdue", daysOverdue: 2, isAssigned: false, hasLinkedEmail: false });
    expect(today.dueState).toBe("today");
    expect(undated).toMatchObject({ status: "PLANNED", dueState: "none" });

    const view = (v: string, extra = "") => api(ws).get(`/?view=${v}&tz=${ZONE}${extra}`).expect(200);
    expect(ids(await view("all"))).toEqual([overdue.id, today.id, soon.id, later.id, undated.id]);
    expect(ids(await view("today"))).toEqual([overdue.id, today.id]);
    expect(ids(await view("overdue"))).toEqual([overdue.id]);
    expect(ids(await view("upcoming"))).toEqual([soon.id]);
    expect(ids(await view("upcoming", "&days=30"))).toEqual([soon.id, later.id]);
    expect(ids(await view("all", "&sort=priority"))[0]).toBe(overdue.id);
    expect(ids(await view("all", "&q=twenty"))).toEqual([later.id]);

    const summary = (await api(ws).get(`/summary?tz=${ZONE}`).expect(200)).body.data;
    expect(summary).toMatchObject({ timeZone: ZONE, today: b.today });
    expect(summary.counts).toMatchObject({ open: 5, overdue: 1, dueToday: 1, next7Days: 1, upcoming: 2, fromEmail: 0, assigned: 0, completedThisWeek: 0 });
  });

  it("keep completed work as a record that only reopens with a reason", async () => {
    const ws = await workspace();
    const task = (await api(ws).post("/", { title: "Send consolidated feedback" }).expect(201)).body.data;

    const done = (await api(ws).post(`/${task.id}/complete`).expect(200)).body.data;
    expect(done).toMatchObject({ status: "COMPLETED", completedBy: { id: ws.userId } });
    expect(done.completedAt).toBeTruthy();
    expect(ids(await api(ws).get("/?view=completed").expect(200))).toEqual([task.id]);
    expect(ids(await api(ws).get("/?view=all").expect(200))).toEqual([]);
    expect((await api(ws).get("/summary").expect(200)).body.data.counts.completedThisWeek).toBe(1);

    await api(ws).patch(`/${task.id}`, { title: "Changed" }).expect(409);
    await api(ws).post(`/${task.id}/checklist`, { text: "More" }).expect(409);
    await api(ws).post(`/${task.id}/reopen`, {}).expect(400);

    const reopened = (await api(ws).post(`/${task.id}/reopen`, { reason: "Client asked for one more change" }).expect(200)).body.data;
    expect(reopened).toMatchObject({ status: "OPEN", completedAt: null, completedBy: null });
    await api(ws).post(`/${task.id}/reopen`, { reason: "Again" }).expect(409);
    const audit = await prisma.auditEvent.findFirstOrThrow({ where: { tenantId: ws.tenantId, eventType: "TASK_REOPENED", targetId: task.id } });
    expect(audit.metadata).toMatchObject({ reason: "Client asked for one more change" });
  });

  it("remember the original due date however often a task moves", async () => {
    const ws = await workspace();
    const first = new Date(Date.now() - 3 * 86_400_000);
    const task = (await api(ws).post("/", { title: "Review partnership agreement", dueAt: first.toISOString() }).expect(201)).body.data;
    expect(task.originalDueAt).toBeNull();

    const second = new Date(Date.now() + 2 * 86_400_000);
    const moved = (await api(ws).post(`/${task.id}/reschedule`, { dueAt: second.toISOString() }).expect(200)).body.data;
    expect(moved).toMatchObject({ dueAt: second.toISOString(), originalDueAt: first.toISOString(), dueState: "upcoming" });

    const third = new Date(Date.now() + 5 * 86_400_000);
    const again = (await api(ws).patch(`/${task.id}`, { dueAt: third.toISOString() }).expect(200)).body.data;
    expect(again).toMatchObject({ dueAt: third.toISOString(), originalDueAt: first.toISOString() });
  });

  it("keep a checklist in order and count its progress", async () => {
    const ws = await workspace();
    const task = (await api(ws).post("/", { title: "Prepare briefing", checklist: ["Review summary", "Confirm blockers"] }).expect(201)).body.data;
    expect(task.checklistProgress).toEqual({ done: 0, total: 2 });
    const [a, b] = task.checklist;

    let res = (await api(ws).patch(`/${task.id}/checklist/${a.id}`, { done: true }).expect(200)).body.data;
    expect(res.checklistProgress).toEqual({ done: 1, total: 2 });

    res = (await api(ws).post(`/${task.id}/checklist`, { text: "Circulate final briefing" }).expect(201)).body.data;
    const c = res.checklist[2];
    expect(c.text).toBe("Circulate final briefing");

    await api(ws).put(`/${task.id}/checklist/order`, { itemIds: [c.id, a.id] }).expect(400);
    res = (await api(ws).put(`/${task.id}/checklist/order`, { itemIds: [c.id, a.id, b.id] }).expect(200)).body.data;
    expect(res.checklist.map((i: { id: string }) => i.id)).toEqual([c.id, a.id, b.id]);

    res = (await api(ws).delete(`/${task.id}/checklist/${b.id}`).expect(200)).body.data;
    expect(res.checklistProgress).toEqual({ done: 1, total: 2 });
    await api(ws).delete(`/${task.id}/checklist/${b.id}`).expect(404);
  });

  it("belong to their owner and creator, and nobody else", async () => {
    const ws = await workspace();
    const member = await ws.join();
    const outsider = await ws.join();

    const task = (await api(ws).post("/", { title: "Approve onboarding checklist", ownerUserId: member.userId }).expect(201)).body.data;
    expect(task).toMatchObject({ isAssigned: true, owner: { id: member.userId }, createdBy: { id: ws.userId } });

    // The assignee hears about it and finds it under Assigned to Me.
    expect(await prisma.notification.count({ where: { userId: member.userId, title: "New task assigned" } })).toBe(1);
    expect(ids(await api(member).get("/?view=assigned").expect(200))).toEqual([task.id]);
    expect((await api(member).get("/summary").expect(200)).body.data.counts.assigned).toBe(1);
    // It is on the assignee's list, not the creator's.
    expect(ids(await api(ws).get("/?view=all").expect(200))).toEqual([]);

    await api(outsider).get(`/${task.id}`).expect(404);
    await api(outsider).post(`/${task.id}/complete`).expect(404);
    await api(member).delete(`/${task.id}`).expect(403);

    await api(member).post(`/${task.id}/complete`).expect(200);
    expect(await prisma.notification.count({ where: { userId: ws.userId, title: "Task completed" } })).toBe(1);
    expect(ids(await api(ws).get("/?view=completed").expect(200))).toEqual([task.id]);

    await api(ws).delete(`/${task.id}`).expect(204);
    await api(ws).get(`/${task.id}`).expect(404);
    expect(ids(await api(member).get("/?view=completed").expect(200))).toEqual([]);
  });

  it("refuse an owner from outside the workspace", async () => {
    const ws = await workspace();
    const other = await workspace();
    await api(ws).post("/", { title: "Nope", ownerUserId: other.userId }).expect(400);
  });

  it("turn an email into a task, showing the email only to those who can read it", async () => {
    const ws = await workspace();
    const member = await ws.join();
    const message = await seedInboxMessage(ws);

    const task = (await api(ws).post(`/from-message/${message.id}`, { priority: "HIGH" }).expect(201)).body.data;
    expect(task).toMatchObject({ title: "Follow up: Q4 proposal revisions", messageId: message.id, threadId: message.threadId, hasLinkedEmail: true, priority: "HIGH" });
    expect(task.linkedEmail).toMatchObject({ accessible: true, subject: "Q4 proposal revisions", fromName: "Lena Carter", folder: "INBOX" });
    expect(ids(await api(ws).get("/?view=from_email").expect(200))).toEqual([task.id]);

    // Handed to somebody who cannot open that mailbox: they learn an email exists, not what it says.
    const handed = (await api(ws).post("/", { title: "Reply to Lena", messageId: message.id, ownerUserId: member.userId }).expect(201)).body.data;
    const seen = (await api(member).get(`/${handed.id}`).expect(200)).body.data;
    expect(seen.linkedEmail).toEqual({ accessible: false, messageId: message.id, threadId: null });

    // Nobody can link an email they cannot read.
    await api(member).post(`/from-message/${message.id}`, {}).expect(404);
    await api(member).post("/", { title: "Sneaky", messageId: message.id }).expect(404);
  });

  it("validate what they are given", async () => {
    const ws = await workspace();
    await api(ws).post("/", { title: "   " }).expect(400);
    await api(ws).post("/", { title: "Bad date", dueAt: "tomorrow" }).expect(400);
    await api(ws).get("/?view=everything").expect(400);
    await api(ws).get("/?tz=Mars/Olympus").expect(400);
    const task = (await api(ws).post("/", { title: "Fine" }).expect(201)).body.data;
    await api(ws).patch(`/${task.id}`, {}).expect(400);
    await api(ws).patch(`/${task.id}`, { status: "COMPLETED" }).expect(400);
  });
});
