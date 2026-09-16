"use client";

import { usePolicyGroups, useUpdatePolicyRules } from "@/lib/admin-hooks";
import { useCan } from "@/lib/admin-capabilities";
import {
  Card,
  InlineError,
  LoadingRows,
  Notice,
  PageHeader,
  Pill,
  StaticNote,
  ToggleRow,
} from "@/components/admin/ui";

export default function AdminPoliciesPage() {
  const can = useCan();
  const { data: groups, isLoading, error } = usePolicyGroups();
  const updateRules = useUpdatePolicyRules();

  const canWriteSecurityPolicy = can("policy.security.write");

  if (error) {
    return (
      <>
        <PageHeader title="Policies" />
        <Card>
          <InlineError message={error.message} />
        </Card>
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Policies"
        subtitle="AI, sending, retention and access rules for this tenant"
      />

      <StaticNote>
        Versioned server-side — changing a policy supersedes rather than overwrites
      </StaticNote>

      <Notice tone="warn">
        <b className="text-[var(--warn)]">Non-negotiable at launch.</b> No AI training on customer
        data. No autonomous external sending. No silent support access. These three are locked and
        writes to them are refused, never stored.
      </Notice>

      {isLoading || !groups ? (
        <Card>
          <LoadingRows rows={5} />
        </Card>
      ) : (
        groups.map((group) => {
          // The Access group is the security policy, which the matrix reserves
          // to Owner. Everything in it locks for anyone without that capability.
          const groupLocked = group.restriction !== null && !canWriteSecurityPolicy;

          return (
            <Card
              key={group.group}
              title={group.group}
              badge={groupLocked ? <Pill tone="warn">{group.restriction}</Pill> : undefined}
            >
              {group.toggles.map((item) => {
                const locked = item.locked || groupLocked;
                const pending = updateRules.isPending;
                return (
                  <ToggleRow
                    key={item.key}
                    label={item.label}
                    detail={item.detail}
                    enabled={item.enabled}
                    locked={locked}
                    onToggle={
                      locked
                        ? undefined
                        : () =>
                            updateRules.mutate({
                              policyId: item.policyId,
                              rules: item.rules,
                              ruleKey: item.ruleKey,
                              enabled: !item.enabled,
                            })
                    }
                    disabled={pending}
                  />
                );
              })}
            </Card>
          );
        })
      )}

      {!canWriteSecurityPolicy && (
        <Notice tone="info">
          <b className="text-[var(--ai)]">Locked toggles are Owner-only or non-negotiable.</b> An
          Admin manages AI and sending policy; the security policy is reserved to an Owner, and the
          API refuses the write regardless of what the UI allows.
        </Notice>
      )}
    </>
  );
}