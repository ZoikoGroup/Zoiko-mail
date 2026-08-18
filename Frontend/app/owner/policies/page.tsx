"use client";

import { useState } from "react";
import { ProtectedRoute } from "@/components/owner/ProtectedRoute";
import { PageHeader } from "@/components/ui/PageHeader";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { Tabs } from "@/components/ui/Tabs";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { mockSecurityAlerts } from "@/lib/owner-mock-data";
import { ShieldCheck, Sparkles, Mail, Gauge, Lock, Save } from "lucide-react";

interface PolicyRow {
  id: string;
  name: string;
  description: string;
  category: string;
  isEnabled: boolean;
}

const mockPolicies: PolicyRow[] = [
  { id: "p1", name: "AI Drafting", description: "Allow AI to draft email replies for review.", category: "AI_FEATURES", isEnabled: true },
  { id: "p2", name: "AI Summarization", description: "Enable thread summarization for long conversations.", category: "AI_FEATURES", isEnabled: true },
  { id: "p3", name: "AI Action Detection", description: "Automatically detect commitments and deadlines.", category: "AI_FEATURES", isEnabled: true },
  { id: "p4", name: "Bulk Sending Limit", description: "Maximum 500 recipients per hour per user.", category: "SENDING", isEnabled: true },
  { id: "p5", name: "External Forwarding", description: "Block automatic forwarding to external addresses.", category: "SENDING", isEnabled: false },
  { id: "p6", name: "API Rate Limit", description: "1000 requests per hour per API key.", category: "RATE_LIMITS", isEnabled: true },
  { id: "p7", name: "Data Retention", description: "Retain email data for 365 days.", category: "DATA_HANDLING", isEnabled: true },
  { id: "p8", name: "Two-Factor Auth", description: "Require 2FA for all admin users.", category: "SECURITY", isEnabled: false },
];

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
  const [confirmToggle, setConfirmToggle] = useState<PolicyRow | null>(null);

  const filtered = activeTab === "all" ? mockPolicies : mockPolicies.filter((p) => p.category === activeTab);

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
            count: c.id === "all" ? mockPolicies.length : mockPolicies.filter((p) => p.category === c.id).length,
          }))}
          active={activeTab}
          onChange={setActiveTab}
        />

        <div className="space-y-2">
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
            // TODO: wire to useActivatePolicy mutation
            console.log("Toggle policy:", confirmToggle?.id);
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
