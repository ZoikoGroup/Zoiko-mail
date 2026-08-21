import { describe, expect, it, vi, beforeEach } from "vitest";
import request from "supertest";

const resolveTxt = vi.hoisted(() => vi.fn());
const resolveMx = vi.hoisted(() => vi.fn());

vi.mock("node:dns/promises", () => ({
  resolveTxt: (...args: unknown[]) => resolveTxt(...args),
  resolveMx: (...args: unknown[]) => resolveMx(...args),
}));

import { createApp } from "../src/app.js";
import { prisma } from "../src/config/prisma.js";
import { authHeader, registerUser } from "./helpers.js";

const app = createApp();

describe("Domains API", () => {
  beforeEach(() => {
    resolveTxt.mockReset();
    resolveMx.mockReset();
  });

  async function ownerAndDomain(email: string, overrides: Partial<{ sendingEnabled: boolean; verificationStatus: string; spfStatus: string; dkimStatus: string; dmarcStatus: string; mxStatus: string }> = {}) {
    const owner = await registerUser(app, { email });
    const domain = await prisma.mailDomain.create({
      data: {
        tenantId: owner.tenantId,
        domainName: `${email.split("@")[0]}.zoiko.test`,
        verificationToken: `zoiko-mail-verification=deadbeef`,
        verificationStatus: (overrides.verificationStatus ?? "PENDING") as never,
        mxStatus: (overrides.mxStatus ?? "PENDING") as never,
        spfStatus: (overrides.spfStatus ?? "PENDING") as never,
        dkimStatus: (overrides.dkimStatus ?? "PENDING") as never,
        dmarcStatus: (overrides.dmarcStatus ?? "PENDING") as never,
        sendingEnabled: overrides.sendingEnabled ?? false,
      },
    });
    return { owner, domain };
  }

  it("adds a domain with a verification token and rejects duplicates", async () => {
    const owner = await registerUser(app, { email: "dom-add-owner@zoiko.test" });

    const res = await request(app)
      .post("/api/v1/domains/")
      .set(authHeader(owner.accessToken))
      .send({ domainName: "Acme-Example.COM" })
      .expect(201);

    expect(res.body.data.domainName).toBe("acme-example.com");
    expect(res.body.data.verificationToken).toMatch(/^zoiko-mail-verification=[a-f0-9]{48}$/);
    expect(res.body.data.sendingEnabled).toBe(false);

    const dup = await request(app)
      .post("/api/v1/domains/")
      .set(authHeader(owner.accessToken))
      .send({ domainName: "acme-example.com" })
      .expect(409);
    expect(dup.body.error.code).toBe("CONFLICT");
  });

  it("rejects an add payload missing domainName", async () => {
    const owner = await registerUser(app, { email: "dom-schema-owner@zoiko.test" });

    await request(app)
      .post("/api/v1/domains/")
      .set(authHeader(owner.accessToken))
      .send({ domain: "wrong-key.com" })
      .expect(400);
  });

  it("lists only the caller tenant's domains", async () => {
    const { owner, domain } = await ownerAndDomain("dom-list-owner@zoiko.test");
    const other = await registerUser(app, { email: "dom-list-other@zoiko.test" });
    await prisma.mailDomain.create({
      data: { tenantId: other.tenantId, domainName: "other.zoiko.test", verificationToken: "tok-other" },
    });

    const res = await request(app)
      .get("/api/v1/domains/")
      .set(authHeader(owner.accessToken))
      .expect(200);

    const ids = res.body.data.domains.map((d: { id: string }) => d.id);
    expect(ids).toContain(domain.id);
    expect(ids).not.toContain(
      (await prisma.mailDomain.findFirstOrThrow({ where: { tenantId: other.tenantId } })).id
    );
  });

  it("diagnostics pass when DNS records are correct and stores a check snapshot", async () => {
    const { owner, domain } = await ownerAndDomain("dom-diag-owner@zoiko.test");

    resolveTxt.mockImplementation((name: string) => {
      if (name === `_dmarc.${domain.domainName}`) return Promise.resolve([["v=DMARC1; p=quarantine"]]);
      if (name === `default._domainkey.${domain.domainName}`) return Promise.resolve([["v=DKIM1; k=rsa; p=MIIB"]]);
      return Promise.resolve([
        [`zoiko-mail-verification=deadbeef`],
        ["v=spf1 include:zoiko.dev ~all"],
      ]);
    });
    resolveMx.mockResolvedValue([{ exchange: "mail.zoiko.dev", priority: 10 }]);

    const res = await request(app)
      .post(`/api/v1/domains/${domain.id}/diagnostics`)
      .set(authHeader(owner.accessToken))
      .expect(200);

    console.log("DIAG RESPONSE:", JSON.stringify(res.body.data, null, 2).slice(0, 800));
    console.log("TXT CALLS:", JSON.stringify(resolveTxt.mock.calls), "RESULTS:", JSON.stringify(await Promise.all(resolveTxt.mock.results.map(async (r) => (r.type === "return" ? await r.value : r.value)))));

    expect(res.body.data.verificationStatus).toBe("VERIFIED");
    expect(res.body.data.mxStatus).toBe("VALID");
    expect(res.body.data.spfStatus).toBe("VALID");
    expect(res.body.data.dkimStatus).toBe("VALID");
    expect(res.body.data.dmarcStatus).toBe("VALID");
    expect(res.body.data.records.verificationTxt).toBe("zoiko-mail-verification=deadbeef");
    expect(res.body.data.records.dmarcHost).toBe(`_dmarc.${domain.domainName}`);

    const snapshot = await prisma.domainDnsCheck.findFirstOrThrow({
      where: { tenantId: owner.tenantId, domainId: domain.id },
    });
    expect(snapshot.verificationStatus).toBe("VERIFIED");
    expect(snapshot.spfStatus).toBe("VALID");

    const refreshed = await prisma.mailDomain.findUniqueOrThrow({ where: { id: domain.id } });
    expect(refreshed.lastCheckedAt).not.toBeNull();
  });

  it("diagnostics fail with error details and keep sending disabled", async () => {
    const { owner, domain } = await ownerAndDomain("dom-diagfail-owner@zoiko.test");

    resolveTxt.mockRejectedValue(Object.assign(new Error("queryAaaa ENOTFOUND"), { code: "ENOTFOUND" }));
    resolveMx.mockRejectedValue(Object.assign(new Error("queryMx ENOTFOUND"), { code: "ENOTFOUND" }));

    const res = await request(app)
      .post(`/api/v1/domains/${domain.id}/diagnostics`)
      .set(authHeader(owner.accessToken))
      .expect(200);

    expect(res.body.data.verificationStatus).toBe("FAILED");
    expect(res.body.data.mxStatus).toBe("INVALID");
    expect(res.body.data.spfStatus).toBe("INVALID");
    expect(res.body.data.dkimStatus).toBe("INVALID");
    expect(res.body.data.dmarcStatus).toBe("INVALID");
    expect(res.body.data.errorDetails.txt).toBeDefined();
    expect(res.body.data.errorDetails.mx).toBeDefined();
    expect(res.body.data.sendingEnabled).toBe(false);
  });

  it("refuses activation until all checks pass, then enables sending", async () => {
    const { owner, domain } = await ownerAndDomain("dom-activate-owner@zoiko.test");

    await request(app)
      .post(`/api/v1/domains/${domain.id}/activate`)
      .set(authHeader(owner.accessToken))
      .expect(409);

    await prisma.mailDomain.update({
      where: { id: domain.id },
      data: {
        verificationStatus: "VERIFIED",
        mxStatus: "VALID",
        spfStatus: "VALID",
        dkimStatus: "VALID",
        dmarcStatus: "VALID",
      },
    });

    const res = await request(app)
      .post(`/api/v1/domains/${domain.id}/activate`)
      .set(authHeader(owner.accessToken))
      .expect(200);

    expect(res.body.data.sendingEnabled).toBe(true);
    expect(res.body.data.activatedAt).not.toBeNull();
  });

  it("returns check history newest-first", async () => {
    const { owner, domain } = await ownerAndDomain("dom-history-owner@zoiko.test");

    await prisma.domainDnsCheck.createMany({
      data: [
        { tenantId: owner.tenantId, domainId: domain.id, verificationStatus: "FAILED", mxStatus: "INVALID", spfStatus: "INVALID", dkimStatus: "INVALID", dmarcStatus: "INVALID", checkedAt: new Date(Date.now() - 3600_000) },
        { tenantId: owner.tenantId, domainId: domain.id, verificationStatus: "VERIFIED", mxStatus: "VALID", spfStatus: "VALID", dkimStatus: "VALID", dmarcStatus: "VALID", checkedAt: new Date() },
      ],
    });

    const res = await request(app)
      .get(`/api/v1/domains/${domain.id}/checks`)
      .set(authHeader(owner.accessToken))
      .expect(200);

    const checks = res.body.data.checks;
    expect(checks).toHaveLength(2);
    expect(checks[0].verificationStatus).toBe("VERIFIED");
    expect(checks[1].verificationStatus).toBe("FAILED");
  });

  it("deletes inactive domains but blocks active ones", async () => {
    const active = await ownerAndDomain("dom-del-active@zoiko.test", { sendingEnabled: true });
    const inactive = await ownerAndDomain("dom-del-inactive@zoiko.test");

    await request(app)
      .delete(`/api/v1/domains/${active.domain.id}`)
      .set(authHeader(active.owner.accessToken))
      .expect(409);

    const res = await request(app)
      .delete(`/api/v1/domains/${inactive.domain.id}`)
      .set(authHeader(inactive.owner.accessToken))
      .expect(200);
    expect(res.body.data.domainName).toBe(inactive.domain.domainName);

    expect(await prisma.mailDomain.findUnique({ where: { id: inactive.domain.id } })).toBeNull();
    expect(await prisma.domainDnsCheck.count({ where: { domainId: inactive.domain.id } })).toBe(0);

    await request(app)
      .delete(`/api/v1/domains/${inactive.domain.id}`)
      .set(authHeader(inactive.owner.accessToken))
      .expect(404);
  });

  it("forbids members from managing domains", async () => {
    const owner = await registerUser(app, { email: "dom-rbac-owner@zoiko.test" });
    const member = await registerUser(app, { email: "dom-rbac-member@zoiko.test" });
    await request(app)
      .post("/api/v1/membership/members")
      .set(authHeader(owner.accessToken))
      .send({ email: member.email, role: "MEMBER" })
      .expect(201);
    const login = await request(app)
      .post("/api/v1/auth/login")
      .send({ email: member.email, password: member.password, tenantId: owner.tenantId })
      .expect(200);
    const token = login.body.data.session.accessToken;

    await request(app).get("/api/v1/domains/").set(authHeader(token)).expect(403);
    await request(app)
      .post("/api/v1/domains/")
      .set(authHeader(token))
      .send({ domainName: "nope.zoiko.test" })
      .expect(403);
  });
});
