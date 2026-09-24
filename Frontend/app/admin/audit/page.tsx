"use client";

import { useMemo, useState } from "react";
import { useAuditEvents, useExportAuditEvents } from "@/lib/admin-hooks";
import type { AuditQuery } from "@/lib/admin-queries";
import type { AuditEventDto } from "@/lib/admin-api";
import {
  Card,
  InlineEmpty,
  InlineError,
  FilterChips,
  LoadingRows,
  Notice,
  PageHeader,
  Pill,
  RequireCapability,
  Row,
  type Tone,
} from "@/components/admin/ui";

/**
 * Categories, as prefixes the server filters on.
 *
 * This screen used to offer Admin / Support / AI / System / Identity and
 * decide them in the browser from an `actorType` the mapper can only ever set
 * to "user" or "system" — so Admin and Support matched nothing at all, in any
 * workspace, and the rest matched only within whichever 50 rows had been
 * fetched. Categories are now sets of real event-type prefixes, sent to the
 * server, so they search the whole log and mean what they say.
 */
const CATEGORIES: Array<{ label: string; prefixes: string[] }> = [
  { label: "All events", prefixes: [] },
  { label: "Identity", prefixes: ["LOGIN_", "SIGNED_IN", "SESSION_", "PASSWORD_", "MFA_"] },
  { label: "People & access", prefixes: ["MEMBERSHIP_", "USER_", "SUPPORT_"] },
  { label: "Mail", prefixes: ["MAIL_", "MAILBOX_", "SHARED_", "RECIPIENT_", "IMAP_"] },
  { label: "AI", prefixes: ["AI_", "COMMITMENT_"] },
  { label: "Connectors", prefixes: ["CONNECTED_", "PROVIDER_", "DOMAIN_"] },
  { label: "Data & lifecycle", prefixes: ["DATA_", "RETENTION_", "TENANT_", "AUDIT_"] },
  { label: "Billing", prefixes: ["BILLING_", "SUBSCRIPTION_", "INVOICE_", "PLAN_"] },
];

/**
 * Who acted, as opposed to what happened — Audit §6.2's actor_type.
 *
 * These chips existed before and could not work: they tested an actorType the
 * mapper derived from "has an actor or not", so Admin and Support matched
 * nothing in any workspace. The column exists now, and the filter is applied
 * by the server, so they search the whole log rather than one page.
 */
const ACTORS: Array<{ label: string; value: AuditQuery["actorType"] }> = [
  { label: "Anyone", value: undefined },
  { label: "Admin", value: "ADMIN" },
  { label: "Member", value: "USER" },
  { label: "Support", value: "SUPPORT" },
  { label: "AI worker", value: "AI_WORKER" },
  { label: "Provider", value: "PROVIDER" },
  { label: "System", value: "SYSTEM" },
];

const PAGE_SIZE = 25;

/** Actor type is what separates a human action from the system's own. */
const ACTOR_TONE: Record<AuditEventDto["actorType"], Tone> = {
  admin: "ai",
  user: "nu",
  support: "warn",
  system: "nu",
  ai_worker: "ai",
  provider: "nu",
};

/** A date input gives a day; the API wants an instant. */
function startOfDay(value: string): string | undefined {
  return value ? new Date(`${value}T00:00:00.000Z`).toISOString() : undefined;
}
function endOfDay(value: string): string | undefined {
  return value ? new Date(`${value}T23:59:59.999Z`).toISOString() : undefined;
}

/**
 * The rail hides this link without `audit.read`, but hiding a link is not
 * access control: the URL can be typed and a bookmark survives a demotion.
 * The API refuses the reads regardless; this makes the refusal a sentence
 * instead of a screen of failed requests.
 */
export default function AdminAuditPage() {
  return (
    <RequireCapability capability="audit.read">
      <AuditLog />
    </RequireCapability>
  );
}

function AuditLog() {
  const [category, setCategory] = useState<string>(CATEGORIES[0]!.label);
  const [actor, setActor] = useState<string>(ACTORS[0]!.label);
  const [fromDay, setFromDay] = useState("");
  const [toDay, setToDay] = useState("");
  /**
   * The cursors that opened each page, newest last.
   *
   * Keyset walks forward from a key and cannot address "page 7", so Previous
   * works by popping the cursor we arrived on. Empty is the first page, which
   * needs no cursor.
   */
  const [cursors, setCursors] = useState<string[]>([]);
  const cursor = cursors[cursors.length - 1];

  const filters = useMemo<AuditQuery>(() => {
    const prefixes = CATEGORIES.find((c) => c.label === category)?.prefixes ?? [];
    return {
      eventTypePrefix: prefixes.length ? prefixes : undefined,
      actorType: ACTORS.find((a) => a.label === actor)?.value,
      from: startOfDay(fromDay),
      to: endOfDay(toDay),
    };
  }, [category, actor, fromDay, toDay]);

  const { data, isLoading, error } = useAuditEvents({ ...filters, cursor, limit: PAGE_SIZE });
  const exporter = useExportAuditEvents();

  const events = data?.events ?? [];
  const pagination = data?.pagination;
  const nextCursor = pagination?.nextCursor ?? null;
  // The server refuses a range that ends before it starts, so say so here
  // rather than sending it and rendering the rejection as a failed read.
  const rangeInverted = Boolean(fromDay && toDay && fromDay > toDay);

  /** Any filter change restarts at page one; page 7 of a new filter is meaningless. */
  const reset = <T,>(set: (value: T) => void) => (value: T) => {
    set(value);
    setCursors([]);
  };

  return (
    <>
      <PageHeader
        title="Audit logs"
        subtitle="Append-only record of admin, AI and support actions"
        action={
          <button
            type="button"
            className="zoiko-btn"
            disabled={exporter.isPending || rangeInverted}
            onClick={() => exporter.mutate(filters)}
            title="Downloads every event matching these filters, not just this page"
          >
            {exporter.isPending ? "Preparing…" : "Export CSV"}
          </button>
        }
      />

      <Notice tone="info">
        <b className="text-[var(--ai)]">Append-only.</b> Rows are never updated or deleted,
        including by Zoiko — a correction is recorded as a compensating event. Failed
        attempts against addresses with no account are recorded too, which is how
        enumeration becomes visible.
      </Notice>

      {error ? <InlineError message={error.message} /> : null}
      {exporter.error ? (
        <Notice tone="warn">Could not export the log. {exporter.error.message}</Notice>
      ) : null}

      <FilterChips
        options={CATEGORIES.map((c) => c.label)}
        active={category}
        onChange={reset(setCategory)}
      />

      <FilterChips
        options={ACTORS.map((a) => a.label)}
        active={actor}
        onChange={reset(setActor)}
      />

      <div className="mb-3.5 flex flex-wrap items-end gap-3">
        <DayField label="From" value={fromDay} onChange={reset(setFromDay)} />
        <DayField label="To" value={toDay} onChange={reset(setToDay)} />
        {(fromDay || toDay) && (
          <button
            type="button"
            className="zoiko-btn sm"
            onClick={() => {
              setFromDay("");
              setToDay("");
              setCursors([]);
            }}
          >
            Clear dates
          </button>
        )}
        {rangeInverted && (
          <span className="text-[11.5px] text-[var(--crit)]">
            The end date is before the start date.
          </span>
        )}
      </div>

      <Card
        title="Events"
        badge={
          pagination ? (
            <Pill tone="nu">
              {pagination.total === 0
                ? "No events"
                : `${pagination.total} event${pagination.total === 1 ? "" : "s"}`}
            </Pill>
          ) : undefined
        }
      >
        {isLoading && !data ? (
          <LoadingRows rows={8} />
        ) : events.length === 0 ? (
          <InlineEmpty
            title="No events match these filters"
            hint="Try a different category, or widen the dates."
          />
        ) : (
          events.map((event) => (
            <Row
              key={event.id}
              title={event.eventType}
              detail={`${event.actorName} · ${event.targetLabel}`}
              right={
                <>
                  <Pill tone={ACTOR_TONE[event.actorType]}>
                    {event.actorType.replace("_", " ")}
                  </Pill>
                  <span className="font-mono-num text-[10.5px] text-[var(--ink3)]">
                    {event.createdAtLabel}
                  </span>
                </>
              }
            />
          ))
        )}
      </Card>

      {pagination && pagination.total > 0 && (
        <div className="flex items-center justify-between gap-3 px-1 py-2">
          <span className="font-mono-num text-[11px] text-[var(--ink3)]">
            {/* No "of N". Keyset knows there is a next page, not how many
                remain, and deriving one from total/limit would be wrong the
                moment an event is written mid-read — constantly, here. */}
            Page {cursors.length + 1}
          </span>
          <div className="flex gap-2">
            <button
              type="button"
              className="zoiko-btn sm"
              disabled={cursors.length === 0}
              onClick={() => setCursors((stack) => stack.slice(0, -1))}
            >
              Previous
            </button>
            <button
              type="button"
              className="zoiko-btn sm"
              disabled={!nextCursor}
              onClick={() => nextCursor && setCursors((stack) => [...stack, nextCursor])}
            >
              Next
            </button>
          </div>
        </div>
      )}
    </>
  );
}

function DayField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  const id = `audit-${label.toLowerCase()}`;
  return (
    <div>
      <label
        htmlFor={id}
        className="font-mono-num mb-1 block text-[9.5px] uppercase tracking-[0.1em] text-[var(--ink3)]"
      >
        {label}
      </label>
      <input
        id={id}
        type="date"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="rounded-lg border border-[var(--border)] bg-[var(--s2)] px-3 py-2 text-[12.6px] text-[var(--ink)]"
      />
    </div>
  );
}
