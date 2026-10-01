"use client";

import { Pill } from "@/components/admin/ui";
import type { DnsProviderKind, DnsRecord } from "@/lib/domains-api";
import { CopyButton } from "./CopyButton";
import { PUBLISH_LABEL, PURPOSE_HELP, PURPOSE_LABEL, STATE_LABEL, STATE_TONE, relativeTime } from "./format";

/**
 * The records an owner has to publish, exactly as the server generated and
 * verifies them.
 *
 * Stacked rows rather than a table: a DKIM value is ~400 characters, and in
 * a table column it either overflows the page or wraps into an unreadable
 * sliver. Here the host and value each get a full-width line with their own
 * copy button, which is what someone pasting into a DNS dashboard needs.
 */
export function DnsRecordsTable({ records, provider }: { records: DnsRecord[]; provider: DnsProviderKind }) {
  if (records.length === 0) {
    return <p className="px-4 py-6 text-center text-[12px] text-[var(--ink3)]">Records are being generated.</p>;
  }
  return (
    <ul className="divide-y divide-[var(--border)]">
      {records.map((record) => (
        <li key={record.id} className="px-4 py-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[12.6px] font-semibold text-[var(--ink)]">{PURPOSE_LABEL[record.purpose]}</span>
            <Pill tone="nu">{record.type}</Pill>
            {!record.required && <Pill tone="ai">Optional</Pill>}
            <span className="ml-auto flex items-center gap-2">
              {provider !== "MANUAL" && record.publishState !== "NOT_APPLICABLE" && (
                <span className={`text-[11px] ${record.publishState === "FAILED" ? "text-[var(--crit)]" : "text-[var(--ink3)]"}`}>
                  {PUBLISH_LABEL[record.publishState]}
                </span>
              )}
              <Pill tone={STATE_TONE[record.state]}>{STATE_LABEL[record.state]}</Pill>
            </span>
          </div>
          <p className="mt-0.5 text-[11px] text-[var(--ink3)]">{PURPOSE_HELP[record.purpose]}</p>

          <dl className="mt-2 space-y-1.5 rounded-lg border border-[var(--border)] bg-[var(--s2)] p-2.5 text-[11.5px]">
            <Field label="Host" value={record.name} hint={record.name === "@" ? "the domain itself" : undefined} />
            <Field label="Value" value={record.value} />
            {record.type === "MX" && <Field label="Priority" value={String(record.priority ?? 10)} copy={false} />}
          </dl>

          {record.diagnosis && record.state !== "VERIFIED" && (
            <p className={`mt-1.5 text-[11.5px] ${record.state === "MISMATCH" || record.state === "CONFLICT" ? "text-[var(--crit)]" : "text-[var(--ink2)]"}`}>
              {record.diagnosis}
            </p>
          )}
          {record.diagnosis && record.state === "VERIFIED" && (
            <p className="mt-1.5 text-[11.5px] text-[var(--ink3)]">{record.diagnosis}</p>
          )}
          {record.publishError && <p className="mt-1.5 text-[11.5px] text-[var(--crit)]">{record.publishError}</p>}
          {record.observed && record.observed.length > 0 && record.state !== "VERIFIED" && (
            <details className="mt-1.5 text-[11px] text-[var(--ink3)]">
              <summary className="cursor-pointer select-none">What DNS returned</summary>
              <ul className="mt-1 space-y-0.5 font-mono-num break-all">
                {record.observed.map((value, index) => <li key={index}>{value}</li>)}
              </ul>
            </details>
          )}
          <p className="mt-1 text-[10.5px] text-[var(--ink3)]">
            {record.lastCheckedAt ? `Checked ${relativeTime(record.lastCheckedAt)}` : "Not checked yet"}
            {record.lastErrorCode && record.state !== "MISSING" ? ` · resolver: ${record.lastErrorCode}` : ""}
          </p>
        </li>
      ))}
    </ul>
  );
}

function Field({ label, value, hint, copy = true }: { label: string; value: string; hint?: string; copy?: boolean }) {
  return (
    <div className="flex items-start gap-2">
      <dt className="w-14 shrink-0 pt-0.5 text-[10px] uppercase tracking-[0.08em] text-[var(--ink3)]">{label}</dt>
      <dd className="min-w-0 flex-1 break-all font-mono-num text-[var(--ink)]">
        {value}
        {hint && <span className="ml-1.5 font-sans text-[var(--ink3)]">({hint})</span>}
      </dd>
      {copy && <CopyButton value={value} label={`${label.toLowerCase()} ${value.slice(0, 24)}`} />}
    </div>
  );
}
