"use client";

import { useEffect, useState } from "react";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { DropdownMenu, DropdownItem } from "@/components/ui/DropdownMenu";
import { Modal } from "@/components/ui/Modal";
import { StepIndicator } from "@/components/ui/StepIndicator";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import {
  Globe, CheckCircle2, AlertCircle, RefreshCw, Shield, Trash2, Eye,
  Copy, Check, XCircle, AlertTriangle,
} from "lucide-react";
import {
  useDomains, useAddDomain, useRunDiagnostics, useActivateDomain, useDeleteDomain,
} from "@/lib/owner-hooks";
import type { Domain, DomainDiagnosticsResult } from "@/lib/owner-api";
import { DomainDetailsDrawer } from "./DomainDetailsDrawer";

function dnsPill(status: string) {
  switch (status) {
    case "VERIFIED": return <span className="zoiko-pill ok">Verified</span>;
    case "PENDING": return <span className="zoiko-pill warn">Pending</span>;
    case "FAILED": return <span className="zoiko-pill crit">Failed</span>;
    case "NOT_CONFIGURED": return <span className="zoiko-pill nu">Not set</span>;
    default: return <span className="zoiko-pill nu">{status}</span>;
  }
}

function overallHealth(d: Domain): { label: string; variant: "ok" | "warn" | "crit" } {
  const checks = [d.mxStatus, d.spfStatus, d.dkimStatus, d.dmarcStatus];
  if (checks.every((c) => c === "VERIFIED")) return { label: "Healthy", variant: "ok" };
  if (checks.some((c) => c === "FAILED")) return { label: "Issues", variant: "crit" };
  return { label: "Partial", variant: "warn" };
}

function CopyValue({ value }: { value: string }) {
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
    <button onClick={copy} className="flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs text-[var(--ink3)] hover:bg-[var(--s3)] hover:text-[var(--ink)]">
      {copied ? <Check className="h-3.5 w-3.5 text-[var(--ok)]" /> : <Copy className="h-3.5 w-3.5" />}
      {copied ? "Copied" : "Copy"}
    </button>
  );
}

function WizardRecord({ type, host, value }: { type: string; host: string; value: string }) {
  return (
    <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold uppercase tracking-wide text-[var(--ink3)]">{type}</span>
        <CopyValue value={value} />
      </div>
      <p className="mt-1 break-all font-mono text-xs text-[var(--ink2)]"><span className="text-[var(--ink3)]">Host: </span>{host}</p>
      <p className="mt-0.5 break-all font-mono text-xs text-[var(--ink)]"><span className="text-[var(--ink3)]">Value: </span>{value}</p>
    </div>
  );
}

const wizardSteps = [
  { label: "Enter Domain" },
  { label: "Verify Ownership" },
  { label: "MX Records" },
  { label: "SPF" },
  { label: "DKIM" },
  { label: "DMARC" },
  { label: "Validate DNS" },
  { label: "Activate" },
];

export function DomainsTable() {
  const [addOpen, setAddOpen] = useState(false);
  const [wizardStep, setWizardStep] = useState(0);
  const [newDomain, setNewDomain] = useState("");
  const [wizardDomainId, setWizardDomainId] = useState<string | null>(null);
  const [wizardCreated, setWizardCreated] = useState<Domain | null>(null);
  const [diagResult, setDiagResult] = useState<DomainDiagnosticsResult | null>(null);
  const [validating, setValidating] = useState(false);
  const [detailsId, setDetailsId] = useState<string | null>(null);
  const [confirmActivate, setConfirmActivate] = useState<Domain | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<Domain | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const { data: domains = [], isLoading } = useDomains();
  const addDomain = useAddDomain();
  const runDiagnostics = useRunDiagnostics();
  const activateDomain = useActivateDomain();
  const deleteDomain = useDeleteDomain();

  const wizardDomain = domains.find((d) => d.id === wizardDomainId) ?? wizardCreated;
  const detailsDomain = domains.find((d) => d.id === detailsId) ?? null;

  const diagReady = !!diagResult
    && diagResult.verificationStatus === "VERIFIED"
    && diagResult.spfStatus === "VERIFIED"
    && diagResult.dkimStatus === "VERIFIED"
    && diagResult.dmarcStatus === "VERIFIED";

  const openAddWizard = () => {
    setAddOpen(true);
    setWizardStep(0);
    setNewDomain("");
    setWizardDomainId(null);
    setWizardCreated(null);
    setDiagResult(null);
    setValidating(false);
    setActionError(null);
  };

  const validateNow = async () => {
    if (!wizardDomainId) return;
    setValidating(true);
    setDiagResult(null);
    setActionError(null);
    try {
      const result = await runDiagnostics.mutateAsync(wizardDomainId);
      setDiagResult(result);
      if (
        result.verificationStatus !== "VERIFIED" ||
        result.spfStatus !== "VERIFIED" ||
        result.dkimStatus !== "VERIFIED" ||
        result.dmarcStatus !== "VERIFIED"
      ) {
        setWizardStep(6.5);
      }
    } catch {
      setWizardStep(6.5);
    } finally {
      setValidating(false);
    }
  };

  useEffect(() => {
    if (Math.floor(wizardStep) === 6 && !diagResult && !validating) {
      void validateNow();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wizardStep]);

  const columns: Column<Domain>[] = [
    {
      key: "domain",
      label: "Domain",
      sortable: true,
      render: (row) => (
        <div className="flex items-center gap-2">
          <Globe className="h-4 w-4 text-[var(--ink3)]" />
          <span className="font-medium text-[var(--ink)]">{row.domain}</span>
          {row.isActive && <span className="zoiko-pill ok">Active</span>}
        </div>
      ),
    },
    { key: "mxStatus", label: "MX", render: (row) => dnsPill(row.mxStatus) },
    { key: "spfStatus", label: "SPF", render: (row) => dnsPill(row.spfStatus) },
    { key: "dkimStatus", label: "DKIM", render: (row) => dnsPill(row.dkimStatus) },
    { key: "dmarcStatus", label: "DMARC", render: (row) => dnsPill(row.dmarcStatus) },
    {
      key: "verificationStatus",
      label: "Health",
      render: (row) => {
        const h = overallHealth(row);
        return <StatusBadge variant={h.variant}>{h.label}</StatusBadge>;
      },
    },
  ];

  const d = wizardDomain?.domain ?? newDomain;

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <button onClick={openAddWizard} className="zoiko-btn pri">
          <Globe className="h-3.5 w-3.5" />
          Add Domain
        </button>
      </div>

      {actionError && (
        <div className="flex items-center gap-2 rounded-lg border border-[var(--crit)]/30 bg-[var(--crit-soft)] px-3 py-2 text-sm text-[var(--crit)]">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          {actionError}
          <button onClick={() => setActionError(null)} className="ml-auto text-xs underline">Dismiss</button>
        </div>
      )}

      <DataTable
        columns={columns}
        data={domains}
        keyExtractor={(row) => row.id}
        pageSize={10}
        emptyMessage={isLoading ? "Loading domains…" : "No domains configured."}
        actions={(row) => (
          <DropdownMenu>
            <DropdownItem onClick={() => setDetailsId(row.id)}>
              <Eye className="h-3.5 w-3.5" /> View Details
            </DropdownItem>
            <DropdownItem
              onClick={() =>
                runDiagnostics
                  .mutateAsync(row.id)
                  .then(() => setDetailsId(row.id))
                  .catch((err) =>
                    setActionError(err?.response?.data?.error?.message ?? err?.message ?? "Diagnostics failed.")
                  )
              }
            >
              <RefreshCw className={`h-3.5 w-3.5 ${runDiagnostics.isPending ? "animate-spin" : ""}`} /> Run Diagnostics
            </DropdownItem>
            {!row.isActive && (
              <DropdownItem onClick={() => setConfirmActivate(row)}>
                <Shield className="h-3.5 w-3.5" /> Activate
              </DropdownItem>
            )}
            {!row.isActive && (
              <DropdownItem onClick={() => setConfirmDelete(row)}>
                <Trash2 className="h-3.5 w-3.5" /> Delete
              </DropdownItem>
            )}
          </DropdownMenu>
        )}
      />

      {/* Add Domain Wizard */}
      <Modal
        open={addOpen}
        onClose={() => setAddOpen(false)}
        title="Add Domain"
        size="lg"
        footer={
          <>
            <button onClick={() => setAddOpen(false)} className="zoiko-btn">Cancel</button>
            {wizardStep === 0 && (
              <button
                onClick={() => {
                  if (!newDomain.trim()) return;
                  addDomain.mutate(
                    { domain: newDomain.trim() },
                    {
                      onSuccess: (created) => {
                        setWizardDomainId(created.id);
                        setWizardCreated(created);
                        setWizardStep(1);
                      },
                      onError: (err) =>
                        setActionError(err instanceof Error ? err.message : "Failed to add domain."),
                    }
                  );
                }}
                className="zoiko-btn pri"
                disabled={!newDomain.trim() || addDomain.isPending}
              >
                {addDomain.isPending ? "Adding…" : "Add Domain"}
              </button>
            )}
            {wizardStep >= 1 && wizardStep <= 5 && (
              <button
                onClick={() => setWizardStep(wizardStep + 1)}
                className="zoiko-btn pri"
              >
                Next Step
              </button>
            )}
            {wizardStep >= 6 && wizardStep < 7 && (
              <button
                onClick={() => void validateNow()}
                className="zoiko-btn pri"
                disabled={validating}
              >
                <RefreshCw className={`h-3.5 w-3.5 ${validating ? "animate-spin" : ""}`} />
                Re-check DNS
              </button>
            )}
            {wizardStep === 7 && (
              <button
                onClick={() =>
                  wizardDomainId &&
                  activateDomain.mutate(wizardDomainId, {
                    onSuccess: () => setAddOpen(false),
                    onError: (err) =>
                      setActionError(err instanceof Error ? err.message : "Activation failed."),
                  })
                }
                className="zoiko-btn pri"
                disabled={activateDomain.isPending || !diagReady}
              >
                <Shield className="h-3.5 w-3.5" />
                {activateDomain.isPending ? "Activating…" : "Activate Sending"}
              </button>
            )}
          </>
        }
      >
        <div className="space-y-6">
          <StepIndicator steps={wizardSteps} current={Math.min(Math.floor(wizardStep), 7)} />

          {wizardStep === 0 && (
            <div>
              <label className="mb-1 block text-sm font-medium text-[var(--ink2)]">Domain Name</label>
              <input
                type="text"
                value={newDomain}
                onChange={(e) => setNewDomain(e.target.value)}
                placeholder="yourdomain.com"
                className="h-9 w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 text-sm text-[var(--ink)] placeholder:text-[var(--ink3)] focus:border-[var(--accent)] focus:outline-none focus:ring-1 focus:ring-[var(--accent)]"
              />
              <p className="mt-2 text-xs text-[var(--ink3)]">
                A unique verification record will be generated for your domain.
              </p>
            </div>
          )}

          {wizardStep === 1 && (
            <div className="space-y-3">
              <div className="rounded-lg border border-[var(--border)] bg-[var(--s2)] p-4">
                <div className="flex items-center gap-2 text-sm font-medium text-[var(--ink)]">
                  <AlertCircle className="h-4 w-4 text-[var(--warn)]" />
                  Prove ownership of {d}
                </div>
                <p className="mt-2 text-sm text-[var(--ink3)]">
                  Add this exact TXT record at your DNS provider, then press Next. Changes can take time to propagate.
                </p>
              </div>
              <WizardRecord type="TXT (ownership)" host="@" value={wizardDomain?.verificationToken || "(token unavailable — reopen the wizard)"} />
            </div>
          )}

          {wizardStep === 2 && (
            <div className="space-y-3">
              <p className="text-sm text-[var(--ink3)]">Point inbound mail for {d} at Zoiko&apos;s servers.</p>
              <WizardRecord type="MX" host="@" value="mail.zoiko.dev (priority 10)" />
            </div>
          )}

          {wizardStep === 3 && (
            <div className="space-y-3">
              <p className="text-sm text-[var(--ink3)]">Authorize Zoiko to send email on behalf of {d}.</p>
              <WizardRecord type="SPF (TXT)" host="@" value="v=spf1 include:zoiko.dev ~all" />
            </div>
          )}

          {wizardStep === 4 && (
            <div className="space-y-3">
              <p className="text-sm text-[var(--ink3)]">
                Publish Zoiko&apos;s DKIM signing key so receivers can verify messages from {d}.
              </p>
              <WizardRecord type="DKIM (TXT)" host={`default._domainkey.${d}`} value="v=DKIM1; k=rsa; p=<provided by Zoiko support>" />
            </div>
          )}

          {wizardStep === 5 && (
            <div className="space-y-3">
              <p className="text-sm text-[var(--ink3)]">Tell receivers what to do with unauthenticated mail claiming to be from {d}.</p>
              <WizardRecord type="DMARC (TXT)" host={`_dmarc.${d}`} value="v=DMARC1; p=quarantine" />
            </div>
          )}

          {(wizardStep === 6 || wizardStep === 6.5) && (
            validating ? (
              <div className="flex flex-col items-center py-6 text-center">
                <RefreshCw className="h-8 w-8 animate-spin text-[var(--accent)]" />
                <p className="mt-3 text-sm font-medium text-[var(--ink)]">Checking live DNS records…</p>
                <p className="mt-1 text-sm text-[var(--ink3)]">This may take a moment.</p>
              </div>
            ) : diagResult ? (
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-2">
                  {[
                    ["Ownership TXT", diagResult.verificationStatus],
                    ["MX", diagResult.mxStatus],
                    ["SPF", diagResult.spfStatus],
                    ["DKIM", diagResult.dkimStatus],
                    ["DMARC", diagResult.dmarcStatus],
                  ].map(([label, status]) => (
                    <div key={String(label)} className="flex items-center justify-between rounded-lg border border-[var(--border)] px-3 py-2 text-xs">
                      <span className="text-[var(--ink3)]">{label}</span>
                      {dnsPill(String(status))}
                    </div>
                  ))}
                </div>
                {Object.entries(diagResult.errorDetails ?? {}).map(([key, err]) => (
                  <div key={key} className="flex items-start gap-2 rounded-lg border border-[var(--crit)]/30 bg-[var(--crit-soft)] px-3 py-2 text-xs text-[var(--ink2)]">
                    <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--crit)]" />
                    <span><span className="font-semibold uppercase">{key}:</span> {err.message}</span>
                  </div>
                ))}
                {diagReady ? (
                  <div className="flex items-center gap-2 rounded-lg bg-[var(--ok-soft,#e8f7ef)] px-3 py-2 text-sm text-[var(--ok)]">
                    <CheckCircle2 className="h-4 w-4" /> All required records verified.
                  </div>
                ) : (
                  <div className="flex items-start gap-2 rounded-lg border border-[var(--warn)]/40 bg-[var(--warn-soft)] px-3 py-2 text-xs text-[var(--ink2)]">
                    <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--warn)]" />
                    Some records are not live yet. Fix them at your DNS provider and re-check.
                  </div>
                )}
              </div>
            ) : (
              <div className="rounded-lg border border-[var(--crit)]/30 bg-[var(--crit-soft)] px-3 py-2 text-sm text-[var(--crit)]">
                Diagnostics could not run. Please retry.
              </div>
            )
          )}

          {wizardStep === 7 && (
            <div className="flex flex-col items-center py-6 text-center">
              <span className="inline-flex h-12 w-12 items-center justify-center rounded-full bg-[var(--ok-soft,#e8f7ef)]">
                <CheckCircle2 className="h-6 w-6 text-[var(--ok)]" />
              </span>
              <p className="mt-3 text-sm font-medium text-[var(--ink)]">
                {diagReady ? "DNS validation passed" : "Setup recorded"}
              </p>
              <p className="mt-1 text-sm text-[var(--ink3)]">
                {diagReady
                  ? "Activate sending below, or do it later from the domain's menu."
                  : diagResult
                    ? "Some checks are still failing — you can re-check later from the domain's menu."
                    : "You can finish setup later from the domain's menu."}
              </p>
            </div>
          )}
        </div>
      </Modal>

      <ConfirmDialog
        open={!!confirmActivate}
        onClose={() => setConfirmActivate(null)}
        onConfirm={() => {
          if (confirmActivate) {
            activateDomain.mutate(confirmActivate.id, {
              onError: (err) =>
                setActionError(err instanceof Error ? err.message : "Activation failed."),
            });
          }
          setConfirmActivate(null);
        }}
        title="Activate Domain"
        message={`Activate ${confirmActivate?.domain}? This will enable sending from this domain.`}
        confirmLabel="Activate"
        variant="warning"
      />

      <ConfirmDialog
        open={!!confirmDelete}
        onClose={() => setConfirmDelete(null)}
        onConfirm={() => {
          if (confirmDelete) {
            deleteDomain.mutate(confirmDelete.id, {
              onError: (err) =>
                setActionError(err instanceof Error ? err.message : "Failed to delete domain."),
            });
          }
          setConfirmDelete(null);
        }}
        title="Delete Domain"
        message={`Delete ${confirmDelete?.domain}? Its DNS check history will be removed. Active domains cannot be deleted.`}
        confirmLabel="Delete"
        variant="warning"
      />

      <DomainDetailsDrawer domain={detailsDomain} onClose={() => setDetailsId(null)} />
    </div>
  );
}
