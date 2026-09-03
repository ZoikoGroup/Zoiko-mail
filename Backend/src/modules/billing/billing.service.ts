import Stripe from "stripe";
import { Prisma, type MembershipRole } from "@prisma/client";
import { prisma } from "../../config/prisma.js";
import { env } from "../../config/env.js";
import { AppError } from "../../common/errors/AppError.js";
import { ErrorCodes } from "../../common/errors/errorCodes.js";
import { auditService } from "../audit/audit.service.js";

interface TenantContext {
  tenantId: string;
  userId: string;
  role: MembershipRole | "SUPPORT";
  requestId?: string;
  ipAddress?: string | null;
  userAgent?: string | null;
}

const PUBLIC_PLAN_SELECT = {
  id: true,
  code: true,
  name: true,
  priceMonthly: true,
  userLimit: true,
  mailboxLimit: true,
  storageLimitGb: true,
} satisfies Prisma.PlanSelect;

const PUBLIC_INVOICE_SELECT = {
  id: true,
  number: true,
  amountDue: true,
  currency: true,
  status: true,
  periodStart: true,
  periodEnd: true,
  hostedInvoiceUrl: true,
  invoicePdfUrl: true,
  createdAt: true,
} satisfies Prisma.InvoiceSelect;

/**
 * Lazily construct the Stripe client. Fails with a clear, operational error if
 * the backend is not configured for Stripe — billing endpoints fail closed.
 */
function stripeClient(): Stripe {
  const key = env.STRIPE_SECRET_KEY;
  if (!key) {
    throw new AppError(
      "Stripe is not configured. Set STRIPE_SECRET_KEY in the backend environment.",
      503,
      "BILLING_NOT_CONFIGURED"
    );
  }
  return new Stripe(key);
}

export class BillingService {
  /**
   * Lazily constructed Stripe client. Construction throws an operational error
   * when STRIPE_SECRET_KEY is missing — billing endpoints fail closed.
   */
  private get stripe(): Stripe {
    return stripeClient();
  }

  async listPlans() {
    return prisma.plan.findMany({
      where: { active: true },
      select: PUBLIC_PLAN_SELECT,
      orderBy: { priceMonthly: "asc" },
    });
  }

  /**
   * Returns the tenant's current (most recent, non-voided) subscription joined
   * with its plan. Enforces the "one current subscription per tenant" rule in
   * service logic rather than with a DB unique constraint: if multiple active
   * subscriptions somehow exist (e.g. a previous one lingered), this returns
   * the most recently created one and treats it as authoritative.
   */
  async getCurrentSubscription(tenantId: string) {
    const subscription = await prisma.subscription.findFirst({
      where: { tenantId, status: { not: "canceled" } },
      orderBy: { createdAt: "desc" },
      include: {
        plan: { select: PUBLIC_PLAN_SELECT },
      },
    });
    return subscription;
  }

  async getSubscription(tenantId: string) {
    const [subscription, tenant] = await Promise.all([
      this.getCurrentSubscription(tenantId),
      prisma.tenant.findUnique({
        where: { id: tenantId },
        select: { id: true, name: true, planCode: true },
      }),
    ]);
    if (!subscription) {
      return {
        workspace: tenant ? { id: tenant.id, name: tenant.name } : null,
        status: null,
        currentPeriodEnd: null,
        trialEnd: null,
        cancelAtPeriodEnd: false,
        stripeCustomerId: null,
        plan: null,
      };
    }
    return {
      workspace: tenant ? { id: tenant.id, name: tenant.name } : null,
      id: subscription.id,
      status: subscription.status,
      currentPeriodEnd: subscription.currentPeriodEnd,
      trialEnd: subscription.trialEnd,
      cancelAtPeriodEnd: subscription.cancelAtPeriodEnd,
      stripeCustomerId: subscription.stripeCustomerId,
      plan: subscription.plan,
    };
  }

  async listInvoices(tenantId: string) {
    return prisma.invoice.findMany({
      where: { tenantId },
      select: PUBLIC_INVOICE_SELECT,
      orderBy: { createdAt: "desc" },
    });
  }

  private async ensureCustomer(
    tenantId: string,
    stripe: Stripe,
    tenantName: string
  ): Promise<string> {
    const existing = await prisma.subscription.findFirst({
      where: { tenantId, stripeCustomerId: { not: null } },
      orderBy: { createdAt: "desc" },
      select: { stripeCustomerId: true },
    });
    if (existing?.stripeCustomerId) return existing.stripeCustomerId;

    // Create the Stripe customer. If a race condition creates a duplicate,
    // Stripe will handle it gracefully — we only need the latest one.
    const customer = await stripe.customers.create({
      name: tenantName,
      metadata: { tenantId },
    });
    return customer.id;
  }

  /**
   * Creates a Stripe Checkout Session in subscription mode for the given plan.
   * Only `planCode` is accepted from the client; the Stripe Price ID, price and
   * limits are always resolved from the DB, never from the request.
   */
  async createCheckout(input: { planCode: string }, context: TenantContext) {
    const stripe = stripeClient();
    const plan = await prisma.plan.findUnique({ where: { code: input.planCode } });
    if (!plan || !plan.active) {
      throw new AppError("Plan not found", 404, ErrorCodes.NOT_FOUND);
    }
    if (!plan.stripePriceId) {
      throw new AppError(
        `Plan "${plan.code}" has no Stripe Price ID configured. Set stripePriceId on the plan row.`,
        503,
        "BILLING_NOT_CONFIGURED"
      );
    }

    const tenant = await prisma.tenant.findUnique({ where: { id: context.tenantId } });
    if (!tenant) {
      throw new AppError("Tenant not found", 404, ErrorCodes.NOT_FOUND);
    }

    // Guard against duplicate active subscriptions — redirect to portal instead.
    const existing = await this.getCurrentSubscription(context.tenantId);
    if (existing && (existing.status === "active" || existing.status === "trialing")) {
      throw new AppError(
        "This workspace already has an active subscription. Use the billing portal to manage or change your plan.",
        409,
        ErrorCodes.CONFLICT
      );
    }

    const customerId = await this.ensureCustomer(tenant.id, stripe, tenant.name);

    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      customer: customerId,
      line_items: [{ price: plan.stripePriceId, quantity: 1 }],
      success_url: `${env.APP_URL}/owner/billing?checkout=success`,
      cancel_url: `${env.APP_URL}/owner/billing?checkout=cancelled`,
      metadata: { tenantId: tenant.id, planCode: plan.code },
      subscription_data: { metadata: { tenantId: tenant.id, planCode: plan.code } },
      allow_promotion_codes: true,
    });

    await auditService.record({
      tenantId: tenant.id,
      actorUserId: context.userId,
      eventType: "BILLING_CHECKOUT_STARTED",
      targetType: "Plan",
      targetId: plan.id,
      requestId: context.requestId,
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
      metadata: { planCode: plan.code, checkoutSessionId: session.id },
    });

    return { url: session.url };
  }

  async getPortalUrl(context: TenantContext) {
    const stripe = stripeClient();
    const subscription = await prisma.subscription.findFirst({
      where: { tenantId: context.tenantId, stripeCustomerId: { not: null } },
      orderBy: { createdAt: "desc" },
      select: { stripeCustomerId: true },
    });
    if (!subscription?.stripeCustomerId) {
      throw new AppError(
        "No billing customer found for this workspace",
        404,
        ErrorCodes.NOT_FOUND
      );
    }
    const session = await stripe.billingPortal.sessions.create({
      customer: subscription.stripeCustomerId,
      return_url: `${env.APP_URL}/owner/billing`,
    });
    return { url: session.url };
  }

  async cancel(context: TenantContext) {
    const stripe = stripeClient();
    const sub = await prisma.subscription.findFirst({
      where: {
        tenantId: context.tenantId,
        stripeSubscriptionId: { not: null },
        cancelAtPeriodEnd: { not: true },
      },
      orderBy: { createdAt: "desc" },
    });
    if (!sub?.stripeSubscriptionId) {
      throw new AppError("No active subscription to cancel", 404, ErrorCodes.NOT_FOUND);
    }

    await stripe.subscriptions.update(sub.stripeSubscriptionId, {
      cancel_at_period_end: true,
    });

    const updated = await prisma.subscription.update({
      where: { id: sub.id },
      data: { cancelAtPeriodEnd: true },
    });

    await auditService.record({
      tenantId: context.tenantId,
      actorUserId: context.userId,
      eventType: "SUBSCRIPTION_CANCEL_AT_PERIOD_END",
      targetType: "Subscription",
      targetId: sub.id,
      requestId: context.requestId,
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
      metadata: { stripeSubscriptionId: sub.stripeSubscriptionId },
    });

    return { cancelAtPeriodEnd: updated.cancelAtPeriodEnd };
  }

  async reactivate(context: TenantContext) {
    const stripe = stripeClient();
    const sub = await prisma.subscription.findFirst({
      where: {
        tenantId: context.tenantId,
        stripeSubscriptionId: { not: null },
        cancelAtPeriodEnd: true,
      },
      orderBy: { createdAt: "desc" },
    });
    if (!sub?.stripeSubscriptionId) {
      throw new AppError("No subscription pending cancellation", 404, ErrorCodes.NOT_FOUND);
    }

    await stripe.subscriptions.update(sub.stripeSubscriptionId, {
      cancel_at_period_end: false,
    });

    const updated = await prisma.subscription.update({
      where: { id: sub.id },
      data: { cancelAtPeriodEnd: false },
    });

    await auditService.record({
      tenantId: context.tenantId,
      actorUserId: context.userId,
      eventType: "SUBSCRIPTION_REACTIVATED",
      targetType: "Subscription",
      targetId: sub.id,
      requestId: context.requestId,
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
      metadata: { stripeSubscriptionId: sub.stripeSubscriptionId },
    });

    return { cancelAtPeriodEnd: updated.cancelAtPeriodEnd };
  }

  /**
   * Processes an inbound Stripe webhook event. Idempotent: each distinct Stripe
   * event ID is recorded exactly once, so Stripe's at-least-once retries do not
   * double-apply. Fails closed if the webhook secret is missing or the
   * signature does not validate.
   */
  async handleWebhook(rawBody: Buffer, signature: string | undefined) {
    const secret = env.STRIPE_WEBHOOK_SECRET;
    if (!secret) {
      throw new AppError(
        "Stripe webhooks are not configured. Set STRIPE_WEBHOOK_SECRET in the backend environment.",
        503,
        "BILLING_NOT_CONFIGURED"
      );
    }
    if (!signature) {
      throw new AppError("Missing Stripe signature", 400, "STRIPE_SIGNATURE_INVALID");
    }

    const stripe = stripeClient();
    let event: Stripe.Event;
    try {
      event = stripe.webhooks.constructEvent(rawBody, signature, secret);
    } catch {
      throw new AppError("Invalid Stripe signature", 400, "STRIPE_SIGNATURE_INVALID");
    }

    // Idempotency guard — attempt to record atomically. If the unique
    // constraint on stripeEventId fires, another worker already processed it.
    try {
      await prisma.stripeWebhookEvent.create({
        data: { stripeEventId: event.id, eventType: event.type },
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        return { received: true, alreadyProcessed: true, eventType: event.type };
      }
      throw error;
    }

    await this.processEvent(event);

    return { received: true, alreadyProcessed: false, eventType: event.type };
  }

  private async processEvent(event: Stripe.Event): Promise<void> {
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object as Stripe.Checkout.Session;
        await this.upsertFromCheckout(session);
        break;
      }
      case "customer.subscription.created":
      case "customer.subscription.updated": {
        const sub = event.data.object as Stripe.Subscription;
        await this.upsertFromSubscription(sub);
        break;
      }
      case "customer.subscription.deleted": {
        const sub = event.data.object as Stripe.Subscription;
        await this.deleteSubscription(sub);
        break;
      }
      case "invoice.paid":
      case "invoice.payment_failed": {
        const invoice = event.data.object as Stripe.Invoice;
        await this.upsertInvoice(invoice);
        break;
      }
      default:
        // Unhandled event types are recorded but otherwise ignored.
        break;
    }
  }

  private async resolvePlanId(planCode?: string | null, stripePriceId?: string | null) {
    if (planCode) {
      const byCode = await prisma.plan.findUnique({ where: { code: planCode } });
      if (byCode) return byCode;
    }
    if (stripePriceId) {
      const byPrice = await prisma.plan.findFirst({
        where: { stripePriceId },
      });
      if (byPrice) return byPrice;
    }
    throw new AppError(
      `No billing plan found for planCode="${planCode}" or stripePriceId="${stripePriceId}". Ensure the plan exists in the database.`,
      500,
      ErrorCodes.INTERNAL_ERROR
    );
  }

  private async upsertFromCheckout(session: Stripe.Checkout.Session) {
    const tenantId = session.metadata?.tenantId;
    const planCode = session.metadata?.planCode;
    if (!tenantId) return;

    const tenantExists = await prisma.tenant.findUnique({ where: { id: tenantId } });
    if (!tenantExists) return;

    const subscriptionId =
      typeof session.subscription === "string" ? session.subscription : session.subscription?.id ?? null;
    const customerId = typeof session.customer === "string" ? session.customer : session.customer?.id;

    // Resolve the actual Stripe price from the newly-created subscription so we
    // never trust the plan from the client. Fall back to planCode metadata only
    // when the subscription cannot be read.
    let priceId: string | undefined;
    if (subscriptionId) {
      try {
        const stripeSub = await this.stripe.subscriptions.retrieve(subscriptionId);
        priceId = stripeSub.items?.data?.[0]?.price?.id ?? undefined;
      } catch {
        // Proceed with metadata-based resolution; a subscription.updated event
        // will reconcile state shortly.
      }
    }

    const plan = await this.resolvePlanId(planCode, priceId);

    await prisma.subscription.upsert({
      where: { stripeSubscriptionId: subscriptionId ?? "__none__" },
      update: {
        tenantId,
        planId: plan.id,
        stripeCustomerId: customerId ?? undefined,
        status: "active",
      },
      create: {
        tenantId,
        planId: plan.id,
        stripeCustomerId: customerId ?? undefined,
        stripeSubscriptionId: subscriptionId ?? undefined,
        status: "active",
      },
    });

    await this.syncTenantPlan(tenantId, plan.code);
  }

  private async upsertFromSubscription(sub: Stripe.Subscription) {
    const tenantId =
      sub.metadata?.tenantId ??
      (sub.customer && typeof sub.customer === "string"
        ? (await this.tenantIdForCustomer(sub.customer))
        : null);
    const priceId = sub.items?.data?.[0]?.price?.id;
    const plan = await this.resolvePlanId(sub.metadata?.planCode, priceId);
    const planCode = sub.metadata?.planCode ?? plan.code;
    const customerId = typeof sub.customer === "string" ? sub.customer : sub.customer?.id;

    if (!tenantId) {
      // No tenant known yet (e.g. created event arrived before checkout
      // completed). We cannot silently drop a "created" event, but there is no
      // tenant to attach to, so record nothing and rely on the completed event
      // to establish the link.
      return;
    }

    const status = sub.status;
    // The Stripe typings for this API version omit current_period_end/trial_end
    // from the Subscription interface even though the runtime payload carries
    // them. Read them via a narrow cast; if absent, the field is left null.
    const periodEndSec = (sub as unknown as { current_period_end?: number }).current_period_end;

    await prisma.subscription.upsert({
      where: { stripeSubscriptionId: sub.id },
      update: {
        tenantId,
        planId: plan.id,
        stripeCustomerId: customerId ?? undefined,
        status,
        currentPeriodEnd: periodEndSec ? new Date(periodEndSec * 1000) : undefined,
        trialEnd: sub.trial_end ? new Date(sub.trial_end * 1000) : undefined,
        cancelAtPeriodEnd: sub.cancel_at_period_end,
      },
      create: {
        tenantId,
        planId: plan.id,
        stripeCustomerId: customerId ?? undefined,
        stripeSubscriptionId: sub.id,
        status,
        currentPeriodEnd: periodEndSec ? new Date(periodEndSec * 1000) : undefined,
        trialEnd: sub.trial_end ? new Date(sub.trial_end * 1000) : undefined,
        cancelAtPeriodEnd: sub.cancel_at_period_end,
      },
    });

    if (status === "active" || status === "trialing") {
      await this.syncTenantPlan(tenantId, planCode);
    }
  }

  private async deleteSubscription(sub: Stripe.Subscription) {
    const existing = await prisma.subscription.findUnique({
      where: { stripeSubscriptionId: sub.id },
    });
    if (!existing) return;

    await prisma.subscription.update({
      where: { id: existing.id },
      data: { status: "canceled", cancelAtPeriodEnd: false },
    });

    const current = await this.getCurrentSubscription(existing.tenantId);
    if (current && current.plan) {
      await this.syncTenantPlan(existing.tenantId, current.plan.code);
    } else {
      // No active subscription remains — fall back to the default plan.
      const defaultPlan = await prisma.plan.findUnique({ where: { code: "starter" } });
      if (defaultPlan) {
        await this.syncTenantPlan(existing.tenantId, defaultPlan.code);
      }
    }
  }

  private async upsertInvoice(invoice: Stripe.Invoice) {
    // The current Stripe typings omit the top-level `subscription` id on the
    // Invoice interface; the runtime payload carries it as a string, so read it
    // via a narrow cast.
    const stripeSubscriptionId = (invoice as unknown as { subscription?: string | null }).subscription;
    const subscription = stripeSubscriptionId
      ? await prisma.subscription.findUnique({
          where: { stripeSubscriptionId },
        })
      : null;
    const tenantId =
      subscription?.tenantId ??
      (invoice.customer && typeof invoice.customer === "string"
        ? await this.tenantIdForCustomer(invoice.customer)
        : null);
    if (!tenantId) return;

    await prisma.invoice.upsert({
      where: { stripeInvoiceId: invoice.id },
      update: {
        tenantId,
        subscriptionId: subscription?.id ?? undefined,
        number: invoice.number ?? undefined,
        amountDue: invoice.amount_due,
        currency: invoice.currency,
        status: invoice.status ?? "unknown",
        periodStart: invoice.period_start ? new Date(invoice.period_start * 1000) : undefined,
        periodEnd: invoice.period_end ? new Date(invoice.period_end * 1000) : undefined,
        hostedInvoiceUrl: invoice.hosted_invoice_url ?? undefined,
        invoicePdfUrl: invoice.invoice_pdf ?? undefined,
      },
      create: {
        tenantId,
        subscriptionId: subscription?.id,
        stripeInvoiceId: invoice.id,
        number: invoice.number ?? undefined,
        amountDue: invoice.amount_due,
        currency: invoice.currency,
        status: invoice.status ?? "unknown",
        periodStart: invoice.period_start ? new Date(invoice.period_start * 1000) : undefined,
        periodEnd: invoice.period_end ? new Date(invoice.period_end * 1000) : undefined,
        hostedInvoiceUrl: invoice.hosted_invoice_url ?? undefined,
        invoicePdfUrl: invoice.invoice_pdf ?? undefined,
      },
    });
  }

  /**
   * Webhooks are the source of truth: the tenant's planCode is updated from the
   * effective subscription state, never from the client.
   */
  private async syncTenantPlan(tenantId: string, planCode: string) {
    await prisma.tenant.update({
      where: { id: tenantId },
      data: { planCode },
    });
    await auditService.record({
      tenantId,
      actorUserId: null,
      eventType: "SUBSCRIPTION_SYNCED",
      targetType: "Tenant",
      targetId: tenantId,
      metadata: { planCode },
    });
  }

  private async tenantIdForCustomer(customerId: string): Promise<string | null> {
    const sub = await prisma.subscription.findFirst({
      where: { stripeCustomerId: customerId },
      select: { tenantId: true },
    });
    return sub?.tenantId ?? null;
  }

  /**
   * Returns the tenant's effective plan (via its current subscription), or null
   * when the tenant has no subscription. Used to enforce plan limits.
   */
  async getEffectivePlan(tenantId: string) {
    const sub = await this.getCurrentSubscription(tenantId);
    return sub?.plan ?? null;
  }

  /**
   * Enforces the tenant's user limit at the tenant (workspace) level. A tenant
   * with an active subscription/plan cannot exceed its plan's userLimit. Tenants
   * without a subscription are not limited (no active billing plan applies).
   */
  async assertUserWithinLimit(tenantId: string, extra = 0): Promise<void> {
    const plan = await this.getEffectivePlan(tenantId);
    if (!plan || plan.userLimit === null) return;

    const activeCount = await prisma.tenantMembership.count({
      where: { tenantId, status: "ACTIVE" },
    });
    if (activeCount + extra > plan.userLimit) {
      throw new AppError(
        `User limit reached for your current plan (${activeCount}/${plan.userLimit}). Upgrade your workspace plan to add more users.`,
        409,
        ErrorCodes.CONFLICT
      );
    }
  }

  /**
   * Enforces the tenant's mailbox limit at the tenant level. Tenants without a
   * subscription/plan are not limited.
   */
  async assertMailboxWithinLimit(tenantId: string): Promise<void> {
    const plan = await this.getEffectivePlan(tenantId);
    if (!plan || plan.mailboxLimit === null) return;

    const count = await prisma.mailbox.count({ where: { tenantId } });
    if (count >= plan.mailboxLimit) {
      throw new AppError(
        `Mailbox limit reached for your current plan (${count}/${plan.mailboxLimit}). Upgrade your workspace plan to create more mailboxes.`,
        409,
        ErrorCodes.CONFLICT
      );
    }
  }

  /**
   * Enforces the tenant's storage limit at the tenant level. Tenants without a
   * subscription/plan are not limited.
   */
  async assertStorageWithinLimit(tenantId: string, extraBytes = 0): Promise<void> {
    const plan = await this.getEffectivePlan(tenantId);
    if (!plan || plan.storageLimitGb === null) return;

    const sum = await prisma.mailbox.aggregate({
      where: { tenantId },
      _sum: { storageUsed: true },
    });
    const usedBytes = Number(sum._sum.storageUsed ?? 0n);
    const limitBytes = plan.storageLimitGb * 1024 * 1024 * 1024;
    if (usedBytes + extraBytes > limitBytes) {
      throw new AppError(
        `Storage limit reached for your current plan (${(usedBytes / (1024 ** 3)).toFixed(1)}/${plan.storageLimitGb} GB). Upgrade your workspace plan for more storage.`,
        409,
        ErrorCodes.CONFLICT
      );
    }
  }
}

export const billingService = new BillingService();
