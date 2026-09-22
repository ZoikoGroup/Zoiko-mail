"use client";

import { useState } from "react";
import { ProtectedRoute } from "@/components/owner/ProtectedRoute";
import { PageHeader } from "@/components/ui/PageHeader";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { Tabs } from "@/components/ui/Tabs";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { Modal } from "@/components/ui/Modal";
import { usePolicies, useActivatePolicy, useDeactivatePolicy, useCreatePolicy } from "@/lib/owner-hooks";
import { ShieldAlert, Sparkles, Mail, Clock, Trash2, Plus, FileText, Check, X } from "lucide-react";

const categories = [
  { id: "all", label: "All Policies" },
  { id: "AI_FEATURES", label: "AI Features" },
  { id: "SENDING", label: "Sending" },
  { id: "RETENTION", label: "Retention" },
  { id: "DELETION", label: "Deletion" },
  { id: "ABUSE", label: "Abuse" },
];

const categoryIcons: Record<string, typeof Sparkles> = {
  AI_FEATURES: Sparkles,
  SENDING: Mail,
  RETENTION: Clock,
  DELETION: Trash2,
  ABUSE: ShieldAlert,
};

const aiFields = [
  { key: "ai.drafting.enabled", label: "AI Drafting", description: "Allow AI to draft email replies" },
  { key: "ai.summarization.enabled", label: "AI Summarization", description: "Allow AI to summarize threads and emails" },
  { key: "ai.restrictedMailboxes.exclude", label: "Exclude Restricted Mailboxes", description: "Prevent AI from processing restricted/sensitive mailboxes" },
  { key: "ai.externalSending.allow", label: "Allow External Sending", description: "Allow AI to send emails externally (default: deny)" },
  { key: "ai.humanConfirmation.required", label: "Require Human Confirmation", description: "Require user confirmation before AI actions take effect" },
  { key: "ai.training.allow", label: "Allow AI Training", description: "Allow customer data to be used for AI model training (default: deny)" },
] as const;

const operators = [
  { value: "EQUALS", label: "Equals" },
  { value: "NOT_EQUALS", label: "Not Equals" },
  { value: "IN", label: "In" },
  { value: "NOT_IN", label: "Not In" },
] as const;

const effects = [
  { value: "ALLOW", label: "Allow" },
  { value: "DENY", label: "Deny" },
] as const;

interface Condition {
  field: string;
  operator: string;
  value: string | string[] | boolean | number;
  effect: "ALLOW" | "DENY";
}

export default function PoliciesPage() {
  const [activeTab, setActiveTab] = useState("all");
  const [confirmToggle, setConfirmToggle] = useState<any>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [formData, setFormData] = useState({
    type: "AI_FEATURES" as "AI_FEATURES" | "SENDING" | "RETENTION" | "DELETION" | "ABUSE",
    name: "",
    description: "",
    defaultEffect: "DENY" as "ALLOW" | "DENY",
    conditions: [] as Condition[],
  });

  const { data: policies = [], isLoading } = usePolicies();
  const activatePolicy = useActivatePolicy();
  const deactivatePolicy = useDeactivatePolicy();
  const createPolicy = useCreatePolicy();

  const filtered = activeTab === "all" ? policies : policies.filter((p) => p.category === activeTab);

  const handleConditionChange = (index: number, field: keyof Condition, value: any) => {
    setFormData((prev) => {
      const next = [...prev.conditions];
      next[index] = { ...next[index], [field]: value };
      return { ...prev, conditions: next };
    });
  };

  const addCondition = () => {
    setFormData((prev) => ({
      ...prev,
      conditions: [...prev.conditions, { field: "", operator: "EQUALS", value: true, effect: "ALLOW" }],
    }));
  };

  const removeCondition = (index: number) => {
    setFormData((prev) => ({
      ...prev,
      conditions: prev.conditions.filter((_, i) => i !== index),
    }));
  };

  const handleSubmit = () => {
    if (!formData.name || formData.conditions.length === 0) return;
    createPolicy.mutate({
      category: formData.type,
      name: formData.name,
      description: formData.description,
      config: {
        defaultEffect: formData.defaultEffect,
        conditions: formData.conditions.map((c) => ({
          field: c.field,
          operator: c.operator,
          value: c.value,
          effect: c.effect,
        })),
      },
    });
    setCreateOpen(false);
    setFormData({ type: "AI_FEATURES", name: "", description: "", defaultEffect: "DENY", conditions: [] });
  };

  return (
    <ProtectedRoute allowedRoles={["OWNER", "ADMIN"]}>
      <div className="mx-auto max-w-4xl space-y-6 px-4 py-8 sm:px-6">
        <PageHeader
          title="Policies"
          description="Manage AI features, sending policies, retention, deletion, and abuse protection."
        />

        <div className="flex items-center justify-between mb-4">
          <Tabs
            tabs={categories.map((c) => ({
              id: c.id,
              label: c.label,
              count: c.id === "all" ? policies.length : policies.filter((p) => p.category === c.id).length,
            }))}
            active={activeTab}
            onChange={setActiveTab}
          />
          <button onClick={() => setCreateOpen(true)} className="zoiko-btn pri">
            <Plus className="h-3.5 w-3.5" /> Create Policy
          </button>
        </div>

        <div className="space-y-2">
          {isLoading && (
            <div className="py-8 text-center text-sm text-[var(--ink3)]">Loading policies…</div>
          )}
          {!isLoading && filtered.length === 0 && (
            <div className="py-8 text-center text-sm text-[var(--ink3)]">No policies found.</div>
          )}
          {filtered.map((policy) => {
            const Icon = categoryIcons[policy.category] ?? Sparkles;
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
                    <span className="zoiko-pill nu text-[10px]">{policy.category}</span>
                  </div>
                  <p className="mt-0.5 text-[11px] text-[var(--ink3)]">{policy.description || "No description"}</p>
                  {policy.category === "AI_FEATURES" && policy.config && (
                    <div className="mt-2 flex flex-wrap gap-1 text-[10px]">
                      {Object.entries(policy.config as Record<string, unknown>).map(([k, v]) => (
                        <span key={k} className="zoiko-pill ok text-[10px]">{k}: {String(v)}</span>
                      ))}
                    </div>
                  )}
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

        {/* Create Policy Modal */}
        <Modal
          open={createOpen}
          onClose={() => setCreateOpen(false)}
          title="Create Policy"
          size="lg"
          footer={
            <>
              <button onClick={() => setCreateOpen(false)} className="zoiko-btn" disabled={createPolicy.isPending}>
                Cancel
              </button>
              <button
                onClick={handleSubmit}
                className="zoiko-btn pri"
                disabled={createPolicy.isPending || !formData.name || formData.conditions.length === 0}
              >
                {createPolicy.isPending ? "Creating…" : "Create Policy"}
              </button>
            </>
          }
        >
          <div className="space-y-6">
            <div>
              <label className="mb-1 block text-sm font-medium text-[var(--ink2)]">Policy Type</label>
<select
                value={formData.type}
                onChange={(e) => setFormData({ ...formData, type: e.target.value as any, conditions: [] })}
                className="h-9 w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 text-sm text-[var(--ink)] focus:border-[var(--accent)] focus:outline-none focus:ring-1 focus:ring-[var(--accent)]"
              >
                <option value="AI_FEATURES">AI Features</option>
                <option value="SENDING">Sending</option>
                <option value="RETENTION">Retention</option>
                <option value="DELETION">Deletion</option>
                <option value="ABUSE">Abuse</option>
              </select>
            </div>

            <div>
              <label className="mb-1 block text-sm font-medium text-[var(--ink2)]">Name</label>
              <input
                type="text"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                placeholder="e.g. AI Drafting Controls"
                className="h-9 w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 text-sm text-[var(--ink)] focus:border-[var(--accent)] focus:outline-none focus:ring-1 focus:ring-[var(--accent)]"
              />
            </div>

            <div>
              <label className="mb-1 block text-sm font-medium text-[var(--ink2)]">Description</label>
              <textarea
                value={formData.description}
                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                rows={2}
                placeholder="Optional description of what this policy controls"
                className="h-20 w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 text-sm text-[var(--ink)] focus:border-[var(--accent)] focus:outline-none focus:ring-1 focus:ring-[var(--accent)]"
              />
            </div>

            <div>
              <label className="mb-1 block text-sm font-medium text-[var(--ink2)]">Default Effect</label>
              <select
                value={formData.defaultEffect}
                onChange={(e) => setFormData({ ...formData, defaultEffect: e.target.value as any })}
                className="h-9 w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 text-sm text-[var(--ink)] focus:border-[var(--accent)] focus:outline-none focus:ring-1 focus:ring-[var(--accent)]"
              >
                <option value="DENY">Deny (fail closed)</option>
                <option value="ALLOW">Allow</option>
              </select>
              <p className="mt-1 text-[11px] text-[var(--ink3)]">Applied when no conditions match</p>
            </div>

            <div>
              <div className="flex items-center justify-between mb-3">
                <label className="text-sm font-medium text-[var(--ink2)]">Conditions</label>
                <button onClick={addCondition} className="zoiko-btn sm pri">
                  <Plus className="h-3.5 w-3.5" /> Add Condition
                </button>
              </div>
              {formData.conditions.length === 0 ? (
                <div className="rounded-lg bg-[var(--s2)] p-4 text-center text-sm text-[var(--ink3)]">
                  No conditions yet. Add at least one condition to create the policy.
                </div>
              ) : (
                <div className="space-y-3">
                  {formData.conditions.map((condition, index) => (
                    <div key={index} className="zoiko-card p-4 space-y-3 border-[var(--border)]">
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-medium text-[var(--ink)]">Condition {index + 1}</span>
                        <button onClick={() => removeCondition(index)} className="text-[var(--ink3)] hover:text-[var(--crit)]">
                          <X className="h-4 w-4" />
                        </button>
                      </div>

                      <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
                        {/* Field */}
                        <div className="sm:col-span-2">
                          <label className="mb-1 block text-[11px] font-medium text-[var(--ink3)]">
                            Field {formData.type === "AI_FEATURES" ? "(AI Fields)" : ""}
                          </label>
                          {formData.type === "AI_FEATURES" ? (
                            <select
                              value={condition.field}
                              onChange={(e) => handleConditionChange(index, "field", e.target.value)}
                              className="h-9 w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 text-sm text-[var(--ink)] focus:border-[var(--accent)] focus:outline-none focus:ring-1 focus:ring-[var(--accent)]"
                            >
                              <option value="">Select AI field</option>
                              {aiFields.map((f) => (
                                <option key={f.key} value={f.key} title={f.description}>{f.label}</option>
                              ))}
                            </select>
                          ) : (
                            <input
                              type="text"
                              value={condition.field}
                              onChange={(e) => handleConditionChange(index, "field", e.target.value)}
                              placeholder="e.g. user.role, message.size"
                              className="h-9 w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 text-sm text-[var(--ink)] focus:border-[var(--accent)] focus:outline-none focus:ring-1 focus:ring-[var(--accent)]"
                            />
                          )}
                        </div>

                        {/* Operator */}
                        <div>
                          <label className="mb-1 block text-[11px] font-medium text-[var(--ink3)]">Operator</label>
                          <select
                            value={condition.operator}
                            onChange={(e) => handleConditionChange(index, "operator", e.target.value)}
                            className="h-9 w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 text-sm text-[var(--ink)] focus:border-[var(--accent)] focus:outline-none focus:ring-1 focus:ring-[var(--accent)]"
                          >
                            {operators.map((op) => (
                              <option key={op.value} value={op.value}>{op.label}</option>
                            ))}
                          </select>
                        </div>

                        {/* Effect */}
                        <div>
                          <label className="mb-1 block text-[11px] font-medium text-[var(--ink3)]">Effect</label>
                          <select
                            value={condition.effect}
                            onChange={(e) => handleConditionChange(index, "effect", e.target.value)}
                            className="h-9 w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 text-sm text-[var(--ink)] focus:border-[var(--accent)] focus:outline-none focus:ring-1 focus:ring-[var(--accent)]"
                          >
                            {effects.map((eff) => (
                              <option key={eff.value} value={eff.value}>{eff.label}</option>
                            ))}
                          </select>
                        </div>

                        {/* Value */}
                        <div className="sm:col-span-4">
                          <label className="mb-1 block text-[11px] font-medium text-[var(--ink3)]">Value</label>
                          {formData.type === "AI_FEATURES" && aiFields.find((f) => f.key === condition.field) ? (
                            <select
                              value={String(condition.value)}
                              onChange={(e) => handleConditionChange(index, "value", e.target.value === "true")}
                              className="h-9 w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 text-sm text-[var(--ink)] focus:border-[var(--accent)] focus:outline-none focus:ring-1 focus:ring-[var(--accent)]"
                            >
                              <option value="true">true</option>
                              <option value="false">false</option>
                            </select>
                          ) : (
                            <input
                              type="text"
                              value={String(condition.value)}
                              onChange={(e) => handleConditionChange(index, "value", e.target.value)}
                              placeholder={formData.type === "AI_FEATURES" ? "true/false" : "Value to match"}
                              className="h-9 w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 text-sm text-[var(--ink)] focus:border-[var(--accent)] focus:outline-none focus:ring-1 focus:ring-[var(--accent)]"
                            />
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </Modal>

        {/* Enable/Disable Confirm */}
        <ConfirmDialog
          open={!!confirmToggle}
          onClose={() => setConfirmToggle(null)}
          onConfirm={() => {
            if (!confirmToggle) return;
            if (confirmToggle.isEnabled) deactivatePolicy.mutate(confirmToggle.id);
            else activatePolicy.mutate(confirmToggle.id);
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