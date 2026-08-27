"use client";

import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import { ProtectedRoute } from "@/components/owner/ProtectedRoute";
import { PageHeader } from "@/components/ui/PageHeader";
import { ProgressBar } from "@/components/ui/ProgressBar";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorState } from "@/components/ui/ErrorState";
import { Skeleton } from "@/components/ui/Skeleton";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import {
  usePlans,
  useSubscription,
  useInvoices,
  useCheckout,
  useBillingPortal,
  useCancelSubscription,
  useReactivateSubscription,
} from "@/lib/billing-hooks";
import { useMembers, useAdminMailboxes } from "@/lib/owner-hooks";
import {
  CreditCard,
  ArrowUpRight,
  ExternalLink,
  Receipt,
  Users,
  Mail,
  HardDrive,
  Loader2,
  Building2,
} from "lucide-react";

function formatMoney(cents: number, currency = "usd") {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: currency.toUpperCase(),
  }).format(cents / 100);
}

function formatDate(d: string | null) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

function statusVariant(status: string): "ok" | "warn" | "crit" | "nu" {
  switch (status) {
    case "active":
    case "trialing":
    case "paid":
      return "ok";
    case "past_due":
    case "incomplete":
    case "open":
    case "uncollectible":
      return "warn";
    case "canceled":
    case "void":
      return "nu";
    default:
      return "nu";
  }
}

export default function BillingPage() {
  return (
    <Suspense
      fallback={
        <ProtectedRoute allowedRoles={["OWNER"]}>
          <div className="mx-auto max-w-4xl space-y-6 px-4 py-8 sm:px-6">
            <PageHeader
              title="Workspace Subscription & Billing"
              description="Manage your workspace plan, payment, and billing history."
            />
            <div className="zoiko-card space-y-3 p-6">
              <Skeleton className="h-6 w-48" />
              <Skeleton className="h-4 w-64" />
            </div>
          </div>
        </ProtectedRoute>
      }
    >
      <BillingPageInner />
    </Suspense>
  );
}

function BillingPageInner() {
  const searchParams = useSearchParams();
  const checkoutNotice = searchParams.get("checkout");

  const { data: plans = [], isLoading: plansLoading } = usePlans();
  const {
    data: sub,
    isLoading: subLoading,
    error,
    refetch,
  } = useSubscription();
  const { data: invoices = [], isLoading: invoicesLoading } = useInvoices();
  const { data: members = [] } = useMembers();
  const { data: mailboxes = [] } = useAdminMailboxes();

  const checkout = useCheckout();
  const portal = useBillingPortal();
  const cancel = useCancelSubscription();
  const reactivate = useReactivateSubscription();

  const [cancelOpen, setCancelOpen] = useState(false);

  const isLoading = plansLoading || subLoading;
  const activeUsers = members.filter((m) => m.status === "ACTIVE").length;
  const storageUsedMb = mailboxes.reduce((sum, m) => sum + m.storageUsedMb, 0);
  const storageUsedGb = +(storageUsedMb / 1024).toFixed(1);

  const currentPlan = sub?.plan ?? null;
  const workspaceName = sub?.workspace?.name ?? "";
  // A subscription only "exists" when the tenant has a non-void subscription
  // row with an actual status (active/trialing/…). null means no subscription.
  const hasSubscription = Boolean(sub?.id && sub.status);

  const isActiveish =
    hasSubscription &&
    (sub?.status === "active" || sub?.status === "trialing");
  const showCancelAtPeriodEnd = hasSubscription && Boolean(sub?.cancelAtPeriodEnd);
  // The Stripe Customer may exist even before an active subscription (e.g.
  // after a cancelled/deleted sub) — only show Portal when a customer exists.
  const hasStripeCustomer = Boolean(sub?.stripeCustomerId);
  // When cancellation-at-period-end is set, the sub stays active until the end
  // of the current period, so surface it as "Active until <date>".
  const currentPeriodLabel = sub?.status === "trialing"
    ? `Active until ${formatDate(sub.trialEnd ?? null)}`
    : `Active until ${formatDate(sub?.currentPeriodEnd ?? null)}`;

  const handleSelectPlan = (planCode: string) => {
    if (planCode === currentPlan?.code) return;
    checkout.mutate(planCode, {
      onSuccess: (data) => {
        if (data.url) window.location.href = data.url;
      },
    });
  };

  const handlePortal = () => {
    portal.mutate(undefined, {
      onSuccess: (data) => {
        if (data.url) window.location.href = data.url;
      },
    });
  };

  const handleCancel = () => {
    cancel.mutate(undefined, {
      onSuccess: () => setCancelOpen(false),
    });
  };

  const handleReactivate = () => {
    reactivate.mutate();
  };

  return (
    <ProtectedRoute allowedRoles={["OWNER"]}>
      <div className="mx-auto max-w-4xl space-y-6 px-4 py-8 sm:px-6">
        <PageHeader
          title="Workspace Subscription & Billing"
          description="Manage your workspace plan, payment, and billing history."
        />
        {workspaceName && (
          <div className="flex items-center gap-2 text-sm text-[var(--ink2)]">
            <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-[var(--accent-soft)] text-[var(--accent-ink)]">
              <Building2 className="h-4 w-4" />
            </span>
            <span>
              Managing the <span className="font-semibold">{workspaceName}</span>{" "}
              workspace subscription
            </span>
          </div>
        )}

        {checkoutNotice === "success" && (
          <div className="rounded-xl border border-[var(--ok-soft)] bg-[var(--ok-soft)] px-4 py-3 text-sm text-[var(--ok)]">
            Your subscription has been updated. It may take a moment to reflect
            here.
          </div>
        )}
        {checkoutNotice === "cancelled" && (
          <div className="rounded-xl border border-[var(--warn-soft)] bg-[var(--warn-soft)] px-4 py-3 text-sm text-[var(--warn)]">
            Checkout was cancelled. No changes were made to your subscription.
          </div>
        )}

        {error ? (
          <div className="zoiko-card">
            <ErrorState message={error.message} onRetry={() => refetch()} />
          </div>
        ) : (
          <>
            {/* Current Plan */}
            <div className="zoiko-card p-6">
              {isLoading ? (
                <div className="space-y-3">
                  <Skeleton className="h-6 w-48" />
                  <Skeleton className="h-4 w-64" />
                </div>
              ) : !hasSubscription ? (
                /* No active subscription */
                <div className="flex flex-col items-start gap-4 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex items-center gap-3">
                    <span className="inline-flex h-10 w-10 items-center justify-center rounded-lg bg-[var(--s2)] text-[var(--ink3)]">
                      <CreditCard className="h-5 w-5" />
                    </span>
                    <div>
                      <h3 className="text-base font-semibold text-[var(--ink)]">
                        No active subscription
                      </h3>
                      <p className="mt-0.5 text-[11px] text-[var(--ink3)]">
                        {workspaceName
                          ? `${workspaceName} has no active subscription.`
                          : "Choose a plan to start using Zoiko Mail."}
                      </p>
                    </div>
                  </div>
                  <button
                    onClick={() =>
                      document
                        .getElementById("plan-picker")
                        ?.scrollIntoView({ behavior: "smooth" })
                    }
                    className="zoiko-btn pri"
                  >
                    Choose Plan
                  </button>
                </div>
              ) : (
                /* Active subscription */
                <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex items-center gap-3">
                    <span className="inline-flex h-10 w-10 items-center justify-center rounded-lg bg-[var(--accent-soft)] text-[var(--accent-ink)]">
                      <CreditCard className="h-5 w-5" />
                    </span>
                    <div>
                      {workspaceName && (
                        <div className="text-[11px] font-medium uppercase tracking-wide text-[var(--ink3)]">
                          {workspaceName}
                        </div>
                      )}
                      <h3 className="text-base font-semibold text-[var(--ink)]">
                        {currentPlan?.name ?? "Subscription"}
                      </h3>
                      <div className="mt-0.5 flex flex-wrap items-center gap-2">
                        <StatusBadge
                          variant={statusVariant(sub?.status ?? "none")}
                          dot
                        >
                          {sub?.status ?? "unsubscribed"}
                        </StatusBadge>
                        {currentPlan && (
                          <span className="text-[11px] text-[var(--ink3)]">
                            {formatMoney(currentPlan.priceMonthly)}/month
                          </span>
                        )}
                      </div>
                      {showCancelAtPeriodEnd ? (
                        <p className="mt-1 text-xs font-medium text-[var(--warn)]">
                          {currentPeriodLabel}
                          {" · Your subscription will not renew."}
                        </p>
                      ) : isActiveish && (sub?.trialEnd || sub?.currentPeriodEnd) ? (
                        <p className="mt-1 text-[11px] text-[var(--ink3)]">
                          {sub?.status === "trialing"
                            ? `Trial ends ${formatDate(sub.trialEnd)}`
                            : `Next billing date: ${formatDate(sub.currentPeriodEnd)}`}
                        </p>
                      ) : (
                        (sub?.trialEnd || sub?.currentPeriodEnd) && (
                          <p className="mt-1 text-[11px] text-[var(--ink3)]">
                            {sub?.status === "trialing"
                              ? `Trial ends ${formatDate(sub.trialEnd)}`
                              : `Next billing date: ${formatDate(sub.currentPeriodEnd)}`}
                          </p>
                        )
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {showCancelAtPeriodEnd ? (
                      <>
                        <button onClick={handleReactivate} className="zoiko-btn pri">
                          {reactivate.isPending ? "Reactivating…" : "Reactivate"}
                        </button>
                        {hasStripeCustomer && (
                          <button onClick={handlePortal} className="zoiko-btn">
                            <ExternalLink className="h-3.5 w-3.5" /> Manage Billing
                          </button>
                        )}
                      </>
                    ) : (
                      <>
                        {hasStripeCustomer && (
                          <button onClick={handlePortal} className="zoiko-btn">
                            <ExternalLink className="h-3.5 w-3.5" /> Manage Billing
                          </button>
                        )}
                        {isActiveish && (
                          <button
                            onClick={() => setCancelOpen(true)}
                            className="zoiko-btn sm crit"
                          >
                            Cancel Subscription
                          </button>
                        )}
                      </>
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* Usage */}
            {currentPlan && (
              <div className="mt-6 grid grid-cols-3 gap-4">
                <div className="rounded-lg bg-[var(--s2)] p-3">
                  <div className="flex items-center gap-2 text-[11px] text-[var(--ink3)]">
                    <Users className="h-3.5 w-3.5" /> Users
                  </div>
                  <div className="mt-1 font-mono-num text-lg font-semibold text-[var(--ink)]">
                    {activeUsers}{" "}
                    <span className="text-sm font-normal text-[var(--ink3)]">
                      / {currentPlan.userLimit}
                    </span>
                  </div>
                  <ProgressBar
                    value={activeUsers}
                    max={currentPlan.userLimit}
                    className="mt-1"
                  />
                </div>
                <div className="rounded-lg bg-[var(--s2)] p-3">
                  <div className="flex items-center gap-2 text-[11px] text-[var(--ink3)]">
                    <Mail className="h-3.5 w-3.5" /> Mailboxes
                  </div>
                  <div className="mt-1 font-mono-num text-lg font-semibold text-[var(--ink)]">
                    {mailboxes.length}{" "}
                    <span className="text-sm font-normal text-[var(--ink3)]">
                      / {currentPlan.mailboxLimit}
                    </span>
                  </div>
                  <ProgressBar
                    value={mailboxes.length}
                    max={currentPlan.mailboxLimit}
                    className="mt-1"
                  />
                </div>
                <div className="rounded-lg bg-[var(--s2)] p-3">
                  <div className="flex items-center gap-2 text-[11px] text-[var(--ink3)]">
                    <HardDrive className="h-3.5 w-3.5" /> Storage
                  </div>
                  <div className="mt-1 font-mono-num text-lg font-semibold text-[var(--ink)]">
                    {storageUsedGb} GB{" "}
                    <span className="text-sm font-normal text-[var(--ink3)]">
                      / {currentPlan.storageLimitGb} GB
                    </span>
                  </div>
                  <ProgressBar
                    value={storageUsedGb}
                    max={currentPlan.storageLimitGb}
                    className="mt-1"
                  />
                </div>
              </div>
            )}

            {/* Plans */}
            <div id="plan-picker" className="zoiko-card p-6">
              <div className="mb-4 flex items-center justify-between">
                <h3 className="text-sm font-semibold text-[var(--ink)]">
                  Plans
                </h3>
                <span className="text-[11px] text-[var(--ink3)]">
                  Select a plan to start, upgrade, or switch.
                </span>
              </div>
              {plansLoading ? (
                <div className="space-y-3">
                  <Skeleton className="h-16 w-full" />
                  <Skeleton className="h-16 w-full" />
                </div>
              ) : (
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  {plans.map((plan) => {
                    const isCurrent = plan.code === currentPlan?.code;
                    return (
                      <button
                        key={plan.id}
                        onClick={() => handleSelectPlan(plan.code)}
                        disabled={
                          isCurrent ||
                          checkout.isPending ||
                          portal.isPending
                        }
                        className={`flex flex-col rounded-xl border p-4 text-left transition ${
                          isCurrent
                            ? "border-[var(--accent)] bg-[var(--accent-soft)]"
                            : "border-[var(--border)] bg-[var(--surface)] hover:border-[var(--accent)]"
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <span className="text-sm font-semibold text-[var(--ink)]">
                            {plan.name}
                          </span>
                          {isCurrent && (
                            <StatusBadge variant="accent">Current</StatusBadge>
                          )}
                        </div>
                        <div className="mt-1 font-mono-num text-xl font-semibold text-[var(--ink)]">
                          {formatMoney(plan.priceMonthly)}
                          <span className="text-xs font-normal text-[var(--ink3)]">
                            /mo
                          </span>
                        </div>
                        <div className="mt-3 space-y-1 text-xs text-[var(--ink3)]">
                          <div>{plan.userLimit} users</div>
                          <div>{plan.mailboxLimit} mailboxes</div>
                          <div>{plan.storageLimitGb} GB storage</div>
                        </div>
                        {!isCurrent && (
                          <span className="mt-3 inline-flex items-center gap-1 text-xs font-medium text-[var(--accent-ink)]">
                            {checkout.isPending &&
                            checkout.variables === plan.code ? (
                              <>
                                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                Redirecting…
                              </>
                            ) : (
                              <>
                                Switch <ArrowUpRight className="h-3.5 w-3.5" />
                              </>
                            )}
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              )}
              {checkout.isError && (
                <p className="mt-3 text-sm text-[var(--crit)]">
                  {checkout.error?.message ??
                    "Couldn't start checkout. Please try again."}
                </p>
              )}
            </div>

            {/* Billing History */}
            <div className="zoiko-card">
              <div className="border-b border-[var(--border)] px-4 py-3">
                <h3 className="text-sm font-semibold text-[var(--ink)]">
                  Billing History
                </h3>
              </div>
              <div className="divide-y divide-[var(--border)]">
                {invoicesLoading ? (
                  <div className="space-y-3 p-4">
                    <Skeleton className="h-10 w-full" />
                    <Skeleton className="h-10 w-full" />
                  </div>
                ) : invoices.length === 0 ? (
                  <EmptyState
                    icon={<Receipt className="h-7 w-7" />}
                    title="No billing history"
                    description="Your billing history will appear here once you have active invoices."
                  />
                ) : (
                  invoices.map((inv) => (
                    <div
                      key={inv.id}
                      className="flex items-center justify-between px-4 py-3"
                    >
                      <div>
                        <div className="text-sm text-[var(--ink)]">
                          {inv.number ?? "Invoice"}
                        </div>
                        <div className="font-mono-num text-[11px] text-[var(--ink3)]">
                          {formatDate(inv.createdAt)}
                          {inv.periodEnd && ` · ${formatDate(inv.periodEnd)}`}
                        </div>
                      </div>
                      <div className="flex items-center gap-3">
                        <span className="font-mono-num text-sm font-medium text-[var(--ink)]">
                          {formatMoney(inv.amountDue, inv.currency)}
                        </span>
                        <StatusBadge variant={statusVariant(inv.status)}>
                          {inv.status}
                        </StatusBadge>
                        {inv.hostedInvoiceUrl && (
                          <a
                            href={inv.hostedInvoiceUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="text-[var(--accent-ink)] hover:underline"
                            aria-label="View invoice"
                          >
                            <ExternalLink className="h-4 w-4" />
                          </a>
                        )}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </>
        )}

        <ConfirmDialog
          open={cancelOpen}
          onClose={() => setCancelOpen(false)}
          onConfirm={handleCancel}
          title="Cancel subscription"
          message="Your subscription will not renew at the end of the current billing period. You can reactivate it anytime before then."
          confirmLabel="Cancel subscription"
          variant="warning"
          loading={cancel.isPending}
        />
      </div>
    </ProtectedRoute>
  );
}
