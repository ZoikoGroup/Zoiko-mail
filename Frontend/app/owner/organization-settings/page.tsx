"use client";

import { useState, useEffect, type ReactNode } from "react";
import Link from "next/link";
import { ProtectedRoute } from "@/components/owner/ProtectedRoute";
import { PageHeader } from "@/components/ui/PageHeader";
import { Skeleton } from "@/components/ui/Skeleton";
import { useMe } from "@/lib/auth-hooks";
import { useUpdateTenant } from "@/lib/owner-hooks";
import type { MeResponse } from "@/lib/auth-api";
import { Ban, Building2, ChevronRight, Download, Save, Settings2, Trash2, type LucideIcon } from "lucide-react";

function SettingsRow({
  href,
  icon: Icon,
  title,
  description,
  disabled,
}: {
  href: string;
  icon: LucideIcon;
  title: string;
  description: string;
  disabled?: boolean;
}) {
  const content = (
    <div className="flex items-center gap-3 py-3">
      <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[var(--s2)] text-[var(--ink2)]">
        <Icon className="h-4 w-4" />
      </span>
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium text-[var(--ink)]">{title}</div>
        <div className="truncate text-[11px] text-[var(--ink3)]">{description}</div>
      </div>
      {!disabled && <ChevronRight className="h-4 w-4 shrink-0 text-[var(--ink3)]" />}
    </div>
  );

  if (disabled) return <div className="block opacity-60">{content}</div>;

  return (
    <Link href={href} className="block rounded-lg px-2 -mx-2 hover:bg-[var(--s2)]">
      {content}
    </Link>
  );
}

function SettingsCard({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <div className="zoiko-card p-6">
      <div className="mb-2 flex items-center gap-3">
        <span className="inline-flex h-10 w-10 items-center justify-center rounded-lg bg-[var(--accent-soft)] text-[var(--accent-ink)]">
          <Settings2 className="h-5 w-5" />
        </span>
        <div>
          <h3 className="text-sm font-semibold text-[var(--ink)]">{title}</h3>
          <p className="text-[11px] text-[var(--ink3)]">{description}</p>
        </div>
      </div>
      <div className="divide-y divide-[var(--border)]">{children}</div>
    </div>
  );
}

export default function OrganizationSettingsPage() {
  const { data, isLoading, error } = useMe();
  const me = data as MeResponse | undefined;
  const isOwner = me?.membership.role === "OWNER";
  const [name, setName] = useState("");
  const [initialized, setInitialized] = useState(false);
  const updateTenant = useUpdateTenant();

  useEffect(() => {
    if (me?.tenant.name && !initialized) {
      setName(me.tenant.name);
      setInitialized(true);
    }
  }, [me, initialized]);

  if (isLoading) {
    return (
      <ProtectedRoute allowedRoles={["OWNER", "ADMIN"]}>
        <div className="mx-auto max-w-3xl space-y-6 px-4 py-8 sm:px-6">
          <PageHeader title="Organization Settings" description="Manage your organization's basic information." />
          <div className="zoiko-card p-6">
            <div className="flex items-center gap-3 mb-6">
              <Skeleton variant="rect" className="h-10 w-10 rounded-lg" />
              <div className="space-y-2">
                <Skeleton className="h-5 w-40" />
                <Skeleton className="h-3 w-64" />
              </div>
            </div>
            <div className="space-y-4">
              <Skeleton className="h-9 w-full" />
              <Skeleton className="h-9 w-full" />
              <Skeleton className="h-9 w-full" />
            </div>
          </div>
        </div>
      </ProtectedRoute>
    );
  }

  if (error) {
    return (
      <ProtectedRoute allowedRoles={["OWNER", "ADMIN"]}>
        <div className="mx-auto max-w-3xl space-y-6 px-4 py-8 sm:px-6">
          <PageHeader title="Organization Settings" description="Manage your organization's basic information." />
          <div className="zoiko-card p-6 text-center">
            <p className="text-sm text-[var(--crit)]">Failed to load organization settings. Please try again.</p>
          </div>
        </div>
      </ProtectedRoute>
    );
  }

  return (
    <ProtectedRoute allowedRoles={["OWNER", "ADMIN"]}>
      <div className="mx-auto max-w-3xl space-y-6 px-4 py-8 sm:px-6">
        <PageHeader
          title="Organization Settings"
          description="Manage your organization's basic information."
        />
        <div className="zoiko-card p-6">
          <div className="flex items-center gap-3 mb-6">
            <span className="inline-flex h-10 w-10 items-center justify-center rounded-lg bg-[var(--accent-soft)] text-[var(--accent-ink)]">
              <Building2 className="h-5 w-5" />
            </span>
            <div>
              <h3 className="text-sm font-semibold text-[var(--ink)]">Organization Details</h3>
              <p className="text-[11px] text-[var(--ink3)]">Basic information about your workspace.</p>
            </div>
          </div>

          <div className="space-y-4">
            <div>
              <label className="mb-1 block text-sm font-medium text-[var(--ink2)]">Organization Name</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="h-9 w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 text-sm text-[var(--ink)] focus:border-[var(--accent)] focus:outline-none focus:ring-1 focus:ring-[var(--accent)]"
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-[var(--ink2)]">Plan</label>
              <div className="flex items-center gap-2">
                <span className="zoiko-pill accent">{me?.tenant.planCode ?? "—"}</span>
                <Link href="/owner/billing" className="zoiko-btn sm">
                  View Billing
                </Link>
              </div>
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-[var(--ink2)]">Workspace ID</label>
              <code className="block rounded-md bg-[var(--s2)] px-3 py-1.5 font-mono text-xs text-[var(--ink3)]">
                {me?.tenant.id ?? "—"}
              </code>
            </div>
          </div>

          <div className="mt-6 flex items-center gap-3">
            <button
              onClick={() => {
                if (name.trim() && name !== me?.tenant.name) {
                  updateTenant.mutate({ name: name.trim() });
                }
              }}
              className="zoiko-btn pri"
              disabled={updateTenant.isPending || !name.trim() || name === me?.tenant.name}
            >
              <Save className="h-3.5 w-3.5" />
              {updateTenant.isPending ? "Saving…" : "Save Changes"}
            </button>
            {updateTenant.isSuccess && <span className="text-xs text-[var(--ok)]">Saved successfully.</span>}
            {updateTenant.isError && <span className="text-xs text-[var(--crit)]">Failed to save. Please try again.</span>}
          </div>
        </div>

        <SettingsCard
          title="Workspace Preferences"
          description="Defaults and preferences that apply to the whole workspace."
        >
          <SettingsRow
            href="/owner/general-settings"
            icon={Settings2}
            title="General Settings"
            description="Configure workspace preferences."
          />
        </SettingsCard>

        <SettingsCard
          title="Security & Governance"
          description="Delivery protection rules that keep sending reputation intact."
        >
          <SettingsRow
            href="/owner/suppressions"
            icon={Ban}
            title="Suppressions"
            description="Review bounced, complained and unsubscribed addresses."
          />
        </SettingsCard>

        <SettingsCard
          title="Data & Privacy"
          description="Export workspace data and handle deletion requests."
        >
          <SettingsRow
            href="/owner/export-data"
            icon={Download}
            title="Export Data"
            description="Download a copy of your organization's data."
            disabled={!isOwner}
          />
          <SettingsRow
            href="/owner/deletion-requests"
            icon={Trash2}
            title="Deletion Requests"
            description="Review and approve account deletion requests."
            disabled={!isOwner}
          />
        </SettingsCard>
      </div>
    </ProtectedRoute>
  );
}
