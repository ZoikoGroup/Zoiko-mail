import { describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import { authHeader, loginUser, registerUser } from "./helpers.js";
import { prisma } from "../src/config/prisma.js";

const app = createApp();

async function ownerWithMember(appRef: typeof app) {
  const owner = await registerUser(appRef, { email: `owner-${Date.now()}-${Math.random()}@zoiko.test`, tenantName: "Owner Transfer Tenant" });
  const member = await registerUser(appRef, { email: `member-${Date.now()}-${Math.random()}@zoiko.test` });
  const created = await request(appRef).post("/api/v1/membership/members")
    .set(authHeader(owner.accessToken))
    .send({ email: member.email, role: "MEMBER" })
    .expect(201);
  const memberSession = await loginUser(appRef, member.email, member.password, owner.tenantId);
  return { owner, member, membershipId: created.body.data.id, memberSession };
}

async function promoteToOwner(ownerToken: string, membershipId: string) {
  await request(app).patch(`/api/v1/membership/members/${membershipId}`)
    .set(authHeader(ownerToken))
    .send({ role: "OWNER" })
    .expect(200);
}

describe("Ownership transfer (two-person)", () => {
  it("requires a second Owner to approve and swaps roles on approval", async () => {
    const { owner, membershipId, memberSession } = await ownerWithMember(app);

    const secondOwner = await registerUser(app, { email: `second-${Date.now()}-${Math.random()}@zoiko.test` });
    const secondCreated = await request(app).post("/api/v1/membership/members")
      .set(authHeader(owner.accessToken))
      .send({ email: secondOwner.email, role: "MEMBER" })
      .expect(201);
    await promoteToOwner(owner.accessToken, secondCreated.body.data.id);
    const secondSession = await loginUser(app, secondOwner.email, secondOwner.password, owner.tenantId);

    await request(app).post("/api/v1/ownership/transfers")
      .set(authHeader(owner.accessToken))
      .send({ targetMembershipId: owner.membershipId })
      .expect(400);

    const initiated = await request(app).post("/api/v1/ownership/transfers")
      .set(authHeader(owner.accessToken))
      .send({ targetMembershipId: membershipId })
      .expect(201);
    expect(initiated.body.data.status).toBe("PENDING");
    const transferId = initiated.body.data.id;

    // Initiator cannot approve their own transfer.
    await request(app).post(`/api/v1/ownership/transfers/${transferId}/approve`)
      .set(authHeader(owner.accessToken)).expect(400);

    // A MEMBER cannot approve at all, even for the right workspace.
    await request(app).post(`/api/v1/ownership/transfers/${transferId}/approve`)
      .set(authHeader(memberSession.accessToken)).expect(403);

    // Only one PENDING transfer may exist at a time.
    const thirdMember = await registerUser(app, { email: `third-${Date.now()}-${Math.random()}@zoiko.test` });
    const thirdCreated = await request(app).post("/api/v1/membership/members")
      .set(authHeader(owner.accessToken))
      .send({ email: thirdMember.email, role: "MEMBER" })
      .expect(201);
    await request(app).post("/api/v1/ownership/transfers")
      .set(authHeader(owner.accessToken))
      .send({ targetMembershipId: thirdCreated.body.data.id }).expect(409);

    // A different Owner approves and the swap executes.
    const approved = await request(app).post(`/api/v1/ownership/transfers/${transferId}/approve`)
      .set(authHeader(secondSession.accessToken)).expect(200);
    expect(approved.body.data.transfer.status).toBe("COMPLETED");

    const targetRow = await prisma.tenantMembership.findUnique({ where: { id: membershipId } });
    const initiatorRow = await prisma.tenantMembership.findUnique({ where: { id: owner.membershipId } });
    expect(targetRow?.role).toBe("OWNER");
    expect(initiatorRow?.role).toBe("ADMIN");

    // The demoted initiator can no longer use owner-only endpoints.
    await request(app).get("/api/v1/ownership").set(authHeader(owner.accessToken)).expect(403);
  });

  it("lets only the initiator cancel a pending transfer", async () => {
    const { owner, membershipId } = await ownerWithMember(app);

    const otherOwner = await registerUser(app, { email: `other-${Date.now()}-${Math.random()}@zoiko.test` });
    const otherCreated = await request(app).post("/api/v1/membership/members")
      .set(authHeader(owner.accessToken))
      .send({ email: otherOwner.email, role: "MEMBER" })
      .expect(201);
    await promoteToOwner(owner.accessToken, otherCreated.body.data.id);
    const otherSession = await loginUser(app, otherOwner.email, otherOwner.password, owner.tenantId);

    const initiated = await request(app).post("/api/v1/ownership/transfers")
      .set(authHeader(owner.accessToken))
      .send({ targetMembershipId: membershipId })
      .expect(201);
    const transferId = initiated.body.data.id;

    // A second Owner cannot cancel on the initiator's behalf.
    await request(app).post(`/api/v1/ownership/transfers/${transferId}/cancel`)
      .set(authHeader(otherSession.accessToken)).expect(403);

    await request(app).post(`/api/v1/ownership/transfers/${transferId}/cancel`)
      .set(authHeader(owner.accessToken)).expect(200);

    const listed = await request(app).get("/api/v1/ownership")
      .set(authHeader(owner.accessToken)).expect(200);
    expect(listed.body.data.transfers.find((t: any) => t.id === transferId)?.status).toBe("CANCELLED");

    // The slot is free again.
    await request(app).post("/api/v1/ownership/transfers")
      .set(authHeader(owner.accessToken))
      .send({ targetMembershipId: membershipId }).expect(201);
  });
});