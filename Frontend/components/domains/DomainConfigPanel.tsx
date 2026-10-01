"use client";

import { useEffect, useMemo, useState } from "react";
import { ToggleRow } from "@/components/admin/ui";
import type { DmarcPolicy, DomainConfigInput, DomainDetail } from "@/lib/domains-api";
import { useDnsProviders, useUpdateDomain } from "@/lib/domains-hooks";

/**
 * The settings a domain's records are generated from.
 *
 * Saving regenerates the records on the server, republishes them when a DNS
 * provider is connected, and schedules a check — so the record list above
 * changes as soon as this is saved, and verifies itself shortly after.
 */
export function DomainConfigPanel({ domain, canManage }: { domain: DomainDetail; canManage: boolean }) {
  const providers = useDnsProviders();
  const update = useUpdateDomain();

  const initial = useMemo(() => ({
    publishing: domain.dnsProvider === "MANUAL" ? "MANUAL" : domain.dnsCredentialId ?? "MANUAL",
    receivingEnabled: domain.receivingEnabled,
    replaceExistingMx: domain.replaceExistingMx,
    autoActivateSending: domain.autoActivateSending,
    dmarcPolicy: domain.dmarcPolicy,
    dmarcReportEmail: domain.dmarcReportEmail ?? "",
  }), [domain]);
  const [form, setForm] = useState(initial);
  useEffect(() => setForm(initial), [initial]);

  const dirty = JSON.stringify(form) !== JSON.stringify(initial);
  const automatic = form.publishing !== "MANUAL";
  const set = <K extends keyof typeof form>(key: K, value: (typeof form)[K]) => setForm((current) => ({ ...current, [key]: value }));

  const save = () => {
    const credential = providers.data?.find((entry) => entry.id === form.publishing);
    const input: DomainConfigInput = {
      dnsProvider: credential ? credential.provider : "MANUAL",
      dnsCredentialId: credential ? credential.id : null,
      receivingEnabled: form.receivingEnabled,
      replaceExistingMx: form.replaceExistingMx,
      autoActivateSending: form.autoActivateSending,
      dmarcPolicy: form.dmarcPolicy,
      dmarcReportEmail: form.dmarcReportEmail.trim() || null,
    };
    update.mutate({ domainId: domain.id, input });
  };

  const disabled = !canManage || update.isPending;
  const select = "w-full rounded-lg border border-[var(--border)] bg-[var(--s2)] px-3 py-2 text-[12.4px] text-[var(--ink)] disabled:opacity-60";

  return (
    <div>
      <div className="grid gap-3 border-b border-[var(--border)] px-4 py-3 sm:grid-cols-2">
        <label className="block">
          <span className="mb-1 block text-[11px] font-semibold text-[var(--ink2)]">DNS publishing</span>
          <select className={select} value={form.publishing} disabled={disabled} onChange={(event) => set("publishing", event.target.value)}>
            <option value="MANUAL">Manual — I add the records myself</option>
            {(providers.data ?? []).map((credential) => (
              <option key={credential.id} value={credential.id} disabled={credential.status !== "ACTIVE"}>
                {credential.provider === "CLOUDFLARE" ? "Cloudflare" : "GoDaddy"} — {credential.label}
                {credential.status !== "ACTIVE" ? " (invalid)" : ""}
              </option>
            ))}
          </select>
          <span className="mt-1 block text-[11px] text-[var(--ink3)]">
            {automatic ? "Records are written to your DNS host for you, and repaired if they go missing." : "Copy each record into your DNS host, or import the zone file."}
          </span>
        </label>
        <label className="block">
          <span className="mb-1 block text-[11px] font-semibold text-[var(--ink2)]">DMARC policy</span>
          <select className={select} value={form.dmarcPolicy} disabled={disabled} onChange={(event) => set("dmarcPolicy", event.target.value as DmarcPolicy)}>
            <option value="NONE">none — monitor only (start here)</option>
            <option value="QUARANTINE">quarantine — failing mail goes to spam</option>
            <option value="REJECT">reject — failing mail is refused</option>
          </select>
          <span className="mt-1 block text-[11px] text-[var(--ink3)]">A stricter policy you already publish is kept.</span>
        </label>
        <label className="block sm:col-span-2">
          <span className="mb-1 block text-[11px] font-semibold text-[var(--ink2)]">DMARC report mailbox (optional)</span>
          <input
            type="email"
            className={select}
            placeholder={`dmarc@${domain.domainName}`}
            value={form.dmarcReportEmail}
            disabled={disabled}
            onChange={(event) => set("dmarcReportEmail", event.target.value)}
          />
        </label>
      </div>

      <ToggleRow
        label="Receive mail here"
        detail="Generates MX records pointing at Zoiko Mail. Turn off to keep your current mail host and only send."
        enabled={form.receivingEnabled}
        locked={!canManage}
        disabled={update.isPending}
        onToggle={() => set("receivingEnabled", !form.receivingEnabled)}
      />
      {form.receivingEnabled && automatic && (
        <ToggleRow
          label="Replace existing MX records"
          detail="When publishing, remove the domain's other mail hosts. This moves the domain's inbound mail to Zoiko Mail."
          enabled={form.replaceExistingMx}
          locked={!canManage}
          disabled={update.isPending}
          onToggle={() => set("replaceExistingMx", !form.replaceExistingMx)}
        />
      )}
      <ToggleRow
        label="Enable sending automatically"
        detail="Switch sending on as soon as ownership, SPF, DKIM and DMARC all verify."
        enabled={form.autoActivateSending}
        locked={!canManage}
        disabled={update.isPending}
        onToggle={() => set("autoActivateSending", !form.autoActivateSending)}
      />

      {canManage && (
        <div className="flex flex-wrap items-center gap-2 px-4 py-3">
          {update.error && <span className="text-[11.5px] text-[var(--crit)]">{update.error.message}</span>}
          <button type="button" className="zoiko-btn sm ml-auto" disabled={!dirty || update.isPending} onClick={() => setForm(initial)}>
            Reset
          </button>
          <button type="button" className="zoiko-btn pri sm" disabled={!dirty || update.isPending} onClick={save}>
            {update.isPending ? "Saving…" : "Save and regenerate records"}
          </button>
        </div>
      )}
    </div>
  );
}
