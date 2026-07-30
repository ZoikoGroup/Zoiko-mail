import { describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import { prisma } from "../src/config/prisma.js";
import { authHeader, registerUser } from "./helpers.js";

const app = createApp();

async function allowSending(accessToken: string) {
  const policy = await request(app).post("/api/v1/policies")
    .set(authHeader(accessToken))
    .send({ type: "SENDING", name: "Allow sending", rules: { defaultEffect: "ALLOW", conditions: [] } })
    .expect(201);
  await request(app).post(`/api/v1/policies/${policy.body.data.id}/activate`)
    .set(authHeader(accessToken)).expect(200);
}

describe("Custom-domain DNS enforcement", () => {
  it("records readable DNS history and blocks sending until authentication passes", async () => {
    const owner = await registerUser(app, { email: "dns-owner@custom.test" });
    await allowSending(owner.accessToken);
    const domain = await request(app).post("/api/v1/domains")
      .set(authHeader(owner.accessToken)).send({ domainName: "custom.test" }).expect(201);
    const draft = await request(app).post("/api/v1/mail/drafts")
      .set(authHeader(owner.accessToken))
      .send({ subject: "DNS protected", recipients: { to: ["external@example.test"] } }).expect(201);

    await request(app).post(`/api/v1/mail/drafts/${draft.body.data.id}/send`)
      .set(authHeader(owner.accessToken)).expect(403);
    const activationDenied = await request(app).post(`/api/v1/domains/${domain.body.data.id}/activate`)
      .set(authHeader(owner.accessToken)).expect(409);
    expect(activationDenied.body.error.message).toContain("TXT ownership verification");

    const diagnostics = await request(app).post(`/api/v1/domains/${domain.body.data.id}/diagnostics`)
      .set(authHeader(owner.accessToken)).expect(200);
    expect(diagnostics.body.data).toMatchObject({
      verificationStatus: "FAILED",
      spfStatus: "INVALID",
      dkimStatus: "INVALID",
      dmarcStatus: "INVALID",
      sendingEnabled: false,
    });
    expect(diagnostics.body.data.firstCheckedAt).toBeTruthy();
    const history = await request(app).get(`/api/v1/domains/${domain.body.data.id}/checks`)
      .set(authHeader(owner.accessToken)).expect(200);
    expect(history.body.data.checks).toHaveLength(1);

    await prisma.mailDomain.update({
      where: { id: domain.body.data.id },
      data: {
        verificationStatus: "VERIFIED", spfStatus: "VALID",
        dkimStatus: "VALID", dmarcStatus: "VALID",
      },
    });
    const activated = await request(app).post(`/api/v1/domains/${domain.body.data.id}/activate`)
      .set(authHeader(owner.accessToken)).expect(200);
    expect(activated.body.data.sendingEnabled).toBe(true);
    await request(app).post(`/api/v1/mail/drafts/${draft.body.data.id}/send`)
      .set(authHeader(owner.accessToken)).expect(200);
  });

  it("keeps DNS check history tenant isolated", async () => {
    const first = await registerUser(app, { email: "dns-first@zoiko.test" });
    const second = await registerUser(app, { email: "dns-second@zoiko.test" });
    const domain = await request(app).post("/api/v1/domains")
      .set(authHeader(first.accessToken)).send({ domainName: "private.test" }).expect(201);
    await request(app).get(`/api/v1/domains/${domain.body.data.id}/checks`)
      .set(authHeader(second.accessToken)).expect(404);
    await request(app).post(`/api/v1/domains/${domain.body.data.id}/activate`)
      .set(authHeader(second.accessToken)).expect(404);
  });
});
