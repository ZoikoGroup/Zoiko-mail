"use client";

import { useState } from "react";
import {
  useActivateDomain,
  useAddDomain,
  useDomainChecks,
  useDomains,
  useRecheckDomain,
  useRemoveDomain,
} from "@/lib/admin-hooks";
import { useCan } from "@/lib/admin-capabilities";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import type { DnsRecordDto, DomainCheckDto, DomainDto } from "@/lib/admin-api";
import {
  Card,
  InlineEmpty,
  InlineError,
  LoadingRows,
  Notice,
  PageHeader,
  Pill,
  Row,
  Table,
  TableWrap,
  Td,
  Th,
  type Tone,
} from "@/components/admin/ui";

const DNS_TONE: Record<DnsRecordDto["status"], Tone> = {
  VALID: "ok",
  INVALID: "crit",
  PENDING: "warn",
};

/** Something plausible enough to be worth sending to the server. */
const DOMAIN_PATTERN = /^(?=.{1,253}$)(?!-)(?:[a-z0-9-]+\.)+[a-z]{2,63}$/;

export default function AdminDomainsPage() {
  const can = useCan();
  const { data: domains, isLoading, error } = useDomains();
  const canManage = can("workspace.domains.manage");

  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [nameError, setNameError] = useState<string | null>(null);
  const add = useAddDomain();

  const submit = () => {
    const candidate = name.trim().toLowerCase();
    setNameError(null);
    if (!DOMAIN_PATTERN.test(candidate)) {
      // The server applies the same rule; checking here means a typo is a
      // message under the field rather than a failed request.
      setNameError("Enter a domain like acme.com — no scheme, no path.");
      return;
    }
    add.mutate(candidate, {
      onSuccess: () => {
        setName("");
        setAdding(false);
      },
    });
  };

  return (
    <>
      <PageHeader
        title="Domains"
        subtitle="Custom-domain verification and deliverability"
        action={
          canManage ? (
            <button
              type="button"
              className="zoiko-btn pri"
              onClick={() => setAdding((open) => !open)}
            >
              {adding ? "Cancel" : "Add domain"}
            </button>
          ) : undefined
        }
      />

      {adding && (
        <Card title="Add a domain" padded>
          <div className="max-w-[440px]">
            <label
              htmlFor="domain-name"
              className="font-mono-num mb-1 block text-[9.5px] uppercase tracking-[0.1em] text-[var(--ink3)]"
            >
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
              className="w-full rounded-lg border border-[var(--border)] bg-[var(--s2)] px-3 py-2 text-[12.6px] text-[var(--ink)] placeholder:text-[var(--ink3)]"
            />
            {nameError && (
              <p className="mt-1.5 text-[11.5px] text-[var(--crit)]">{nameError}</p>
            )}
            {add.error && (
              <p className="mt-1.5 text-[11.5px] text-[var(--crit)]">{add.error.message}</p>
            )}
            <p className="mt-2 text-[11.5px] text-[var(--ink3)]">
              Adding it issues an ownership token. Nothing sends from the domain until the
              DNS checks pass.
            </p>
            <button
              type="button"
              className="zoiko-btn pri sm mt-3"
              disabled={add.isPending}
              onClick={submit}
            >
              {add.isPending ? "Adding…" : "Add domain"}
            </button>
          </div>
        </Card>
      )}

      {error ? (
        <Card>
          <InlineError message={error.message} />
        </Card>
      ) : isLoading || !domains ? (
        <Card>
          <LoadingRows rows={4} />
        </Card>
      ) : domains.length === 0 ? (
        <Card>
          <InlineEmpty title="No domains yet" hint="Add a domain to send from your own address." />
        </Card>
      ) : (
        domains.map((domain) => (
          <DomainBlock key={domain.id} domain={domain} canManage={canManage} />
        ))
      )}
    </>
  );
}

function DomainBlock({ domain, canManage }: { domain: DomainDto; canManage: boolean }) {
  const recheck = useRecheckDomain();
  const activate = useActivateDomain();
  const remove = useRemoveDomain();
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [showHistory, setShowHistory] = useState(false);

  const status = (value: DnsRecordDto["status"]) =>
    value === "VALID" ? "Pass" : value === "PENDING" ? "Pending" : "Fail";
  const tone = (value: DnsRecordDto["status"]) => DNS_TONE[value];

  // The same four the server insists on before it will enable sending. Checked
  // here only to decide what to offer — the refusal itself is the server's,
  // and it comes back naming whichever check failed.
  const readyToSend =
    domain.verificationStatus === "VERIFIED" &&
    domain.spfStatus === "VALID" &&
    domain.dkimStatus === "VALID" &&
    domain.dmarcStatus === "VALID";

  const busy = recheck.isPending || activate.isPending || remove.isPending;
  const failure = recheck.error ?? activate.error ?? remove.error;

  return (
    <>
      <Card
        title={domain.domainName}
        badge={
          domain.type === "ZOIKO" ? (
            <Pill tone="accent">Zoiko-owned</Pill>
          ) : domain.sendingEnabled ? (
            <Pill tone="ok">Sending</Pill>
          ) : (
            <Pill tone={domain.verificationStatus === "VERIFIED" ? "ok" : "warn"}>
              {domain.verificationStatus === "VERIFIED" ? "Verified" : "Pending"}
            </Pill>
          )
        }
        action={
          <div className="flex items-center gap-2">
            <span className="font-mono-num text-[10.5px] text-[var(--ink3)]">
              checked {domain.lastCheckedAt}
            </span>
            {canManage && domain.type === "CUSTOM" && (
              <>
                <button
                  type="button"
                  className="zoiko-btn sm"
                  disabled={busy}
                  onClick={() => recheck.mutate(domain.id)}
                >
                  {recheck.isPending ? "Checking…" : "Re-check now"}
                </button>
                {!domain.sendingEnabled && (
                  <button
                    type="button"
                    className="zoiko-btn pri sm"
                    disabled={busy || !readyToSend}
                    title={
                      readyToSend
                        ? undefined
                        : "Ownership, SPF, DKIM and DMARC must all pass first"
                    }
                    onClick={() => activate.mutate(domain.id)}
                  >
                    {activate.isPending ? "Enabling…" : "Enable sending"}
                  </button>
                )}
                <button
                  type="button"
                  className="zoiko-btn sm"
                  onClick={() => setShowHistory((open) => !open)}
                >
                  {showHistory ? "Hide history" : "History"}
                </button>
                <button
                  type="button"
                  className="zoiko-btn crit sm"
                  disabled={busy || domain.sendingEnabled}
                  title={
                    domain.sendingEnabled
                      ? "Turn off sending before removing the domain"
                      : undefined
                  }
                  onClick={() => setConfirmRemove(true)}
                >
                  Remove
                </button>
              </>
            )}
          </div>
        }
      >
        {failure && <Notice tone="warn">{failure.message}</Notice>}

        <Row title="MX records" detail="Inbound routing" right={<Pill tone={tone(domain.mxStatus)}>{status(domain.mxStatus)}</Pill>} />
        <Row title="SPF" detail="Authorises sending infrastructure" right={<Pill tone={tone(domain.spfStatus)}>{status(domain.spfStatus)}</Pill>} />
        <Row title="DKIM" detail="Cryptographic message signing" right={<Pill tone={tone(domain.dkimStatus)}>{status(domain.dkimStatus)}</Pill>} />
        <Row title="DMARC" detail="Policy over SPF and DKIM alignment" right={<Pill tone={tone(domain.dmarcStatus)}>{status(domain.dmarcStatus)}</Pill>} />
        {domain.warmupNote && (
          <Row title="Warm-up ladder" detail={domain.warmupNote} right={<Pill tone="warn">Capped</Pill>} />
        )}
      </Card>

      {showHistory && <CheckHistory domainId={domain.id} />}

      {/* Status alone is not actionable — support needs the exact records to
          hand a customer. PRD §13.2 and the DNS runbook both require this. */}
      {domain.records.length > 0 && (
        <Card
          title="Required DNS records"
          badge={<Pill tone="accent">{`${domain.records.length} records`}</Pill>}
        >
          <TableWrap>
            <Table>
              <thead>
                <tr>
                  <Th>Type</Th>
                  <Th>Host</Th>
                  <Th>Value</Th>
                  <Th>Purpose</Th>
                  <Th>Status</Th>
                  <Th srOnly>Copy</Th>
                </tr>
              </thead>
              <tbody>
                {domain.records.map((record) => (
                  <tr key={`${record.type}-${record.host}-${record.value}`}>
                    <Td nowrap>
                      <span className="font-semibold text-[var(--ink)]">{record.type}</span>
                    </Td>
                    <Td mono nowrap>{record.host}</Td>
                    <Td mono>
                      <span className="break-all">{record.value}</span>
                    </Td>
                    <Td muted>{record.purpose}</Td>
                    <Td>
                      <Pill tone={tone(record.status)}>{status(record.status)}</Pill>
                    </Td>
                    <Td nowrap>
                      <button
                        type="button"
                        className="zoiko-btn sm"
                        onClick={() => navigator.clipboard?.writeText(record.value)}
                      >
                        Copy
                      </button>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </TableWrap>
        </Card>
      )}

      {domain.type === "CUSTOM" && domain.verificationStatus !== "VERIFIED" && (
        <Notice tone="warn">
          <b className="text-[var(--warn)]">Sending stays disabled until verification passes.</b> Add
          the TXT record above, then re-check — DNS changes can take up to an hour to propagate.
        </Notice>
      )}

      <ConfirmDialog
        open={confirmRemove}
        onClose={() => setConfirmRemove(false)}
        onConfirm={() =>
          remove.mutate(domain.id, { onSuccess: () => setConfirmRemove(false) })
        }
        title={`Remove ${domain.domainName}?`}
        message="The domain and its check history are deleted. Mailboxes on this domain stop resolving, and adding it back issues a new ownership token that has to be published again."
        confirmLabel="Remove domain"
        loading={remove.isPending}
      />
    </>
  );
}

/**
 * What the previous checks said.
 *
 * The domain row carries only the latest result, which answers "is it failing"
 * and not "since when" — and that distinction is what separates DNS that has
 * not propagated yet from a record that was never published.
 */
function CheckHistory({ domainId }: { domainId: string }) {
  const { data: checks, isLoading, error } = useDomainChecks(domainId);

  const label = (value: DnsRecordDto["status"] | DomainCheckDto["verificationStatus"]) =>
    value === "VALID" || value === "VERIFIED" ? "Pass" : value === "PENDING" ? "Pending" : "Fail";
  const tone = (value: DnsRecordDto["status"] | DomainCheckDto["verificationStatus"]) =>
    value === "VALID" || value === "VERIFIED" ? "ok" : value === "PENDING" ? "warn" : "crit";

  return (
    <Card title="Check history" badge={checks ? <Pill tone="nu">{`${checks.length}`}</Pill> : undefined}>
      {error ? (
        <InlineError message={error.message} />
      ) : isLoading || !checks ? (
        <LoadingRows rows={3} />
      ) : checks.length === 0 ? (
        <InlineEmpty
          title="No checks recorded yet"
          hint="Re-check now runs one and records the result here."
        />
      ) : (
        <TableWrap>
          <Table>
            <thead>
              <tr>
                <Th>When</Th>
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
                  <Td mono muted nowrap>{check.checkedAt}</Td>
                  <Td><Pill tone={tone(check.verificationStatus)}>{label(check.verificationStatus)}</Pill></Td>
                  <Td><Pill tone={tone(check.mxStatus)}>{label(check.mxStatus)}</Pill></Td>
                  <Td><Pill tone={tone(check.spfStatus)}>{label(check.spfStatus)}</Pill></Td>
                  <Td><Pill tone={tone(check.dkimStatus)}>{label(check.dkimStatus)}</Pill></Td>
                  <Td><Pill tone={tone(check.dmarcStatus)}>{label(check.dmarcStatus)}</Pill></Td>
                  <Td muted>
                    {check.errors.length === 0 ? "—" : check.errors.join(" · ")}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </TableWrap>
      )}
    </Card>
  );
}
