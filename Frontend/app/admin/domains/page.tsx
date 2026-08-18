"use client";

import { useDomains } from "@/lib/admin-hooks";
import type { DnsRecordDto, DomainDto } from "@/lib/admin-api";
import {
  Card,
  EmptyState,
  ErrorState,
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

export default function AdminDomainsPage() {
  const { data: domains, isLoading, error } = useDomains();

  return (
    <>
      <PageHeader title="Domains" subtitle="Custom-domain verification and deliverability" />

      {error ? (
        <Card>
          <ErrorState message={error.message} />
        </Card>
      ) : isLoading || !domains ? (
        <Card>
          <LoadingRows rows={4} />
        </Card>
      ) : domains.length === 0 ? (
        <Card>
          <EmptyState title="No domains yet" hint="Add a domain to send from your own address." />
        </Card>
      ) : (
        domains.map((domain) => <DomainBlock key={domain.id} domain={domain} />)
      )}
    </>
  );
}

function DomainBlock({ domain }: { domain: DomainDto }) {
  const status = (value: DnsRecordDto["status"]) =>
    value === "VALID" ? "Pass" : value === "PENDING" ? "Pending" : "Fail";
  const tone = (value: DnsRecordDto["status"]) => DNS_TONE[value];

  return (
    <>
      <Card
        title={domain.domainName}
        badge={
          domain.type === "ZOIKO" ? (
            <Pill tone="accent">Zoiko-owned</Pill>
          ) : (
            <Pill tone={domain.verificationStatus === "VERIFIED" ? "ok" : "warn"}>
              {domain.verificationStatus === "VERIFIED" ? "Verified" : "Pending"}
            </Pill>
          )
        }
        action={
          <span className="font-mono-num text-[10.5px] text-[var(--ink3)]">
            checked {domain.lastCheckedAt}
          </span>
        }
      >
        <Row title="MX records" detail="Inbound routing" right={<Pill tone={tone(domain.mxStatus)}>{status(domain.mxStatus)}</Pill>} />
        <Row title="SPF" detail="Authorises sending infrastructure" right={<Pill tone={tone(domain.spfStatus)}>{status(domain.spfStatus)}</Pill>} />
        <Row title="DKIM" detail="Cryptographic message signing" right={<Pill tone={tone(domain.dkimStatus)}>{status(domain.dkimStatus)}</Pill>} />
        <Row title="DMARC" detail="Policy over SPF and DKIM alignment" right={<Pill tone={tone(domain.dmarcStatus)}>{status(domain.dmarcStatus)}</Pill>} />
        {domain.warmupNote && (
          <Row title="Warm-up ladder" detail={domain.warmupNote} right={<Pill tone="warn">Capped</Pill>} />
        )}
      </Card>

      {/* Status alone is not actionable — support needs the exact records to
          hand a customer. PRD §13.2 and the DNS runbook both require this. */}
      {domain.records.length > 0 && (
        <Card
          title="Required DNS records"
          badge={<Pill tone="accent">{`${domain.records.length} records`}</Pill>}
          action={<button type="button" className="zoiko-btn sm">Re-check now</button>}
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
    </>
  );
}
