import { describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import { authHeader, registerUser } from "./helpers.js";

const app = createApp();

/**
 * How many workspaces this account can sign into — `GET /auth/me`.
 *
 * The profile menu offers "Switch workspace" only when there is somewhere to
 * switch to. `/select-workspace` has existed the whole time and nothing in
 * the product linked to it, so somebody in two workspaces had no way to move
 * between them except signing out; somebody in one would be sent to a page
 * telling them so.
 *
 * Counted rather than listed on purpose. The names belong to the selection
 * screen, and a list here would put every workspace a person belongs to into
 * a response the shell caches for a minute.
 */

describe("workspaceCount on /auth/me", () => {
  it("is one for an account that has just registered", async () => {
    const owner = await registerUser(app, { email: `wc-solo-${Date.now()}@zoiko.test` });

    const res = await request(app)
      .get("/api/v1/auth/me")
      .set(authHeader(owner.accessToken))
      .expect(200);

    // Their own workspace, and no menu item offering to leave it.
    expect(res.body.data.workspaceCount).toBe(1);
  });

  it("counts a second workspace once the invitation is accepted", async () => {
    const suffix = Date.now();
    const host = await registerUser(app, { email: `wc-host-${suffix}@zoiko.test` });
    const guest = await registerUser(app, { email: `wc-guest-${suffix}@zoiko.test` });

    const before = await request(app)
      .get("/api/v1/auth/me")
      .set(authHeader(guest.accessToken))
      .expect(200);
    expect(before.body.data.workspaceCount).toBe(1);

    // Added straight to ACTIVE, which is what the count is about — a pending
    // invitation is not somewhere you can switch to yet.
    await request(app)
      .post("/api/v1/membership/members")
      .set(authHeader(host.accessToken))
      .send({ email: guest.email, role: "MEMBER" })
      .expect(201);

    const after = await request(app)
      .get("/api/v1/auth/me")
      .set(authHeader(guest.accessToken))
      .expect(200);
    expect(after.body.data.workspaceCount).toBe(2);
  });

  it("does not count a workspace somebody was removed from", async () => {
    const suffix = Date.now();
    const host = await registerUser(app, { email: `wc-rm-host-${suffix}@zoiko.test` });
    const guest = await registerUser(app, { email: `wc-rm-guest-${suffix}@zoiko.test` });

    const added = await request(app)
      .post("/api/v1/membership/members")
      .set(authHeader(host.accessToken))
      .send({ email: guest.email, role: "MEMBER" })
      .expect(201);

    await request(app)
      .delete(`/api/v1/membership/members/${added.body.data.id}`)
      .set(authHeader(host.accessToken))
      .set("Idempotency-Key", `wc-${suffix}`)
      .expect(200);

    const after = await request(app)
      .get("/api/v1/auth/me")
      .set(authHeader(guest.accessToken))
      .expect(200);

    // Back to one. Offering a switch to a workspace they have been removed
    // from would send them to a selection screen that refuses them.
    expect(after.body.data.workspaceCount).toBe(1);
  });

  it("counts only this account's own memberships", async () => {
    const suffix = Date.now();
    const busy = await registerUser(app, { email: `wc-busy-${suffix}@zoiko.test` });
    for (const n of [1, 2]) {
      const member = await registerUser(app, { email: `wc-other-${n}-${suffix}@zoiko.test` });
      await request(app)
        .post("/api/v1/membership/members")
        .set(authHeader(busy.accessToken))
        .send({ email: member.email, role: "MEMBER" })
        .expect(201);
    }

    // A workspace with three people is still one workspace to its owner.
    const res = await request(app)
      .get("/api/v1/auth/me")
      .set(authHeader(busy.accessToken))
      .expect(200);
    expect(res.body.data.workspaceCount).toBe(1);
  });
});
