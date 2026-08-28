import { apiRequest } from "./api-client";

// ─── Types ─────────────────────────────────────────────────────────────────────

export interface Plan {
  id: string;
  code: string;
  name: string;
  priceMonthly: number; // cents
  userLimit: number;
  mailboxLimit: number;
  storageLimitGb: number;
}

export interface WorkspaceInfo {
  id: string;
  name: string;
}

export interface Subscription {
  workspace: WorkspaceInfo | null;
  id: string | null;
  status: string | null;
  currentPeriodEnd: string | null;
  trialEnd: string | null;
  cancelAtPeriodEnd: boolean;
  stripeCustomerId: string | null;
  plan: Plan | null;
}

export interface Invoice {
  id: string;
  number: string | null;
  amountDue: number; // cents
  currency: string;
  status: string;
  periodStart: string | null;
  periodEnd: string | null;
  hostedInvoiceUrl: string | null;
  invoicePdfUrl: string | null;
  createdAt: string;
}

// ─── API ───────────────────────────────────────────────────────────────────────

export async function getPlans(): Promise<Plan[]> {
  return apiRequest<Plan[]>("/billing/plans");
}

export async function getSubscription(): Promise<Subscription | null> {
  return apiRequest<Subscription | null>("/billing/subscription");
}

export async function createCheckout(planCode: string): Promise<{ url: string }> {
  return apiRequest<{ url: string }>("/billing/checkout", {
    method: "POST",
    body: { planCode },
  });
}

export async function getPortalUrl(): Promise<{ url: string }> {
  return apiRequest<{ url: string }>("/billing/portal");
}

export async function cancelSubscription(): Promise<{ cancelAtPeriodEnd: boolean }> {
  return apiRequest<{ cancelAtPeriodEnd: boolean }>("/billing/cancel", {
    method: "POST",
  });
}

export async function reactivateSubscription(): Promise<{ cancelAtPeriodEnd: boolean }> {
  return apiRequest<{ cancelAtPeriodEnd: boolean }>("/billing/reactivate", {
    method: "PATCH",
  });
}

export async function getInvoices(): Promise<Invoice[]> {
  return apiRequest<Invoice[]>("/billing/invoices");
}
