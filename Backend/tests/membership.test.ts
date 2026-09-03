import { describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import { prisma } from "../src/config/prisma.js";
import { authHeader, registerUser } from "./helpers.js";

const app = createApp();

describe("Tenant membership management", () => {
  it("lets an owner add, list, update, suspend, and remove an existing user", async () => {
    const owner = await registerUser(app, { email: "membership-owner@zoiko.test" });
    const candidate = await registerUser(app, { email: "membership-user@zoiko.test" });

    const added = await request(app)
      .post("/api/v1/membership/members")
      .set(authHeader(owner.accessToken))
      .send({ email: candidate.email, role: "MEMBER" })
      .expect(201);

    const membershipId = added.body.data.id;
    expect(added.body.data.tenantId).toBe(owner.tenantId);
    expect(added.body.data.user.email).toBe(candidate.email);

    const list = await request(app)
      .get("/api/v1/membership/members")
      .set(authHeader(owner.accessToken))
      .expect(200);
    expect(list.body.data.members).toHaveLength(2);

    await request(app)
      .patch(`/api/v1/membership/members/${membershipId}`)
      .set(authHeader(owner.accessToken))
      .send({ role: "ADMIN", status: "SUSPENDED" })
      .expect(200)
      .expect((response) => {
        expect(response.body.data.role).toBe("ADMIN");
        expect(response.body.data.status).toBe("SUSPENDED");
      });

    await request(app)
      .delete(`/api/v1/membership/members/${membershipId}`)
      .set(authHeader(owner.accessToken))
      .expect(200);

    const stored = await prisma.tenantMembership.findUnique({ where: { id: membershipId } });
    expect(stored?.status).toBe("REMOVED");
  });

  it("prevents cross-tenant updates and protects the final active owner", async () => {
    const first = await registerUser(app, { email: "boundary-one@zoiko.test" });
    const second = await registerUser(app, { email: "boundary-two@zoiko.test" });

    await request(app)
      .patch(`/api/v1/membership/members/${second.membershipId}`)
      .set(authHeader(first.accessToken))
      .send({ status: "SUSPENDED" })
      .expect(404);

    const response = await request(app)
      .delete(`/api/v1/membership/members/${first.membershipId}`)
      .set(authHeader(first.accessToken))
      .expect(409);
    expect(response.body.error.code).toBe("CONFLICT");
  });

  it("prevents administrators from creating or modifying owners", async () => {
    const owner = await registerUser(app, { email: "admin-boundary-owner@zoiko.test" });
    const admin = await registerUser(app, { email: "admin-boundary-admin@zoiko.test" });
    const candidate = await registerUser(app, { email: "admin-boundary-user@zoiko.test" });

    const added = await request(app)
      .post("/api/v1/membership/members")
      .set(authHeader(owner.accessToken))
      .send({ email: admin.email, role: "ADMIN" })
      .expect(201);

    const login = await request(app)
      .post("/api/v1/auth/login")
      .send({ email: admin.email, password: admin.password, tenantId: owner.tenantId })
      .expect(200);

    await request(app)
      .post("/api/v1/membership/members")
      .set(authHeader(login.body.data.session.accessToken))
      .send({ email: candidate.email, role: "OWNER" })
      .expect(403);

    await request(app)
      .patch(`/api/v1/membership/members/${owner.membershipId}`)
      .set(authHeader(login.body.data.session.accessToken))
      .send({ status: "SUSPENDED" })
      .expect(403);

    expect(added.body.data.role).toBe("ADMIN");
  });

  it("rejects granting SUPPORT to a user who already holds SUPPORT in another tenant", async () => {
    const ownerA = await registerUser(app, { email: "support-single-a@zoiko.test", tenantName: "Tenant A" });
    const ownerB = await registerUser(app, { email: "support-single-b@zoiko.test", tenantName: "Tenant B" });
    const candidate = await registerUser(app, { email: "support-candidate@zoiko.test" });

    // candidate becomes SUPPORT in tenant A — allowed.
    const supportInA = await request(app)
      .post("/api/v1/membership/members")
      .set(authHeader(ownerA.accessToken))
      .send({ email: candidate.email, role: "SUPPORT" })
      .expect(201);
    expect(supportInA.body.data.role).toBe("SUPPORT");

    // tenant B cannot add candidate as SUPPORT — single-workspace Support rule.
    await request(app)
      .post("/api/v1/membership/members")
      .set(authHeader(ownerB.accessToken))
      .send({ email: candidate.email, role: "SUPPORT" })
      .expect(409);

    // tenant B cannot invite candidate as SUPPORT either.
    await request(app)
      .post("/api/v1/membership/invitations")
      .set(authHeader(ownerB.accessToken))
      .send({ email: candidate.email, role: "SUPPORT" })
      .expect(409);

    // Adding candidate to tenant B as MEMBER is fine...
    const memberInB = await request(app)
      .post("/api/v1/membership/members")
      .set(authHeader(ownerB.accessToken))
      .send({ email: candidate.email, role: "MEMBER" })
      .expect(201);

    // ...but promoting that member to SUPPORT there is not.
    await request(app)
      .patch(`/api/v1/membership/members/${memberInB.body.data.id}`)
      .set(authHeader(ownerB.accessToken))
      .send({ role: "SUPPORT" })
      .expect(409);
  });

  it("allows a user to hold SUPPORT in a tenant and later hold it again in a DIFFERENT tenant after it is removed", async () => {
    const ownerA = await registerUser(app, { email: "support-reissue-a@zoiko.test", tenantName: "Tenant A" });
    const ownerB = await registerUser(app, { email: "support-reissue-b@zoiko.test", tenantName: "Tenant B" });
    const candidate = await registerUser(app, { email: "support-reissue-c@zoiko.test" });

    const inA = await request(app)
      .post("/api/v1/membership/members")
      .set(authHeader(ownerA.accessToken))
      .send({ email: candidate.email, role: "SUPPORT" })
      .expect(201);

    // Removing the SUPPORT seat from tenant A frees the seat.
    await request(app)
      .delete(`/api/v1/membership/members/${inA.body.data.id}`)
      .set(authHeader(ownerA.accessToken))
      .expect(200);

    // Now tenant B can grant SUPPORT.
    await request(app)
      .post("/api/v1/membership/members")
      .set(authHeader(ownerB.accessToken))
      .send({ email: candidate.email, role: "SUPPORT" })
      .expect(201);
  });
});
