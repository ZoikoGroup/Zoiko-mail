"use client";

import { useState } from "react";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { StatusBadge, statusBadge } from "@/components/ui/StatusBadge";
import { DropdownMenu, DropdownItem } from "@/components/ui/DropdownMenu";
import { Modal } from "@/components/ui/Modal";
import { StepIndicator } from "@/components/ui/StepIndicator";
import { Globe, CheckCircle2, AlertCircle, RefreshCw, Shield } from "lucide-react";

interface DomainRow {
  id: string;
  domain: string;
  verificationStatus: string;
  mxStatus: string;
  spfStatus: string;
  dkimStatus: string;
  dmarcStatus: string;
  isActive: boolean;
  createdAt: string;
}

const mockDomains: DomainRow[] = [
  { id: "d1", domain: "zoiko.dev", verificationStatus: "VERIFIED", mxStatus: "VERIFIED", spfStatus: "VERIFIED", dkimStatus: "VERIFIED", dmarcStatus: "VERIFIED", isActive: true, createdAt: "2026-06-01T00:00:00Z" },
  { id: "d2", domain: "mail.zoiko.dev", verificationStatus: "VERIFIED", mxStatus: "VERIFIED", spfStatus: "VERIFIED", dkimStatus: "PENDING", dmarcStatus: "NOT_CONFIGURED", isActive: false, createdAt: "2026-08-15T00:00:00Z" },
];

function dnsPill(status: string) {
  switch (status) {
    case "VERIFIED": return <span className="zoiko-pill ok">Verified</span>;
    case "PENDING": return <span className="zoiko-pill warn">Pending</span>;
    case "FAILED": return <span className="zoiko-pill crit">Failed</span>;
    case "NOT_CONFIGURED": return <span className="zoiko-pill nu">Not set</span>;
    default: return <span className="zoiko-pill nu">{status}</span>;
  }
}

function overallHealth(d: DomainRow): { label: string; variant: "ok" | "warn" | "crit" } {
  const checks = [d.mxStatus, d.spfStatus, d.dkimStatus, d.dmarcStatus];
  if (checks.every((c) => c === "VERIFIED")) return { label: "Healthy", variant: "ok" };
  if (checks.some((c) => c === "FAILED")) return { label: "Issues", variant: "crit" };
  return { label: "Partial", variant: "warn" };
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

  const columns: Column<DomainRow>[] = [
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

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <button onClick={() => { setAddOpen(true); setWizardStep(0); setNewDomain(""); }} className="zoiko-btn pri">
          <Globe className="h-3.5 w-3.5" />
          Add Domain
        </button>
      </div>

      <DataTable
        columns={columns}
        data={mockDomains}
        keyExtractor={(row) => row.id}
        pageSize={10}
        emptyMessage="No domains configured."
        actions={(row) => (
          <DropdownMenu>
            <DropdownItem onClick={() => {}}>
              <RefreshCw className="h-3.5 w-3.5" /> Run Diagnostics
            </DropdownItem>
            {!row.isActive && (
              <DropdownItem onClick={() => {}}>
                <Shield className="h-3.5 w-3.5" /> Activate
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
            {wizardStep < 7 ? (
              <button
                onClick={() => setWizardStep((s) => Math.min(7, s + 1))}
                className="zoiko-btn pri"
                disabled={wizardStep === 0 && !newDomain.trim()}
              >
                Next Step
              </button>
            ) : (
              <button onClick={() => setAddOpen(false)} className="zoiko-btn pri">
                Activate Domain
              </button>
            )}
          </>
        }
      >
        <div className="space-y-6">
          <StepIndicator steps={wizardSteps} current={wizardStep} />

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
            </div>
          )}

          {wizardStep >= 1 && wizardStep <= 5 && (
            <div className="rounded-lg border border-[var(--border)] bg-[var(--s2)] p-4">
              <div className="flex items-center gap-2 text-sm font-medium text-[var(--ink)]">
                <AlertCircle className="h-4 w-4 text-[var(--warn)]" />
                DNS Configuration Required
              </div>
              <p className="mt-2 text-sm text-[var(--ink3)]">
                Add the following DNS records to your domain provider. Changes may take up to 48 hours to propagate.
              </p>
              <div className="mt-3 rounded-md bg-[var(--surface)] p-3 font-mono text-xs text-[var(--ink2)]">
                {wizardStep === 1 && "Add a TXT record with your verification code."}
                {wizardStep === 2 && "Configure MX records: mail.zoiko.dev (priority 10)"}
                {wizardStep === 3 && 'Add TXT record: v=spf1 include:zoiko.dev ~all'}
                {wizardStep === 4 && "Add DKIM record: selector._domainkey.zoiko.dev"}
                {wizardStep === 5 && 'Add DMARC record: _dmarc.zoiko.dev TXT "v=DMARC1; p=quarantine"'}
              </div>
            </div>
          )}

          {wizardStep === 6 && (
            <div className="flex flex-col items-center py-6 text-center">
              <RefreshCw className="h-8 w-8 animate-spin text-[var(--accent)]" />
              <p className="mt-3 text-sm font-medium text-[var(--ink)]">Validating DNS records…</p>
              <p className="mt-1 text-sm text-[var(--ink3)]">This may take a moment.</p>
            </div>
          )}

          {wizardStep === 7 && (
            <div className="flex flex-col items-center py-6 text-center">
              <span className="inline-flex h-12 w-12 items-center justify-center rounded-full bg-[var(--ok-soft)]">
                <CheckCircle2 className="h-6 w-6 text-[var(--ok)]" />
              </span>
              <p className="mt-3 text-sm font-medium text-[var(--ink)]">DNS validation passed</p>
              <p className="mt-1 text-sm text-[var(--ink3)]">Your domain is ready to be activated.</p>
            </div>
          )}
        </div>
      </Modal>
    </div>
  );
}
