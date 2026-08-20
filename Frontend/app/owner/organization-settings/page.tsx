"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { ProtectedRoute } from "@/components/owner/ProtectedRoute";
import { PageHeader } from "@/components/ui/PageHeader";
import { Skeleton } from "@/components/ui/Skeleton";
import { useMe } from "@/lib/auth-hooks";
import { useUpdateTenant } from "@/lib/owner-hooks";
import type { MeResponse } from "@/lib/auth-api";
import { Building2, Save } from "lucide-react";

export default function OrganizationSettingsPage() {
  const { data, isLoading, error } = useMe();
  const me = data as MeResponse | undefined;
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
      </div>
    </ProtectedRoute>
  );
}
