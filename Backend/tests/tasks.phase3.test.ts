import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { prisma } from "../src/config/prisma.js";
import { authHeader, registerUser } from "./helpers.js";

const app = createApp();

/**
 * Tasks (Phase 3): following work you do not own, a task's history in words,
 * and finding tasks from the top bar. None of these widen what anyone can see.
 */

let sequence = 0;
const unique = (prefix: string) => `${prefix}-${Date.now()}-${++sequence}`;

type Person = { token: string; userId: string; membershipId: string; tenantId: string };

async function workspace() {
  const owner = await registerUser(app, { email: `${unique("p3-owner")}@zoiko.test` });
  const join = async (): Promise<Person> => {
    const email = `${unique("p3-member")}@zoiko.test`;
    const user = await registerUser(app, { email });
    const added = await request(app).post("/api/v1/membership/members").set(authHeader(owner.accessToken)).send({ email, role: "MEMBER" }).expect(201);
    const login = await request(app).post("/api/v1/auth/login").send({ email, password: user.password, tenantId: owner.tenantId, workspace: "MEMBER" }).expect(200);
    const session = login.body.data.session ?? login.body.data;
    return { token: session.accessToken as string, userId: user.userId, membershipId: added.body.data.id as string, tenantId: owner.tenantId };
  };
  const team = async (members: Person[]) => {
    const created = await request(app)
      .post("/api/v1/mail/admin/shared-mailboxes")
      .set(authHeader(owner.accessToken))
      .send({ address: `${unique("team")}@shared.test`, type: "SHARED" })
      .expect(201);
    for (const m of members) {
      await request(app)
        .post(`/api/v1/mail/admin/shared-mailboxes/${created.body.data.id}/assignees`)
        .set(authHeader(owner.accessToken))
        .send({ membershipId: m.membershipId, canRead: true })
        .expect(200);
    }
    return created.body.data as { id: string };
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

describe("following tasks", () => {
  it("is open to anyone who can see the task, and tells them when it matters", async () => {
    const ws = await workspace();
    const [lead, mate, watcher, outsider] = [await ws.join(), await ws.join(), await ws.join(), await ws.join()];
    const ops = await ws.team([lead, mate, watcher]);
    const task = (await api(lead).post("/", { title: "Finalize partner launch checklist", teamId: ops.id, ownerUserId: mate.userId }).expect(201)).body.data;
    expect(task).toMatchObject({ isFollowing: false, followerCount: 0 });

    await api(outsider).post(`/${task.id}/follow`).expect(404);
    const followed = (await api(watcher).post(`/${task.id}/follow`).expect(200)).body.data;
    expect(followed).toMatchObject({ isFollowing: true, followerCount: 1 });
    await api(watcher).post(`/${task.id}/follow`).expect(200); // twice is still once
    expect(ids(await api(watcher).get("/?view=following").expect(200))).toEqual([task.id]);
    expect((await api(watcher).get("/summary").expect(200)).body.data.counts.following).toBe(1);

    // A handover and a completion reach the follower; an ordinary edit does not.
    await api(lead).patch(`/${task.id}`, { title: "Finalize the partner launch checklist" }).expect(200);
    await api(lead).patch(`/${task.id}`, { ownerUserId: lead.userId }).expect(200);
    await api(lead).post(`/${task.id}/complete`).expect(200);
    const told = await prisma.notification.findMany({ where: { userId: watcher.userId }, orderBy: { createdAt: "asc" } });
    expect(told.map((n) => n.title)).toEqual(["Task handed over", "Task completed"]);

    await api(watcher).delete(`/${task.id}/follow`).expect(200);
    expect((await api(watcher).get(`/${task.id}`).expect(200)).body.data.isFollowing).toBe(false);
  });

  it("never outlives access: leave the team and the followed task is gone", async () => {
    const ws = await workspace();
    const [lead, watcher] = [await ws.join(), await ws.join()];
    const ops = await ws.team([lead, watcher]);
    const task = (await api(lead).post("/", { title: "Publish updated support guide", teamId: ops.id }).expect(201)).body.data;
    await api(watcher).post(`/${task.id}/follow`).expect(200);

    await prisma.mailboxAccess.deleteMany({ where: { mailboxId: ops.id, membershipId: watcher.membershipId } });
    expect(ids(await api(watcher).get("/?view=following").expect(200))).toEqual([]);
    await api(watcher).get(`/${task.id}`).expect(404);
  });
});

describe("task activity", () => {
  it("tells the task's story in words, oldest first", async () => {
    const ws = await workspace();
    const [lead, mate] = [await ws.join(), await ws.join()];
    const ops = await ws.team([lead, mate]);
    const task = (await api(lead).post("/", { title: "Finalize client onboarding handoff", teamId: ops.id, checklist: ["Confirm owner"], dueAt: "2026-11-02T10:00:00.000Z" }).expect(201)).body.data;
    await api(lead).patch(`/${task.id}`, { priority: "HIGH" }).expect(200);
    await api(lead).post(`/${task.id}/reschedule`, { dueAt: "2026-11-05T10:00:00.000Z" }).expect(200);
    await api(lead).patch(`/${task.id}/checklist/${task.checklist[0].id}`, { done: true }).expect(200);
    await api(lead).patch(`/${task.id}`, { ownerUserId: mate.userId }).expect(200);
    await api(mate).post(`/${task.id}/complete`).expect(200);
    await api(lead).post(`/${task.id}/reopen`, { reason: "Client asked for one more change" }).expect(200);

    const items = (await api(mate).get(`/${task.id}/activity`).expect(200)).body.data as Array<{ label: string; actor: { id: string } | null }>;
    expect(items.map((i) => i.label)).toEqual([
      "Created the task",
      "Changed the priority",
      expect.stringMatching(/^Moved the due date from .*2 Nov.* to .*5 Nov/),
      "Ticked “Confirm owner”",
      expect.stringMatching(/^Handed over from .* to /),
      "Marked complete",
      "Reopened: “Client asked for one more change”",
    ]);
    expect(items[5]!.actor?.id).toBe(mate.userId);

    const outsider = await ws.join();
    await api(outsider).get(`/${task.id}/activity`).expect(404);
  });
});

describe("task search", () => {
  it("finds what I can see — mine, given to me, my team's — and nothing else", async () => {
    const ws = await workspace();
    const [me, mate, stranger] = [await ws.join(), await ws.join(), await ws.join()];
    const ops = await ws.team([me, mate]);
    const mine = (await api(me).post("/", { title: "Quarterly proposal review" }).expect(201)).body.data;
    const teams = (await api(mate).post("/", { title: "Proposal pricing check", teamId: ops.id }).expect(201)).body.data;
    const done = (await api(me).post("/", { title: "Old proposal draft" }).expect(201)).body.data;
    await api(me).post(`/${done.id}/complete`).expect(200);
    await api(stranger).post("/", { title: "Stranger's proposal" }).expect(201);
    const gone = (await api(me).post("/", { title: "Deleted proposal" }).expect(201)).body.data;
    await api(me).delete(`/${gone.id}`).expect(204);

    const found = (await api(me).get("/search?q=PROPOSAL").expect(200)).body.data as Array<{ id: string; status: string }>;
    expect(found.map((t) => t.id).sort()).toEqual([mine.id, teams.id, done.id].sort());
    // Open work before finished work.
    expect(found[found.length - 1]!.id).toBe(done.id);
    expect((await api(me).get("/search?q=proposal&limit=1").expect(200)).body.data).toHaveLength(1);
    await api(me).get("/search?q=").expect(400);
  });
});
