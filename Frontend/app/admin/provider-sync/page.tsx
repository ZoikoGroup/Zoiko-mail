"use client";

import { useConnectors, useSyncErrors } from "@/lib/admin/hooks";
import { useCan } from "@/lib/admin/capabilities";
import {
  Card,
  EmptyState,
  ErrorState,
  LoadingRows,
  PageHeader,
  Pill,
  Row,
  StaticNote,
  type Tone,
} from "@/components/admin/ui";

const STATUS: Record<string, { label: string; tone: Tone }> = {
  ACTIVE: { label: "OK", tone: "ok" },
  REAUTH_REQUIRED: { label: "Re-auth", tone: "crit" },
  IDLE: { label: "Idle", tone: "nu" },
};

export default function AdminProviderSyncPage() {
  const can = useCan();
  const { data: connectors, isLoading, error } = useConnectors();
  const { data: syncErrors } = useSyncErrors();

  return (
    <>
      <PageHeader
        title="Provider sync"
        subtitle="Connector and hosted-mail provider health"
        action={
          <span className="font-mono-num text-[10.5px] text-[var(--ink3)]">
            provider IDs are secondary references only
          </span>
        }
      />

      <StaticNote>
        Backend is complete — GET /connectors/health and /connectors/dead-letter
      </StaticNote>

      <Card title="Connections">
        {error ? (
          <ErrorState message={error.message} />
        ) : isLoading || !connectors ? (
          <LoadingRows rows={4} />
        ) : connectors.length === 0 ? (
          <EmptyState title="No connectors" hint="Members connect their own inbox." />
        ) : (
          connectors.map((connector) => {
            const status = STATUS[connector.status] ?? STATUS.IDLE;
            return (
              <Row
                key={connector.id}
                title={connector.name}
                detail={connector.detail}
                right={
                  <>
                    <span className="font-mono-num text-[10.5px] text-[var(--ink3)]">
                      {connector.syncLabel}
                    </span>
                    <Pill tone={status.tone}>{status.label}</Pill>
                  </>
                }
              />
            );
          })
        )}
      </Card>

      <Card
        title="Recent sync errors"
        badge={
          syncErrors && syncErrors.length > 0 ? (
            <Pill tone="crit">{syncErrors.length}</Pill>
          ) : undefined
        }
      >
        {!syncErrors || syncErrors.length === 0 ? (
          <EmptyState title="No sync errors" hint="Every connector reported success on its last run." />
        ) : (
          syncErrors.map((item) => (
            <Row
              key={item.id}
              title={item.title}
              detail={item.detail}
              right={
                <>
                  <span className="font-mono-num text-[10.5px] text-[var(--ink3)]">{item.ago}</span>
                  {/* Re-auth needs the member's own OAuth consent, so this hands
                      off rather than attempting it on their behalf. */}
                  <button
                    type="button"
                    className="zoiko-btn sm"
                    disabled={!can("workspace.settings.write")}
                  >
                    {item.action}
                  </button>
                </>
              }
            />
          ))
        )}
      </Card>
    </>
  );
}
