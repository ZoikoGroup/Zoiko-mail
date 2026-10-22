import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import Stripe from "stripe";
import { createApp } from "../src/app.js";
import { env } from "../src/config/env.js";
import { prisma } from "../src/config/prisma.js";
import { registerUser } from "./helpers.js";

const app = createApp();

/**
 * The Stripe webhook — POST /api/v1/billing/webhook, BillingService.handleWebhook.
 *
 * Webhooks are the only thing allowed to change a workspace's paid plan, so
 * the endpoint is a privileged write reachable from the internet. Pinned here:
 *  - it fails closed: no secret configured → 503; no signature, a signature
 *    made with another secret, a garbage header, or a body altered after
 *    signing → 400, and nothing is recorded or applied;
 *  - a correctly signed event (signed locally with the installed stripe
 *    library's webhooks.generateTestHeaderString — no network) updates the
 *    tenant's subscription and planCode the way the handler intends;
 *  - a redelivered event is acknowledged but not applied twice.
 *
 * Not covered: checkout.session.completed *with* a subscription id. That
 * branch calls stripe.subscriptions.retrieve, a live API call, so only the
 * metadata path (`subscription: null`) is exercised rather than faked.
 */

const WEBHOOK_SECRET = "whsec_test_zoiko_webhook_secret_0123456789";
const DUMMY_KEY = "sk_test_zoiko_dummy_key_not_used_for_network";
const mutableEnv = env as unknown as Record<string, unknown>;
const saved: Record<string, unknown> = {};
const stripe = new Stripe(DUMMY_KEY);

const suffix = `${Date.now()}`;
const PRO = `webhook-pro-${suffix}`;
const TEAM = `webhook-team-${suffix}`;
const priceFor = (code: string) => `price_${code}`;
const createdEventIds: string[] = [];
let sequence = 0;

beforeAll(async () => {
  await prisma.plan.createMany({
    data: [PRO, TEAM].map((code, index) => ({
      code,
      name: `Webhook ${index}`,
      priceMonthly: 7000 + index * 3000,
      userLimit: 25,
      mailboxLimit: 25,
      storageLimitGb: 100,
      features: [],
      active: true,
      stripePriceId: priceFor(code),
    })),
  });
});

afterAll(async () => {
  // Plans and webhook-event rows are global, so this file removes only what
  // it created and leaves the rest of the suite's data alone.
  const plans = await prisma.plan.findMany({ where: { code: { in: [PRO, TEAM] } }, select: { id: true } });
  await prisma.subscription.deleteMany({ where: { planId: { in: plans.map((p) => p.id) } } });
  await prisma.plan.deleteMany({ where: { code: { in: [PRO, TEAM] } } });
  await prisma.stripeWebhookEvent.deleteMany({ where: { stripeEventId: { in: createdEventIds } } });
});

beforeEach(() => {
  for (const key of ["STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET"]) saved[key] = mutableEnv[key];
  Object.assign(mutableEnv, { STRIPE_SECRET_KEY: DUMMY_KEY, STRIPE_WEBHOOK_SECRET: WEBHOOK_SECRET });
});

afterEach(() => {
  Object.assign(mutableEnv, saved);
});

function event(type: string, object: Record<string, unknown>) {
  const id = `evt_test_${suffix}_${++sequence}`;
  createdEventIds.push(id);
  return {
    id,
    object: "event",
    type,
    api_version: "2024-06-20",
    created: Math.floor(Date.now() / 1000),
    data: { object },
  };
}

function signed(body: object, secret = WEBHOOK_SECRET) {
  const payload = JSON.stringify(body);
  return { payload, signature: stripe.webhooks.generateTestHeaderString({ payload, secret }) };
}

function post(payload: string, signature?: string) {
  const req = request(app).post("/api/v1/billing/webhook").set("Content-Type", "application/json");
  if (signature !== undefined) req.set("Stripe-Signature", signature);
  return req.send(payload);
}

function subscriptionObject(tenantId: string, planCode: string, overrides: Record<string, unknown> = {}) {
  const n = ++sequence;
  return {
    id: `sub_test_${suffix}_${n}`,
    object: "subscription",
    customer: `cus_test_${suffix}_${n}`,
    status: "active",
    cancel_at_period_end: false,
    current_period_end: Math.floor(Date.now() / 1000) + 30 * 86_400,
    trial_end: null,
    metadata: { tenantId, planCode },
    items: { object: "list", data: [{ price: { id: priceFor(planCode) } }] },
    ...overrides,
  };
}

const planCodeOf = async (tenantId: string) =>
  (await prisma.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { planCode: true } })).planCode;

describe("an unauthenticated webhook is refused", () => {
  it("fails closed with 503 when no webhook secret is configured", async () => {
    mutableEnv.STRIPE_WEBHOOK_SECRET = undefined;
    const body = event("customer.subscription.updated", {});
    const { payload, signature } = signed(body);

    const res = await post(payload, signature).expect(503);
    expect(res.body.error.code).toBe("BILLING_NOT_CONFIGURED");
    expect(await prisma.stripeWebhookEvent.count({ where: { stripeEventId: body.id } })).toBe(0);
  });

  it("rejects a request with no Stripe-Signature header", async () => {
    const body = event("customer.subscription.updated", {});

    const res = await post(JSON.stringify(body)).expect(400);
    expect(res.body.error.code).toBe("STRIPE_SIGNATURE_INVALID");
    expect(await prisma.stripeWebhookEvent.count({ where: { stripeEventId: body.id } })).toBe(0);
  });

  it("rejects a garbage signature header", async () => {
    const body = event("customer.subscription.updated", {});

    const res = await post(JSON.stringify(body), "t=1,v1=deadbeef").expect(400);
    expect(res.body.error.code).toBe("STRIPE_SIGNATURE_INVALID");
  });

  it("rejects a signature made with a different secret, and applies nothing", async () => {
    const owner = await registerUser(app, { email: `webhook-forged-${Date.now()}@zoiko.test` });
    const before = await planCodeOf(owner.tenantId);
    const body = event("customer.subscription.updated", subscriptionObject(owner.tenantId, TEAM));
    const { payload, signature } = signed(body, "whsec_attacker_secret_not_ours");

    const res = await post(payload, signature).expect(400);
    expect(res.body.error.code).toBe("STRIPE_SIGNATURE_INVALID");
    expect(await planCodeOf(owner.tenantId)).toBe(before);
    expect(await prisma.stripeWebhookEvent.count({ where: { stripeEventId: body.id } })).toBe(0);
  });

  it("rejects a body altered after it was signed", async () => {
    const owner = await registerUser(app, { email: `webhook-tampered-${Date.now()}@zoiko.test` });
    const before = await planCodeOf(owner.tenantId);
    const body = event("customer.subscription.updated", subscriptionObject(owner.tenantId, PRO));
    const { payload, signature } = signed(body);
    // An attacker replaying a genuine PRO event but upgrading it to TEAM.
    const tampered = payload.split(PRO).join(TEAM);
    expect(tampered).not.toBe(payload);

    await post(tampered, signature).expect(400);
    expect(await planCodeOf(owner.tenantId)).toBe(before);
  });
});

describe("a correctly signed event moves the workspace's plan", () => {
  it("customer.subscription.updated records the subscription and syncs the tenant plan", async () => {
    const owner = await registerUser(app, { email: `webhook-sub-${Date.now()}@zoiko.test` });
    const object = subscriptionObject(owner.tenantId, TEAM);
    const body = event("customer.subscription.updated", object);
    const { payload, signature } = signed(body);

    const res = await post(payload, signature).expect(200);
    expect(res.body.data).toMatchObject({
      received: true,
      alreadyProcessed: false,
      eventType: "customer.subscription.updated",
    });

    expect(await planCodeOf(owner.tenantId)).toBe(TEAM);
    const sub = await prisma.subscription.findUniqueOrThrow({
      where: { stripeSubscriptionId: object.id },
      include: { plan: true },
    });
    expect(sub.tenantId).toBe(owner.tenantId);
    expect(sub.plan.code).toBe(TEAM);
    expect(sub.status).toBe("active");
    expect(sub.stripeCustomerId).toBe(object.customer);
    expect(sub.currentPeriodEnd?.getTime()).toBe(object.current_period_end * 1000);
    expect(await prisma.stripeWebhookEvent.count({ where: { stripeEventId: body.id } })).toBe(1);
    expect(
      await prisma.auditEvent.count({
        where: { tenantId: owner.tenantId, eventType: "SUBSCRIPTION_SYNCED" },
      })
    ).toBeGreaterThanOrEqual(1);
  });

  it("resolves the plan from the Stripe price when metadata carries no planCode", async () => {
    const owner = await registerUser(app, { email: `webhook-price-${Date.now()}@zoiko.test` });
    const object = subscriptionObject(owner.tenantId, PRO, { metadata: { tenantId: owner.tenantId } });
    const { payload, signature } = signed(event("customer.subscription.created", object));

    await post(payload, signature).expect(200);

    expect(await planCodeOf(owner.tenantId)).toBe(PRO);
  });

  it("records a past_due subscription without moving the tenant's plan", async () => {
    const owner = await registerUser(app, { email: `webhook-pastdue-${Date.now()}@zoiko.test` });
    const before = await planCodeOf(owner.tenantId);
    const object = subscriptionObject(owner.tenantId, TEAM, { status: "past_due" });
    const { payload, signature } = signed(event("customer.subscription.updated", object));

    await post(payload, signature).expect(200);

    // Only active or trialing subscriptions grant a plan.
    expect(await planCodeOf(owner.tenantId)).toBe(before);
    const sub = await prisma.subscription.findUniqueOrThrow({ where: { stripeSubscriptionId: object.id } });
    expect(sub.status).toBe("past_due");
  });

  it("checkout.session.completed (metadata path) activates the purchased plan", async () => {
    const owner = await registerUser(app, { email: `webhook-checkout-${Date.now()}@zoiko.test` });
    const { payload, signature } = signed(
      event("checkout.session.completed", {
        id: `cs_test_${suffix}`,
        object: "checkout.session",
        customer: `cus_checkout_${suffix}`,
        subscription: null,
        metadata: { tenantId: owner.tenantId, planCode: PRO },
      })
    );

    await post(payload, signature).expect(200);

    expect(await planCodeOf(owner.tenantId)).toBe(PRO);
    const sub = await prisma.subscription.findFirstOrThrow({
      where: { tenantId: owner.tenantId, stripeCustomerId: `cus_checkout_${suffix}` },
      include: { plan: true },
    });
    expect(sub.plan.code).toBe(PRO);
    expect(sub.status).toBe("active");
  });

  it("customer.subscription.deleted marks the subscription canceled", async () => {
    const owner = await registerUser(app, { email: `webhook-deleted-${Date.now()}@zoiko.test` });
    const object = subscriptionObject(owner.tenantId, TEAM);
    const created = signed(event("customer.subscription.updated", object));
    await post(created.payload, created.signature).expect(200);

    const deleted = signed(event("customer.subscription.deleted", { ...object, status: "canceled" }));
    await post(deleted.payload, deleted.signature).expect(200);

    const sub = await prisma.subscription.findUniqueOrThrow({ where: { stripeSubscriptionId: object.id } });
    expect(sub.status).toBe("canceled");
    expect(sub.cancelAtPeriodEnd).toBe(false);
  });

  it("acknowledges a redelivered event without applying it twice", async () => {
    const owner = await registerUser(app, { email: `webhook-replay-${Date.now()}@zoiko.test` });
    const object = subscriptionObject(owner.tenantId, TEAM);
    const body = event("customer.subscription.updated", object);
    const first = signed(body);
    await post(first.payload, first.signature).expect(200);
    const auditsAfterFirst = await prisma.auditEvent.count({
      where: { tenantId: owner.tenantId, eventType: "SUBSCRIPTION_SYNCED" },
    });

    // Stripe retries with the same event id and a fresh signature.
    const again = signed(body);
    const res = await post(again.payload, again.signature).expect(200);

    expect(res.body.data.alreadyProcessed).toBe(true);
    expect(await prisma.stripeWebhookEvent.count({ where: { stripeEventId: body.id } })).toBe(1);
    expect(
      await prisma.auditEvent.count({ where: { tenantId: owner.tenantId, eventType: "SUBSCRIPTION_SYNCED" } })
    ).toBe(auditsAfterFirst);
  });
});
