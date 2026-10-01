"use client";

import { useState } from "react";
import { Card, InlineEmpty, InlineError, LoadingRows } from "@/components/admin/ui";
import { useAddDomainDetail, useDnsProviders, useDomainList } from "@/lib/domains-hooks";
import { DomainCard } from "./DomainCard";
import { DnsProvidersPanel } from "./DnsProvidersPanel";

/** Something plausible enough to be worth sending to the server. */
const DOMAIN_PATTERN = /^(?=.{1,253}$)(?!-)(?:[a-z0-9-]+\.)+[a-z]{2,63}$/;

/**
 * The whole domains screen, shared by the admin and owner consoles.
 *
 * Adding a domain is one field: the server generates the token, the DKIM
 * key and every record, publishes them if a DNS provider is chosen, and
 * starts checking. Everything after that is visible here and updates on its
 * own.
 */
export function DomainsWorkspace({ canManage, addOpen, onAddOpenChange }: {
  canManage: boolean;
  addOpen: boolean;
  onAddOpenChange: (open: boolean) => void;
}) {
  const domains = useDomainList();

  return (
    <>
      {addOpen && canManage && <AddDomainCard onDone={() => onAddOpenChange(false)} />}

      {domains.error ? (
        <Card>
          <InlineError message={domains.error.message} onRetry={() => void domains.refetch()} />
        </Card>
      ) : domains.isLoading || !domains.data ? (
        <Card>
          <LoadingRows rows={4} />
        </Card>
      ) : domains.data.length === 0 ? (
        <Card>
          <InlineEmpty title="No domains yet" hint="Add a domain to send and receive mail at your own address." />
        </Card>
      ) : (
        domains.data.map((domain) => <DomainCard key={domain.id} domain={domain} canManage={canManage} />)
      )}

      <DnsProvidersPanel canManage={canManage} />
    </>
  );
}

function AddDomainCard({ onDone }: { onDone: () => void }) {
  const add = useAddDomainDetail();
  const providers = useDnsProviders();
  const [name, setName] = useState("");
  const [publishing, setPublishing] = useState("MANUAL");
  const [receivingEnabled, setReceivingEnabled] = useState(true);
  const [nameError, setNameError] = useState<string | null>(null);

  const submit = () => {
    const domainName = name.trim().toLowerCase();
    setNameError(null);
    if (!DOMAIN_PATTERN.test(domainName)) {
      // The server applies the same rule; checking here means a typo is a
      // message under the field rather than a failed request.
      setNameError("Enter a domain like acme.com — no scheme, no path.");
      return;
    }
    const credential = providers.data?.find((entry) => entry.id === publishing);
    add.mutate(
      {
        domainName,
        receivingEnabled,
        ...(credential ? { dnsProvider: credential.provider, dnsCredentialId: credential.id } : {}),
      },
      {
        onSuccess: () => {
          setName("");
          onDone();
        },
      }
    );
  };

  const field = "w-full rounded-lg border border-[var(--border)] bg-[var(--s2)] px-3 py-2 text-[12.6px] text-[var(--ink)] placeholder:text-[var(--ink3)]";

  return (
    <Card title="Add a domain" padded>
      <div className="grid max-w-[640px] gap-3 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <label htmlFor="domain-name" className="font-mono-num mb-1 block text-[9.5px] uppercase tracking-[0.1em] text-[var(--ink3)]">
            Domain name
          </label>
          <input
            id="domain-name"
            value={name}
            placeholder="acme.com"
            disabled={add.isPending}
            onChange={(event) => setName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") submit();
            }}
            className={field}
          />
          {nameError && <p className="mt-1.5 text-[11.5px] text-[var(--crit)]">{nameError}</p>}
        </div>
        <label className="block">
          <span className="font-mono-num mb-1 block text-[9.5px] uppercase tracking-[0.1em] text-[var(--ink3)]">Publish records</span>
          <select className={field} value={publishing} disabled={add.isPending} onChange={(event) => setPublishing(event.target.value)}>
            <option value="MANUAL">Manually, at my DNS host</option>
            {(providers.data ?? []).filter((entry) => entry.status === "ACTIVE").map((credential) => (
              <option key={credential.id} value={credential.id}>
                Automatically via {credential.provider === "CLOUDFLARE" ? "Cloudflare" : "GoDaddy"} — {credential.label}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-2 self-end pb-2 text-[12px] text-[var(--ink2)]">
          <input type="checkbox" checked={receivingEnabled} disabled={add.isPending} onChange={(event) => setReceivingEnabled(event.target.checked)} />
          Receive this domain&apos;s mail in Zoiko Mail
        </label>
      </div>
      {add.error && <p className="mt-2 text-[11.5px] text-[var(--crit)]">{add.error.message}</p>}
      <p className="mt-3 max-w-[640px] text-[11.5px] text-[var(--ink3)]">
        Adding it generates an ownership token, a DKIM signing key and every record the domain needs, then checks DNS every few
        minutes. Nothing sends from the domain until ownership, SPF, DKIM and DMARC verify.
      </p>
      <div className="mt-3 flex gap-2">
        <button type="button" className="zoiko-btn pri sm" disabled={add.isPending} onClick={submit}>
          {add.isPending ? "Adding…" : "Add domain"}
        </button>
        <button type="button" className="zoiko-btn sm" disabled={add.isPending} onClick={onDone}>
          Cancel
        </button>
      </div>
    </Card>
  );
}
