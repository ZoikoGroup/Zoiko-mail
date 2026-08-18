"use client";

import { useMemo, useState } from "react";
import { useAuditEvents } from "@/lib/admin/hooks";
import type { AuditEventDto } from "@/lib/admin/fixtures";
import {
  Card,
  EmptyState,
  ErrorState,
  FilterChips,
  LoadingRows,
  Notice,
  PageHeader,
  Pill,
  Row,
  StaticNote,
  type Tone,
} from "@/components/admin/ui";

const FILTERS = ["All events", "Admin", "Support", "System", "AI", "Identity"] as const;

/** Actor type is what separates a human admin action from an AI worker's. */
const ACTOR_TONE: Record<AuditEventDto["actorType"], Tone> = {
  admin: "ai",
  user: "nu",
  support: "warn",
  system: "nu",
  ai_worker: "ai",
};

function matchesFilter(event: AuditEventDto, filter: string): boolean {
  if (filter === "All events") return true;
  if (filter === "Admin") return event.actorType === "admin";
  if (filter === "Support") return event.actorType === "support";
  if (filter === "AI") return event.actorType === "ai_worker" || event.eventType.startsWith("AI");
  if (filter === "System") return event.actorType === "system";
  if (filter === "Identity") return /sign-in|login|MFA|password/i.test(event.eventType);
  return true;
}

export default function AdminAuditPage() {
  const { data: events, isLoading, error } = useAuditEvents();
  const [filter, setFilter] = useState<string>(FILTERS[0]);

  const visible = useMemo(
    () => events?.filter((event) => matchesFilter(event, filter)) ?? [],
    [events, filter]
  );

  return (
    <>
      <PageHeader
        title="Audit logs"
        subtitle="Append-only record of admin, AI and support actions"
        action={<button type="button" className="zoiko-btn">Export</button>}
      />

      <StaticNote>
        Backend is complete — GET /audit/events; no create, update or delete endpoint exists
      </StaticNote>

      <Notice tone="info">
        <b className="text-[var(--ai)]">Append-only.</b> Rows are never updated or deleted, including
        by Zoiko — a correction is recorded as a compensating event. Failed attempts against
        addresses with no account are recorded too, which is how enumeration becomes visible.
      </Notice>

      <FilterChips options={[...FILTERS]} active={filter} onChange={setFilter} />

      <Card
        title="Events"
        badge={events ? <Pill tone="nu">{`${visible.length} of ${events.length}`}</Pill> : undefined}
      >
        {error ? (
          <ErrorState message={error.message} />
        ) : isLoading || !events ? (
          <LoadingRows rows={8} />
        ) : visible.length === 0 ? (
          <EmptyState
            title="No events match this filter"
            hint="Try a different actor, or clear the filter."
          />
        ) : (
          visible.map((event) => (
            <Row
              key={event.id}
              title={event.eventType}
              detail={`${event.actorName} · ${event.targetLabel}`}
              right={
                <>
                  <Pill tone={ACTOR_TONE[event.actorType]}>{event.actorType.replace("_", " ")}</Pill>
                  <span className="font-mono-num text-[10.5px] text-[var(--ink3)]">
                    {event.createdAtLabel}
                  </span>
                </>
              }
            />
          ))
        )}
      </Card>
    </>
  );
}
