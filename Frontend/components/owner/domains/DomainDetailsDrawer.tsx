"use client";

import { useState } from "react";
import { Globe, Calendar, ShieldCheck, Copy, Check, X, History, RefreshCw } from "lucide-react";
import type { Domain } from "@/lib/owner-api";
import { useDomainChecks } from "@/lib/owner-hooks";

function dnsPill(status: string) {
  switch (status) {
    case "VERIFIED": return <span className="zoiko-pill ok">Verified</span>;
    case "PENDING": return <span className="zoiko-pill warn">Pending</span>;
    case "FAILED": return <span className="zoiko-pill crit">Failed</span>;
    default: return <span className="zoiko-pill nu">Not set</span>;
  }
}

function fmtDate(iso: string | null) {
  if (!iso) return "Never";
  return new Date(iso).toLocaleString(undefined, {
    year: "numeric", month: "short", day: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

function RecordRow({ type, host, value }: { type: string; host: string; value: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  };
  return (
    <div className="rounded-lg border border-[var(--border)] bg-[var(--s2)] p-3">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold uppercase tracking-wide text-[var(--ink3)]">{type}</span>
        <button onClick={copy} className="flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs text-[var(--ink3)] hover:bg-[var(--s3)] hover:text-[var(--ink)]">
          {copied ? <Check className="h-3.5 w-3.5 text-[var(--ok)]" /> : <Copy className="h-3.5 w-3.5" />}
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <p className="mt-1 break-all font-mono text-xs text-[var(--ink2)]">
        <span className="text-[var(--ink3)]">Host: </span>{host}
      </p>
      <p className="mt-0.5 break-all font-mono text-xs text-[var(--ink)]">
        <span className="text-[var(--ink3)]">Value: </span>{value}
      </p>
    </div>
  );
}

interface DomainDetailsDrawerProps {
  domain: Domain | null;
  onClose: () => void;
}

export function DomainDetailsDrawer({ domain, onClose }: DomainDetailsDrawerProps) {
  const { data: checks = [], isLoading: checksLoading } = useDomainChecks(domain?.id ?? null);

  if (!domain) return null;

  const d = domain.domain;
  const errors = Object.entries(domain.errorDetails ?? {});

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/30" onClick={onClose} />
      <div className="fixed inset-y-0 right-0 z-50 w-full max-w-md border-l border-[var(--border)] bg-[var(--surface)] shadow-[var(--sh3)] overflow-y-auto">
        <div className="flex items-center justify-between border-b border-[var(--border)] px-5 py-4">
          <h2 className="font-editorial text-lg font-semibold text-[var(--ink)]">Domain Details</h2>
          <button onClick={onClose} className="rounded-md p-1.5 text-[var(--ink3)] hover:bg-[var(--s2)]">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="space-y-6 p-5">
          <div className="flex items-center gap-3">
            <span className="inline-flex h-12 w-12 items-center justify-center rounded-full bg-[var(--accent-soft)] text-[var(--accent-ink)]">
              <Globe className="h-6 w-6" />
            </span>
            <div>
              <p className="font-medium text-[var(--ink)]">{d}</p>
              <p className="text-sm text-[var(--ink3)]">
                {domain.isActive ? "Active for sending" : "Not activated"}
              </p>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2 rounded-lg border border-[var(--border)] p-3">
            <div className="flex items-center justify-between text-xs">
              <span className="text-[var(--ink3)]">Ownership</span>{dnsPill(domain.verificationStatus)}
            </div>
            <div className="flex items-center justify-between text-xs">
              <span className="text-[var(--ink3)]">MX</span>{dnsPill(domain.mxStatus)}
            </div>
            <div className="flex items-center justify-between text-xs">
              <span className="text-[var(--ink3)]">SPF</span>{dnsPill(domain.spfStatus)}
            </div>
            <div className="flex items-center justify-between text-xs">
              <span className="text-[var(--ink3)]">DKIM</span>{dnsPill(domain.dkimStatus)}
            </div>
            <div className="col-span-2 flex items-center justify-between text-xs">
              <span className="text-[var(--ink3)]">DMARC</span>{dnsPill(domain.dmarcStatus)}
            </div>
          </div>

          <div className="flex items-center gap-2 text-xs text-[var(--ink3)]">
            <Calendar className="h-3.5 w-3.5" />
            Last checked: {fmtDate(domain.lastCheckedAt)}
          </div>

          {errors.length > 0 && (
            <div className="rounded-lg border border-[var(--crit)]/30 bg-[var(--crit-soft)] p-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-[var(--crit)]">Last check errors</p>
              <ul className="mt-2 space-y-1">
                {errors.map(([key, err]) => (
                  <li key={key} className="text-xs text-[var(--ink2)]">
                    <span className="font-medium">{key.toUpperCase()}:</span> {err.message}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-[var(--ink3)]">
              Required DNS records
            </p>
            <RecordRow type="TXT (ownership)" host="@" value={domain.verificationToken || "(add the domain to generate a token)"} />
            <RecordRow type="MX" host="@" value="mail.zoiko.dev (priority 10)" />
            <RecordRow type="SPF (TXT)" host="@" value="v=spf1 include:zoiko.dev ~all" />
            <RecordRow type="DKIM (TXT)" host={`default._domainkey.${d}`} value="v=DKIM1; k=rsa; p=<public key from Zoiko>" />
            <RecordRow type="DMARC (TXT)" host={`_dmarc.${d}`} value="v=DMARC1; p=quarantine" />
          </div>

          <div className="space-y-2 border-t border-[var(--border)] pt-4">
            <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-[var(--ink3)]">
              <History className="h-3.5 w-3.5" /> Check history
            </p>
            {checksLoading ? (
              <div className="flex items-center gap-2 py-2 text-xs text-[var(--ink3)]">
                <RefreshCw className="h-3.5 w-3.5 animate-spin" /> Loading…
              </div>
            ) : checks.length === 0 ? (
              <p className="py-2 text-xs text-[var(--ink3)]">No checks recorded yet. Run diagnostics to record one.</p>
            ) : (
              <ul className="space-y-1.5">
                {checks.slice(0, 10).map((c) => {
                  const allPass = c.verificationStatus === "VERIFIED"
                    && [c.mxStatus, c.spfStatus, c.dkimStatus, c.dmarcStatus].every((s) => s === "VALID");
                  return (
                    <li key={c.id} className="flex items-center justify-between rounded-md bg-[var(--s2)] px-2.5 py-1.5 text-xs">
                      <span className="flex items-center gap-1.5 text-[var(--ink2)]">
                        <ShieldCheck className="h-3.5 w-3.5 text-[var(--ink3)]" />
                        {fmtDate(c.checkedAt)}
                      </span>
                      <span className={`zoiko-pill ${allPass ? "ok" : "crit"}`}>{allPass ? "All passed" : "Not ready"}</span>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
