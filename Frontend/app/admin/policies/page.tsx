"use client";

import { useState } from "react";
import { Trash2 } from "lucide-react";

import { usePolicies, useSavePolicyRules } from "@/lib/admin-hooks";
import { useCan } from "@/lib/admin-capabilities";
import type { PolicyConditionDto, PolicyDto } from "@/lib/admin-api";
import {
  Card,
  InlineEmpty,
  InlineError,
  LoadingRows,
  Notice,
  PageHeader,
  Pill,
  Row,
} from "@/components/admin/ui";

/**
 * What is in force, and how to change it.
 *
 * This screen used to render a list of boolean toggles built by filtering the
 * rules object for boolean values, with optimistic local state behind them. A
 * policy's rules are `{ defaultEffect, conditions[] }` — no rule is ever a
 * boolean — so the list was empty in every workspace, and had one appeared,
 * flipping it would have changed nothing and reverted on the next refresh.
 *
 * Editing is explicit rather than live: a policy is versioned, so every save
 * creates a version and retires the previous one. Saving on each keystroke
 * would turn one decision into a dozen versions of the audit trail.
 */

const OPERATORS = [
  { value: "EQUALS", label: "is" },
  { value: "NOT_EQUALS", label: "is not" },
  { value: "IN", label: "is one of" },
  { value: "GREATER_THAN", label: "is greater than" },
  { value: "GREATER_THAN_OR_EQUAL", label: "is at least" },
  { value: "LESS_THAN", label: "is less than" },
  { value: "LESS_THAN_OR_EQUAL", label: "is at most" },
] as const;

/** The server's own rule: a dotted path, letters first, up to 100 characters. */
const FIELD_PATTERN = /^[a-zA-Z][a-zA-Z0-9_.]{0,99}$/;

export default function AdminPoliciesPage() {
  const can = useCan();
  const { data: policies, isLoading, error } = usePolicies();
  const canWrite = can("policy.write");

  return (
    <>
      <PageHeader
        title="Policies"
        subtitle="AI, sending, retention and access rules for this tenant"
      />

      <Notice tone="info">
        Policies are versioned. Saving creates a new version and retires the old one
        rather than overwriting it, so what was in force at any past moment stays
        answerable.
      </Notice>

      <Notice tone="warn">
        <b className="text-[var(--warn)]">Non-negotiable at launch.</b> No AI training on
        customer data. No autonomous external sending. No silent support access. These are
        not expressible as policy and are enforced in code, not here.
      </Notice>

      {error ? (
        <Card>
          <InlineError message={error.message} />
        </Card>
      ) : isLoading || !policies ? (
        <Card>
          <LoadingRows rows={5} />
        </Card>
      ) : policies.length === 0 ? (
        <Card>
          <InlineEmpty
            title="No policies yet"
            hint="Evaluation fails closed until a policy is active, so nothing governed is permitted."
          />
        </Card>
      ) : (
        policies.map((policy) => (
          <PolicyCard key={policy.id} policy={policy} canWrite={canWrite} />
        ))
      )}

      {!canWrite && (
        <Notice tone="info">
          <b className="text-[var(--ai)]">You can read policy but not change it.</b> Changing a
          policy needs <code>policy.write</code>, and the API refuses it regardless of what
          this screen offers.
        </Notice>
      )}
    </>
  );
}

function PolicyCard({ policy, canWrite }: { policy: PolicyDto; canWrite: boolean }) {
  const save = useSavePolicyRules();
  const [editing, setEditing] = useState(false);
  const [defaultEffect, setDefaultEffect] = useState(policy.defaultEffect);
  const [conditions, setConditions] = useState<PolicyConditionDto[]>(policy.conditions);
  const [invalid, setInvalid] = useState<string | null>(null);

  const startEditing = () => {
    // Re-seeded from the server each time, so an abandoned edit never becomes
    // the starting point of the next one.
    setDefaultEffect(policy.defaultEffect);
    setConditions(policy.conditions);
    setInvalid(null);
    save.reset();
    setEditing(true);
  };

  const update = (index: number, patch: Partial<PolicyConditionDto>) =>
    setConditions((current) =>
      current.map((condition, i) => (i === index ? { ...condition, ...patch } : condition))
    );

  const submit = () => {
    setInvalid(null);
    const bad = conditions.findIndex((condition) => !FIELD_PATTERN.test(condition.field.trim()));
    if (bad !== -1) {
      setInvalid(
        `Condition ${bad + 1}: a field is a dotted path like mailbox.eligible — letters first.`
      );
      return;
    }
    if (conditions.some((condition) => condition.value.trim() === "")) {
      setInvalid("Every condition needs a value.");
      return;
    }
    save.mutate(
      { policy, rules: { defaultEffect, conditions } },
      { onSuccess: () => setEditing(false) }
    );
  };

  return (
    <Card
      title={policy.name}
      badge={
        <>
          <Pill tone={policy.status === "ACTIVE" ? "ok" : "warn"}>
            {policy.status.charAt(0) + policy.status.slice(1).toLowerCase()}
          </Pill>
          <Pill tone="nu">{`v${policy.version}`}</Pill>
        </>
      }
      action={
        canWrite ? (
          editing ? (
            <div className="flex gap-2">
              <button
                type="button"
                className="zoiko-btn sm"
                disabled={save.isPending}
                onClick={() => setEditing(false)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="zoiko-btn pri sm"
                disabled={save.isPending}
                onClick={submit}
              >
                {save.isPending ? "Saving…" : `Save as v${policy.version + 1}`}
              </button>
            </div>
          ) : (
            <button type="button" className="zoiko-btn sm" onClick={startEditing}>
              Edit
            </button>
          )
        ) : undefined
      }
    >
      {policy.description && (
        <Row title="About" detail={policy.description} right={<Pill tone="nu">{policy.type}</Pill>} />
      )}

      {(invalid || save.error) && (
        <Notice tone="warn">{invalid ?? save.error?.message}</Notice>
      )}

      {editing ? (
        <div className="space-y-4 py-1">
          <div>
            <label
              htmlFor={`default-${policy.id}`}
              className="font-mono-num mb-1 block text-[9.5px] uppercase tracking-[0.1em] text-[var(--ink3)]"
            >
              Default effect — applies when no condition matches
            </label>
            <select
              id={`default-${policy.id}`}
              value={defaultEffect}
              onChange={(event) =>
                setDefaultEffect(event.target.value as PolicyDto["defaultEffect"])
              }
              className="rounded-lg border border-[var(--border)] bg-[var(--s2)] px-3 py-2 text-[12.6px] text-[var(--ink)]"
            >
              <option value="DENY">DENY</option>
              <option value="ALLOW">ALLOW</option>
            </select>
          </div>

          <div className="space-y-2">
            {conditions.map((condition, index) => (
              <div
                key={index}
                className="flex flex-wrap items-end gap-2 rounded-lg border border-[var(--border)] p-2.5"
              >
                <Field label="Field">
                  <input
                    aria-label={`Condition ${index + 1} field`}
                    value={condition.field}
                    onChange={(event) => update(index, { field: event.target.value })}
                    placeholder="mailbox.eligible"
                    className="w-[190px] rounded-lg border border-[var(--border)] bg-[var(--s2)] px-2.5 py-1.5 font-mono text-[12px] text-[var(--ink)]"
                  />
                </Field>
                <Field label="Test">
                  <select
                    aria-label={`Condition ${index + 1} operator`}
                    value={condition.operator}
                    onChange={(event) => update(index, { operator: event.target.value })}
                    className="rounded-lg border border-[var(--border)] bg-[var(--s2)] px-2.5 py-1.5 text-[12px] text-[var(--ink)]"
                  >
                    {OPERATORS.map((operator) => (
                      <option key={operator.value} value={operator.value}>
                        {operator.label}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label={condition.operator === "IN" ? "Values (comma-separated)" : "Value"}>
                  <input
                    aria-label={`Condition ${index + 1} value`}
                    value={condition.value}
                    onChange={(event) => update(index, { value: event.target.value })}
                    className="w-[190px] rounded-lg border border-[var(--border)] bg-[var(--s2)] px-2.5 py-1.5 font-mono text-[12px] text-[var(--ink)]"
                  />
                </Field>
                <Field label="Effect">
                  <select
                    aria-label={`Condition ${index + 1} effect`}
                    value={condition.effect}
                    onChange={(event) =>
                      update(index, { effect: event.target.value as PolicyConditionDto["effect"] })
                    }
                    className="rounded-lg border border-[var(--border)] bg-[var(--s2)] px-2.5 py-1.5 text-[12px] text-[var(--ink)]"
                  >
                    <option value="ALLOW">ALLOW</option>
                    <option value="DENY">DENY</option>
                  </select>
                </Field>
                <button
                  type="button"
                  className="zoiko-btn sm"
                  aria-label={`Remove condition ${index + 1}`}
                  onClick={() => setConditions((c) => c.filter((_, i) => i !== index))}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}

            <button
              type="button"
              className="zoiko-btn sm"
              disabled={conditions.length >= 50}
              title={conditions.length >= 50 ? "A policy takes at most 50 conditions" : undefined}
              onClick={() =>
                setConditions((current) => [
                  ...current,
                  { field: "", operator: "EQUALS", value: "", effect: "ALLOW" },
                ])
              }
            >
              Add condition
            </button>
          </div>
        </div>
      ) : (
        <>
          <Row
            title="Default effect"
            detail="Applies when no condition below matches"
            right={
              <Pill tone={policy.defaultEffect === "ALLOW" ? "ok" : "crit"}>
                {policy.defaultEffect}
              </Pill>
            }
          />
          {policy.conditions.length === 0 ? (
            <Row
              title="Conditions"
              detail="None — the default effect decides every request against this policy"
              right={<Pill tone="nu">0</Pill>}
            />
          ) : (
            policy.conditions.map((condition, index) => (
              <Row
                key={`${condition.field}-${index}`}
                title={`${condition.field} ${
                  OPERATORS.find((operator) => operator.value === condition.operator)?.label ??
                  condition.operator
                } ${condition.value}`}
                detail={`Condition ${index + 1}`}
                right={
                  <Pill tone={condition.effect === "ALLOW" ? "ok" : "crit"}>
                    {condition.effect}
                  </Pill>
                }
              />
            ))
          )}
        </>
      )}
    </Card>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <span className="font-mono-num mb-1 block text-[9px] uppercase tracking-[0.1em] text-[var(--ink3)]">
        {label}
      </span>
      {children}
    </div>
  );
}
