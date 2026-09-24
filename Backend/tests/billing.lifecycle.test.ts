import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import { prisma } from "../src/config/prisma.js";
import { authHeader, registerUser } from "./helpers.js";

// The test DB is migrated but never seeded, so `plans` starts empty. This suite
// owns the four tier rows itself, mirroring prisma/seed.ts, and its workspace
// therefore lands on the Free plan exactly as a seeded dev DB would. It runs
// before the membership and invitation files (alphabetical order, one shared
// DB), so the Free row it leaves behind is the plan those suites operate
// under — its 10 seats sit comfortably above their 4-member maxima.
const app = createApp();

beforeAll(async () => {
  await prisma.plan.create({
    data: {
      code: "free",
      name: "Free",
      tagline: "For individuals getting started with governed email.",
      priceMonthly: 0,
      userLimit: 10,
      mailboxLimit: 10,
      storageLimitGb: 25,
      features: ["Intelligent Inbox & Calendar"],
      active: true,
    },
  });

  await prisma.plan.createMany({
    data: [
      {
        code: "professional",
        name: "Professional",
        tagline: "For professionals who want deeper AI and follow-through.",
        priceMonthly: 7000,
        userLimit: 25,
        mailboxLimit: 25,
        storageLimitGb: 100,
        features: ["Everything in Free"],
        active: true,
      },
      {
        code: "team",
        name: "Team",
        tagline: "For teams sharing addresses and coordinating replies.",
        priceMonthly: 10000,
        userLimit: 50,
        mailboxLimit: 75,
        storageLimitGb: 500,
        features: ["Everything in Professional"],
        active: true,
      },
      {
        code: "business",
        name: "Business",
        tagline: "For organizations that need administration and controls.",
        priceMonthly: 15000,
        userLimit: 200,
        mailboxLimit: 200,
        storageLimitGb: 2000,
        features: ["Everything in Team"],
        active: true,
      },
    ],
  });
});

afterAll(async () => {
  await prisma.subscription.deleteMany({});
  await prisma.plan.deleteMany({});
});

describe("billing lifecycle", () => {
  it("a fresh workspace starts on the Free plan", async () => {
    const owner = await registerUser(app, {
      email: `billing-fresh-${Date.now()}@zoiko.test`,
    });

    const sub = await prisma.subscription.findFirst({
      where: { tenantId: owner.tenantId, status: "active" },
      include: { plan: true },
    });
    expect(sub).not.toBeNull();
    expect(sub!.plan.code).toBe("free");
    expect(sub!.stripeSubscriptionId).toBeNull();

    const tenant = await prisma.tenant.findUnique({
      where: { id: owner.tenantId },
    });
    expect(tenant?.planCode).toBe("free");

    const res = await request(app)
      .get("/api/v1/billing/subscription")
      .set(authHeader(owner.accessToken));
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe("active");
    expect(res.body.data.plan.code).toBe("free");
    expect(res.body.data.plan.tagline).toContain("individuals");
    expect(Array.isArray(res.body.data.plan.features)).toBe(true);
  });

  it("the plan list exposes the four tiers in price order", async () => {
    const owner = await registerUser(app, {
      email: `billing-plans-${Date.now()}@zoiko.test`,
    });

    const res = await request(app)
      .get("/api/v1/billing/plans")
      .set(authHeader(owner.accessToken));
    expect(res.status).toBe(200);

    const plans = res.body.data;
    expect(plans).toHaveLength(4);
    expect(plans.map((p: { code: string }) => p.code)).toEqual([
      "free",
      "professional",
      "team",
      "business",
    ]);
    expect(plans[0].priceMonthly).toBe(0);
    expect(plans[0].tagline).toMatch(/individuals/);
    expect(plans[0].features.length).toBeGreaterThan(0);
  });

  it("a workspace already on Free is guarded against a second checkout", async () => {
    const owner = await registerUser(app, {
      email: `billing-free-again-${Date.now()}@zoiko.test`,
    });

    // Registration mints the Free row, so the plan picker shows "Current plan"
    // and checkout is unreachable — but if a client calls it anyway the
    // duplicate-active guard must fire rather than mint a second subscription.
    const res = await request(app)
      .post("/api/v1/billing/checkout")
      .set({
        ...authHeader(owner.accessToken),
        "Idempotency-Key": `idem-checkout-free-${Date.now()}`,
      })
      .send({ planCode: "free" });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("CONFLICT");

    const active = await prisma.subscription.findMany({
      where: { tenantId: owner.tenantId, status: "active" },
    });
    expect(active).toHaveLength(1);

    const tenant = await prisma.tenant.findUnique({
      where: { id: owner.tenantId },
    });
    expect(tenant?.planCode).toBe("free");
  });

  it("a paid plan checkout fails closed and never charges without a price", async () => {
    const owner = await registerUser(app, {
      email: `billing-paid-${Date.now()}@zoiko.test`,
    });

    // Put the workspace into a no-active-subscription state (as if the Free
    // baseline had lapsed) so checkout reaches the Stripe branch, then assert
    // it fails closed: no key in the test environment and no Stripe price on
    // the row both surface as BILLING_NOT_CONFIGURED, and no subscription row
    // is ever minted for money that was not taken.
    await prisma.subscription.updateMany({
      where: { tenantId: owner.tenantId },
      data: { status: "canceled" },
    });

    const res = await request(app)
      .post("/api/v1/billing/checkout")
      .set({
        ...authHeader(owner.accessToken),
        "Idempotency-Key": `idem-checkout-paid-${Date.now()}`,
      })
      .send({ planCode: "professional" });
    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe("BILLING_NOT_CONFIGURED");

    const tenant = await prisma.tenant.findUnique({
      where: { id: owner.tenantId },
    });
    expect(tenant?.planCode).toBe("free");

    const active = await prisma.subscription.findMany({
      where: { tenantId: owner.tenantId, status: "active" },
    });
    expect(active).toHaveLength(0);
  });

  it("a local Free subscription cannot be cancelled", async () => {
    const owner = await registerUser(app, {
      email: `billing-cancel-${Date.now()}@zoiko.test`,
    });

    const res = await request(app)
      .post("/api/v1/billing/cancel")
      .set({
        ...authHeader(owner.accessToken),
        "Idempotency-Key": `idem-cancel-${Date.now()}`,
      });
    // Without a Stripe key the endpoint fails closed (503); with one it
    // reports that there is nothing to cancel (404). Either way the local Free
    // row is untouched and the workspace stays on Free.
    expect([404, 503]).toContain(res.status);

    const sub = await prisma.subscription.findFirst({
      where: { tenantId: owner.tenantId },
    });
    expect(sub?.status).toBe("active");
    expect(sub?.cancelAtPeriodEnd).toBe(false);
  });
});