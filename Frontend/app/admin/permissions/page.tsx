"use client";

import { Fragment } from "react";

import { useCapabilityMatrix, useGuardrails } from "@/lib/admin-hooks";
import type { CapabilityCell } from "@/lib/admin-api";
import {
  Card,
  ErrorState,
  GuardRow,
  LoadingRows,
  Notice,
  PageHeader,
  Pill,
  StaticNote,
  Table,
  TableWrap,
  Th,
} from "@/components/admin/ui";

export default function AdminPermissionsPage() {
  const { data: matrix, isLoading, error } = useCapabilityMatrix();
  const { data: guardrails } = useGuardrails();

  const capabilityCount = matrix?.reduce((total, group) => total + group.rows.length, 0) ?? 0;

  return (
    <>
      <PageHeader
        title="Roles & permissions"
        subtitle="The authoritative specification. In code this is a permission map that roles point at."
      />

      <StaticNote>
        Rendered from GET /permissions/matrix once the capability map lands, so it cannot drift
      </StaticNote>

      <Notice tone="info">
        <b className="text-[var(--ai)]">Code checks permissions, never roles.</b> Scattering{" "}
        <code className="rounded bg-[var(--s3)] px-1 py-px font-mono-num text-[11px]">
          if (role === &apos;admin&apos;)
        </code>{" "}
        through handlers means adding a fifth role turns into hunting security-critical branches.
        With a map, adding a role is a data change.
      </Notice>

      <Card
        title="Capability matrix"
        badge={<Pill tone="nu">{`${capabilityCount} capabilities`}</Pill>}
      >
        {error ? (
          <ErrorState message={error.message} />
        ) : isLoading || !matrix ? (
          <LoadingRows rows={8} />
        ) : (
          <TableWrap>
            <Table>
              <thead>
                <tr>
                  <Th>Capability</Th>
                  <Th>Member</Th>
                  <Th>Admin</Th>
                  <Th>Owner</Th>
                  <Th>Support</Th>
                </tr>
              </thead>
              <tbody>
                {matrix.map((group) => (
                  <Fragment key={group.group}>
                    <tr>
                      <td
                        colSpan={5}
                        className="font-mono-num border-b border-[var(--border)] bg-[var(--s2)] px-4 py-2 text-[9px] uppercase tracking-[0.13em] text-[var(--ink3)]"
                      >
                        {group.group}
                      </td>
                    </tr>
                    {group.rows.map((row) => (
                      <tr key={row.capability}>
                        <td className="border-b border-[var(--border)] px-4 py-2.5 text-[12.4px] font-medium text-[var(--ink2)]">
                          {row.capability}
                        </td>
                        <MatrixCell value={row.member} />
                        <MatrixCell value={row.admin} />
                        <MatrixCell value={row.owner} />
                        <MatrixCell value={row.support} />
                      </tr>
                    ))}
                  </Fragment>
                ))}
              </tbody>
            </Table>
          </TableWrap>
        )}
      </Card>

      <Card title="Escalation guardrails" badge={<Pill tone="crit">Server-enforced</Pill>}>
        {guardrails?.map((guardrail) => (
          <GuardRow key={guardrail.id} title={guardrail.title} detail={guardrail.detail} />
        ))}
      </Card>
    </>
  );
}

/**
 * Three states, deliberately distinguishable at a glance: allowed, denied, or
 * allowed-with-a-condition. A conditional cell is the interesting one — it means
 * the capability exists but needs step-up, a second person, or a live grant.
 */
function MatrixCell({ value }: { value: CapabilityCell }) {
  const base = "w-[104px] border-b border-[var(--border)] px-4 py-2.5 text-center";

  if (value === 1) {
    return (
      <td className={base}>
        <span className="font-bold text-[var(--ok)]" aria-label="Allowed">
          ✓
        </span>
      </td>
    );
  }

  if (value === 0) {
    return (
      <td className={base}>
        <span className="text-[var(--ink3)] opacity-45" aria-label="Denied">
          ✗
        </span>
      </td>
    );
  }

  return (
    <td className={base}>
      <span className="font-mono-num text-[9.5px] font-bold tracking-[0.04em] text-[var(--warn)]">
        {value}
      </span>
    </td>
  );
}
