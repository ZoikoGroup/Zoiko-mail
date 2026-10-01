"use client";

import { useState } from "react";
import { Card, InlineEmpty, InlineError, LoadingRows, Pill, Row } from "@/components/admin/ui";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { StepUpDialog, useStepUp } from "@/components/admin/StepUpDialog";
import type { ConnectProviderInput } from "@/lib/domains-api";
import { useConnectDnsProvider, useDnsProviders, useRemoveDnsProvider, useVerifyDnsProvider } from "@/lib/domains-hooks";
import { relativeTime } from "./format";

/**
 * API access to the workspace's DNS host, which is what lets records be
 * published and repaired without anybody copying them.
 *
 * Storing and removing a credential are step-up on the server (they hand the
 * platform, or take back, write access to a system outside it); `useStepUp`
 * turns that refusal into a password prompt rather than an error.
 */
export function DnsProvidersPanel({ canManage }: { canManage: boolean }) {
  const providers = useDnsProviders();
  const connect = useConnectDnsProvider();
  const verify = useVerifyDnsProvider();
  const remove = useRemoveDnsProvider();
  const stepUp = useStepUp();

  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<"CLOUDFLARE" | "GODADDY">("CLOUDFLARE");
  const [label, setLabel] = useState("");
  const [apiToken, setApiToken] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [apiSecret, setApiSecret] = useState("");
  const [environment, setEnvironment] = useState<"PRODUCTION" | "OTE">("PRODUCTION");
  const [confirmRemove, setConfirmRemove] = useState<{ id: string; label: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reset = () => {
    setOpen(false);
    setLabel("");
    setApiToken("");
    setApiKey("");
    setApiSecret("");
    setError(null);
  };

  const submit = () => {
    setError(null);
    const input: ConnectProviderInput = kind === "CLOUDFLARE"
      ? { provider: "CLOUDFLARE", label: label.trim() || "Cloudflare", apiToken: apiToken.trim() }
      : { provider: "GODADDY", label: label.trim() || "GoDaddy", apiKey: apiKey.trim(), apiSecret: apiSecret.trim(), environment };
    void stepUp
      .attempt(`Connecting ${kind === "CLOUDFLARE" ? "Cloudflare" : "GoDaddy"}`, (stepUpToken) =>
        connect.mutateAsync({ input, stepUpToken }).then(reset))
      .catch((cause: Error) => setError(cause.message));
  };

  const field = "w-full rounded-lg border border-[var(--border)] bg-[var(--s2)] px-3 py-2 text-[12.4px] text-[var(--ink)]";
  const credentials = providers.data ?? [];

  return (
    <Card
      title="DNS providers"
      badge={<Pill tone="nu">{`${credentials.length}`}</Pill>}
      action={canManage && !open ? <button type="button" className="zoiko-btn sm" onClick={() => setOpen(true)}>Connect provider</button> : undefined}
    >
      {providers.error ? (
        <InlineError message={providers.error.message} onRetry={() => void providers.refetch()} />
      ) : providers.isLoading ? (
        <LoadingRows rows={1} />
      ) : credentials.length === 0 && !open ? (
        <InlineEmpty
          title="No DNS provider connected"
          hint="Connect Cloudflare or GoDaddy to publish and repair records automatically. Without one, records are added by hand."
        />
      ) : (
        credentials.map((credential) => (
          <Row
            key={credential.id}
            title={`${credential.provider === "CLOUDFLARE" ? "Cloudflare" : "GoDaddy"} — ${credential.label}`}
            detail={
              credential.status === "ACTIVE"
                ? `Verified ${relativeTime(credential.lastValidatedAt)} · used by ${credential._count?.domains ?? 0} domain(s)`
                : credential.lastError ?? "The provider rejected this credential."
            }
            right={
              <>
                <Pill tone={credential.status === "ACTIVE" ? "ok" : "crit"}>{credential.status === "ACTIVE" ? "Working" : "Invalid"}</Pill>
                {canManage && (
                  <>
                    <button type="button" className="zoiko-btn sm" disabled={verify.isPending} onClick={() => verify.mutate(credential.id)}>
                      Re-verify
                    </button>
                    <button type="button" className="zoiko-btn crit sm" onClick={() => setConfirmRemove({ id: credential.id, label: credential.label })}>
                      Remove
                    </button>
                  </>
                )}
              </>
            }
          />
        ))
      )}

      {open && (
        <div className="space-y-3 border-t border-[var(--border)] px-4 py-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block">
              <span className="mb-1 block text-[11px] font-semibold text-[var(--ink2)]">Provider</span>
              <select className={field} value={kind} onChange={(event) => setKind(event.target.value as typeof kind)}>
                <option value="CLOUDFLARE">Cloudflare</option>
                <option value="GODADDY">GoDaddy</option>
              </select>
            </label>
            <label className="block">
              <span className="mb-1 block text-[11px] font-semibold text-[var(--ink2)]">Name</span>
              <input className={field} value={label} placeholder="Main account" onChange={(event) => setLabel(event.target.value)} />
            </label>
          </div>
          {kind === "CLOUDFLARE" ? (
            <label className="block">
              <span className="mb-1 block text-[11px] font-semibold text-[var(--ink2)]">API token</span>
              <input className={field} type="password" autoComplete="off" value={apiToken} onChange={(event) => setApiToken(event.target.value)} />
              <span className="mt-1 block text-[11px] text-[var(--ink3)]">Create a token with Zone → Zone: Read and Zone → DNS: Edit, limited to the zones you will add.</span>
            </label>
          ) : (
            <>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="block">
                  <span className="mb-1 block text-[11px] font-semibold text-[var(--ink2)]">API key</span>
                  <input className={field} type="password" autoComplete="off" value={apiKey} onChange={(event) => setApiKey(event.target.value)} />
                </label>
                <label className="block">
                  <span className="mb-1 block text-[11px] font-semibold text-[var(--ink2)]">API secret</span>
                  <input className={field} type="password" autoComplete="off" value={apiSecret} onChange={(event) => setApiSecret(event.target.value)} />
                </label>
              </div>
              <label className="block max-w-[260px]">
                <span className="mb-1 block text-[11px] font-semibold text-[var(--ink2)]">Environment</span>
                <select className={field} value={environment} onChange={(event) => setEnvironment(event.target.value as typeof environment)}>
                  <option value="PRODUCTION">Production</option>
                  <option value="OTE">OTE (test)</option>
                </select>
              </label>
              <p className="text-[11px] text-[var(--ink3)]">GoDaddy only grants DNS API access to some account types. If yours is refused, use manual setup or the zone file.</p>
            </>
          )}
          <p className="text-[11px] text-[var(--ink3)]">The credential is checked with the provider, then kept in the secret store. It is never shown again.</p>
          {error && <p className="text-[11.5px] text-[var(--crit)]">{error}</p>}
          <div className="flex justify-end gap-2">
            <button type="button" className="zoiko-btn sm" onClick={reset} disabled={connect.isPending}>Cancel</button>
            <button
              type="button"
              className="zoiko-btn pri sm"
              disabled={connect.isPending || (kind === "CLOUDFLARE" ? !apiToken.trim() : !apiKey.trim() || !apiSecret.trim())}
              onClick={submit}
            >
              {connect.isPending ? "Checking…" : "Connect"}
            </button>
          </div>
        </div>
      )}

      <StepUpDialog {...stepUp.dialog} />
      <ConfirmDialog
        open={confirmRemove !== null}
        onClose={() => setConfirmRemove(null)}
        onConfirm={() => {
          const target = confirmRemove;
          setConfirmRemove(null);
          if (!target) return;
          void stepUp
            .attempt(`Removing ${target.label}`, (stepUpToken) => remove.mutateAsync({ credentialId: target.id, stepUpToken }))
            .catch((cause: Error) => setError(cause.message));
        }}
        title={`Remove ${confirmRemove?.label ?? "this credential"}?`}
        message="Domains that publish through it must be switched to manual first. Records already in your DNS stay where they are."
        confirmLabel="Remove credential"
        loading={remove.isPending}
      />
      {error && !open && <p className="px-4 pb-3 text-[11.5px] text-[var(--crit)]">{error}</p>}
    </Card>
  );
}
