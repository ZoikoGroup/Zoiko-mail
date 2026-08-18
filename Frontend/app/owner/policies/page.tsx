"use client";

import { useState } from "react";
import { ProtectedRoute } from "@/components/owner/ProtectedRoute";
import { PageHeader } from "@/components/ui/PageHeader";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { Tabs } from "@/components/ui/Tabs";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { usePolicies, useActivatePolicy } from "@/lib/owner-hooks";
import { ShieldCheck, Sparkles, Mail, Gauge, Lock } from "lucide-react";

const categories = [
  { id: "all", label: "All Policies" },
  { id: "AI_FEATURES", label: "AI Features" },
  { id: "SENDING", label: "Sending" },
  { id: "RATE_LIMITS", label: "Rate Limits" },
  { id: "DATA_HANDLING", label: "Data Handling" },
  { id: "SECURITY", label: "Security" },
];

const categoryIcons: Record<string, typeof Sparkles> = {
  AI_FEATURES: Sparkles,
  SENDING: Mail,
  RATE_LIMITS: Gauge,
  DATA_HANDLING: Lock,
  SECURITY: ShieldCheck,
};

export default function PoliciesPage() {
  const [activeTab, setActiveTab] = useState("all");
  const [confirmToggle, setConfirmToggle] = useState<any>(null);

  const { data: policies = [], isLoading } = usePolicies();
  const activatePolicy = useActivatePolicy();

  const filtered = activeTab === "all" ? policies : policies.filter((p) => p.category === activeTab);

  return (
    <ProtectedRoute allowedRoles={["OWNER", "ADMIN"]}>
      <div className="mx-auto max-w-4xl space-y-6 px-4 py-8 sm:px-6">
        <PageHeader
          title="Policies"
          description="Manage AI features, sending policies, rate limits, and security settings."
        />

        <Tabs
          tabs={categories.map((c) => ({
            id: c.id,
            label: c.label,
            count: c.id === "all" ? policies.length : policies.filter((p) => p.category === c.id).length,
          }))}
          active={activeTab}
          onChange={setActiveTab}
        />

        <div className="space-y-2">
          {isLoading && (
            <div className="py-8 text-center text-sm text-[var(--ink3)]">Loading policies…</div>
          )}
          {!isLoading && filtered.length === 0 && (
            <div className="py-8 text-center text-sm text-[var(--ink3)]">No policies found.</div>
          )}
          {filtered.map((policy) => {
            const Icon = categoryIcons[policy.category] ?? ShieldCheck;
            return (
              <div key={policy.id} className="zoiko-card flex items-center gap-4 p-4">
                <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[var(--s3)] text-[var(--ink3)]">
                  <Icon className="h-4 w-4" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <h3 className="text-sm font-medium text-[var(--ink)]">{policy.name}</h3>
                    <StatusBadge variant={policy.isEnabled ? "ok" : "nu"}>
                      {policy.isEnabled ? "Enabled" : "Disabled"}
                    </StatusBadge>
                  </div>
                  <p className="mt-0.5 text-[11px] text-[var(--ink3)]">{policy.description}</p>
                </div>
                <button
                  onClick={() => setConfirmToggle(policy)}
                  className={`zoiko-btn sm ${policy.isEnabled ? "" : "pri"}`}
                >
                  {policy.isEnabled ? "Disable" : "Enable"}
                </button>
              </div>
            );
          })}
        </div>

        <ConfirmDialog
          open={!!confirmToggle}
          onClose={() => setConfirmToggle(null)}
          onConfirm={() => {
            if (confirmToggle) activatePolicy.mutate(confirmToggle.id);
            setConfirmToggle(null);
          }}
          title={confirmToggle?.isEnabled ? "Disable Policy" : "Enable Policy"}
          message={`Are you sure you want to ${confirmToggle?.isEnabled ? "disable" : "enable"} "${confirmToggle?.name}"? This may affect how your organization uses Zoiko Mail.`}
          confirmLabel={confirmToggle?.isEnabled ? "Disable" : "Enable"}
          variant={confirmToggle?.isEnabled ? "danger" : "warning"}
        />
      </div>
    </ProtectedRoute>
  );
}
