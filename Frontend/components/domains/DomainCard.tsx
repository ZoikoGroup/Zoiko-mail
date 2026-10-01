"use client";

import { useState } from "react";
import { Card, InlineEmpty, InlineError, LoadingRows, Notice, Pill, Table, TableWrap, Td, Th, type Tone } from "@/components/admin/ui";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { StepUpDialog, useStepUp } from "@/components/admin/StepUpDialog";
import { downloadZoneFile, type DomainCheck, type DomainDetail, type LegacyDnsStatus } from "@/lib/domains-api";
import {
  useActivateDomainDetail,
  useDeactivateDomain,
  useDomainChecks,
  usePublishDomain,
  useRecheckDomainDetail,
  useRemoveDomainDetail,
  useRotateDkim,
} from "@/lib/domains-hooks";
import { DnsRecordsTable } from "./DnsRecordsTable";
import { DomainConfigPanel } from "./DomainConfigPanel";
import { PURPOSE_LABEL, STATUS_LABEL, STATUS_TONE, absoluteTime, relativeTime } from "./format";

type Tab = "records" | "settings" | "history";

/**
 * One domain, end to end: where it is in its lifecycle, what to publish,
 * what the last check found, and the actions that move it on.
 */
export function DomainCard({ domain, canManage }: { domain: DomainDetail; canManage: boolean }) {
  const [tab, setTab] = useState<Tab>("records");
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [confirmRotate, setConfirmRotate] = useState(false);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const recheck = useRecheckDomainDetail();
  const publish = usePublishDomain();
  const rotate = useRotateDkim();
  const activate = useActivateDomainDetail();
  const deactivate = useDeactivateDomain();
  const remove = useRemoveDomainDetail();
  const stepUp = useStepUp();

  const zoiko = domain.type === "ZOIKO";
  const automatic = domain.dnsProvider !== "MANUAL";
  const pendingKey = domain.dkimKeys.find((key) => key.status === "PENDING");
  const busy = recheck.isPending || publish.isPending || rotate.isPending || activate.isPending || deactivate.isPending || remove.isPending;
  const failure = recheck.error ?? publish.error ?? rotate.error ?? activate.error ?? deactivate.error ?? remove.error;
  const inGrace = domain.graceUntil !== null && new Date(domain.graceUntil).getTime() > Date.now();
  const blocking = domain.readiness.blocking.map((purpose) => PURPOSE_LABEL[purpose]).join(", ");

  return (
    <>
      <Card
        title={domain.domainName}
        badge={zoiko ? <Pill tone="accent">Zoiko-owned</Pill> : <Pill tone={STATUS_TONE[domain.status]}>{STATUS_LABEL[domain.status]}</Pill>}
        action={
          <span className="font-mono-num text-[10.5px] text-[var(--ink3)]" title={absoluteTime(domain.lastCheckedAt)}>
            checked {relativeTime(domain.lastCheckedAt)}
            {domain.nextCheckAt && !zoiko ? ` · next ${relativeTime(domain.nextCheckAt)}` : ""}
          </span>
        }
      >
        {!zoiko && (
          <div className="px-4 pt-3">
            {failure && <Notice tone="warn">{failure.message}</Notice>}
            {downloadError && <Notice tone="warn">{downloadError}</Notice>}
            {domain.status === "DEGRADED" && (
              <Notice tone="crit">
                <b className="text-[var(--crit)]">Sending is suspended.</b> {domain.suspensionReason ?? "A required record kept failing."} It
                resumes by itself once the records pass — nothing else to do but fix them.
              </Notice>
            )}
            {domain.status === "FAILED" && (
              <Notice tone="crit">
                <b className="text-[var(--crit)]">Ownership was never verified.</b> Checks continue once a day; publish the records below and
                re-check to finish setup.
              </Notice>
            )}
            {domain.status === "ACTIVE" && domain.consecutiveFailures > 0 && (
              <Notice tone="warn">
                <b className="text-[var(--warn)]">{blocking || "A record"} is failing.</b> Sending continues
                {inGrace ? ` until ${absoluteTime(domain.graceUntil)}` : ` for now (${domain.consecutiveFailures} failed check${domain.consecutiveFailures === 1 ? "" : "s"})`}, then
                it is suspended to protect deliverability.
              </Notice>
            )}
            {inGrace && domain.consecutiveFailures === 0 && domain.status === "ACTIVE" && (
              <Notice tone="info">The expected records changed. Publish the updated values by {absoluteTime(domain.graceUntil)}.</Notice>
            )}
            {domain.status === "PENDING_VERIFICATION" && (
              <Notice tone="info">
                {automatic
                  ? "Records are published to your DNS host automatically and checked every few minutes. This page updates by itself."
                  : "Add each record below at your DNS host (or import the zone file). They are checked every few minutes and this page updates by itself."}
                {domain.readiness.blocking.length > 0 && <> Waiting on: <b>{blocking}</b>.</>}
              </Notice>
            )}
            {domain.status === "VERIFIED" && !domain.sendingEnabled && (
              <Notice tone="ok">Every required record is verified. Enable sending when you are ready.</Notice>
            )}
            {domain.lastSyncError && <Notice tone="warn">{domain.lastSyncError}</Notice>}
            {pendingKey && (
              <Notice tone="info">
                DKIM rotation in progress: publish <span className="font-mono-num">{pendingKey.selector}._domainkey</span>. The current key keeps
                signing until the new one verifies.
              </Notice>
            )}
          </div>
        )}

        {canManage && !zoiko && (
          <div className="flex flex-wrap gap-2 border-b border-[var(--border)] px-4 pb-3">
            <button type="button" className="zoiko-btn sm" disabled={busy} onClick={() => recheck.mutate(domain.id)}>
              {recheck.isPending ? "Checking…" : "Re-check now"}
            </button>
            {automatic && (
              <button type="button" className="zoiko-btn sm" disabled={busy} onClick={() => publish.mutate(domain.id)}>
                {publish.isPending ? "Publishing…" : "Publish to DNS"}
              </button>
            )}
            <button
              type="button"
              className="zoiko-btn sm"
              onClick={() => {
                setDownloadError(null);
                downloadZoneFile(domain).catch((cause: Error) => setDownloadError(cause.message));
              }}
            >
              Zone file
            </button>
            <button type="button" className="zoiko-btn sm" disabled={busy || Boolean(pendingKey)} onClick={() => setConfirmRotate(true)}>
              Rotate DKIM key
            </button>
            {domain.sendingEnabled ? (
              <button type="button" className="zoiko-btn sm" disabled={busy} onClick={() => deactivate.mutate(domain.id)}>
                {deactivate.isPending ? "Disabling…" : "Disable sending"}
              </button>
            ) : (
              <button
                type="button"
                className="zoiko-btn pri sm"
                disabled={busy || !domain.readiness.sendReady}
                title={domain.readiness.sendReady ? undefined : "Ownership, SPF, DKIM and DMARC must all pass first"}
                onClick={() => activate.mutate(domain.id)}
              >
                {activate.isPending ? "Enabling…" : "Enable sending"}
              </button>
            )}
            <button
              type="button"
              className="zoiko-btn crit sm ml-auto"
              disabled={busy || domain.sendingEnabled}
              title={domain.sendingEnabled ? "Turn off sending before removing the domain" : undefined}
              onClick={() => setConfirmRemove(true)}
            >
              Remove
            </button>
          </div>
        )}

        {!zoiko && (
          <div role="tablist" aria-label={`${domain.domainName} sections`} className="flex gap-1 border-b border-[var(--border)] px-3 pt-2">
            {(["records", "settings", "history"] as const).map((key) => (
              <button
                key={key}
                type="button"
                role="tab"
                aria-selected={tab === key}
                onClick={() => setTab(key)}
                className={`-mb-px border-b-2 px-3 py-2 text-[12px] font-semibold capitalize ${tab === key ? "border-[var(--accent)] text-[var(--ink)]" : "border-transparent text-[var(--ink3)] hover:text-[var(--ink2)]"}`}
              >
                {key === "records" ? `DNS records (${domain.records.length})` : key}
              </button>
            ))}
          </div>
        )}

        {zoiko ? (
          <p className="px-4 py-4 text-[12px] text-[var(--ink3)]">Managed by Zoiko Mail. Nothing to publish.</p>
        ) : tab === "records" ? (
          <DnsRecordsTable records={domain.records} provider={domain.dnsProvider} />
        ) : tab === "settings" ? (
          <DomainConfigPanel domain={domain} canManage={canManage} />
        ) : (
          <CheckHistory domainId={domain.id} />
        )}
      </Card>

      <StepUpDialog {...stepUp.dialog} />
      <ConfirmDialog
        open={confirmRotate}
        onClose={() => setConfirmRotate(false)}
        onConfirm={() => {
          setConfirmRotate(false);
          rotate.mutate(domain.id);
        }}
        title={`Rotate the DKIM key for ${domain.domainName}?`}
        message={automatic
          ? "A new key is generated and published. It starts signing once DNS shows it; the old key stays published for a week for mail already in flight."
          : "A new key is generated. Publish its record; it starts signing once DNS shows it, and the old key stays published for a week for mail already in flight."}
        confirmLabel="Rotate key"
        variant="warning"
        loading={rotate.isPending}
      />
      <ConfirmDialog
        open={confirmRemove}
        onClose={() => setConfirmRemove(false)}
        onConfirm={() => {
          setConfirmRemove(false);
          void stepUp.attempt(`Removing ${domain.domainName}`, (stepUpToken) => remove.mutateAsync({ domainId: domain.id, stepUpToken })).catch(() => undefined);
        }}
        title={`Remove ${domain.domainName}?`}
        message={automatic
          ? "The domain, its keys and its check history are deleted, and its records are removed from your DNS host. Adding it back generates new records."
          : "The domain, its keys and its check history are deleted. Remove its records from your DNS host too. Adding it back generates new records."}
        confirmLabel="Remove domain"
        loading={remove.isPending}
      />
    </>
  );
}

const LEGACY_TONE: Record<LegacyDnsStatus | "VERIFIED" | "FAILED", Tone> = { VALID: "ok", VERIFIED: "ok", PENDING: "warn", INVALID: "crit", FAILED: "crit" };
const LEGACY_LABEL: Record<LegacyDnsStatus | "VERIFIED" | "FAILED", string> = { VALID: "Pass", VERIFIED: "Pass", PENDING: "Pending", INVALID: "Fail", FAILED: "Fail" };

/** Older rows stored bare strings; newer ones `{ code, message }`. */
function checkErrors(check: DomainCheck): string[] {
  return Object.entries(check.errorDetails ?? {}).map(([key, detail]) => {
    const message = typeof detail === "string" ? detail : (detail as { message?: string } | null)?.message ?? JSON.stringify(detail);
    return `${key.toUpperCase()}: ${message}`;
  });
}

function CheckHistory({ domainId }: { domainId: string }) {
  const { data: checks, isLoading, error } = useDomainChecks(domainId);
  if (error) return <InlineError message={error.message} />;
  if (isLoading || !checks) return <LoadingRows rows={3} />;
  if (checks.length === 0) return <InlineEmpty title="No checks recorded yet" hint="The first check runs within a minute of adding the domain." />;
  const pill = (value: LegacyDnsStatus | "VERIFIED" | "FAILED") => <Pill tone={LEGACY_TONE[value]}>{LEGACY_LABEL[value]}</Pill>;
  return (
    <TableWrap>
      <Table>
        <thead>
          <tr>
            <Th>When</Th>
            <Th>Trigger</Th>
            <Th>Ownership</Th>
            <Th>MX</Th>
            <Th>SPF</Th>
            <Th>DKIM</Th>
            <Th>DMARC</Th>
            <Th>Resolver errors</Th>
          </tr>
        </thead>
        <tbody>
          {checks.map((check) => (
            <tr key={check.id}>
              <Td mono muted nowrap>{relativeTime(check.checkedAt)}</Td>
              <Td muted nowrap>{check.trigger === "SCHEDULED" ? "Automatic" : check.trigger === "MANUAL" ? "Re-check" : check.trigger.toLowerCase().replace("_", " ")}</Td>
              <Td>{pill(check.verificationStatus === "VERIFIED" ? "VERIFIED" : check.verificationStatus === "PENDING" ? "PENDING" : "FAILED")}</Td>
              <Td>{pill(check.mxStatus)}</Td>
              <Td>{pill(check.spfStatus)}</Td>
              <Td>{pill(check.dkimStatus)}</Td>
              <Td>{pill(check.dmarcStatus)}</Td>
              <Td muted>{checkErrors(check).join(" · ") || "—"}</Td>
            </tr>
          ))}
        </tbody>
      </Table>
    </TableWrap>
  );
}
