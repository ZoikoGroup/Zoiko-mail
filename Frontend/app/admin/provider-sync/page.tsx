"use client";

import { useConnectors, useReplayDeadLetter, useSyncErrors } from "@/lib/admin-hooks";
import { useCan } from "@/lib/admin-capabilities";
import {
  Card,
  InlineEmpty,
  InlineError,
  LoadingRows,
  PageHeader,
  Notice,
  Pill,
  Row,
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
  const replay = useReplayDeadLetter();

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

      <Card title="Connections">
        {error ? (
          <InlineError message={error.message} />
        ) : isLoading || !connectors ? (
          <LoadingRows rows={4} />
        ) : connectors.length === 0 ? (
          <InlineEmpty title="No connectors" hint="Members connect their own inbox." />
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

      {replay.error ? (
        <Notice tone="warn">Could not replay that event. {replay.error.message}</Notice>
      ) : null}

      <Card
        title="Recent sync errors"
        badge={
          syncErrors && syncErrors.length > 0 ? (
            <Pill tone="crit">{syncErrors.length}</Pill>
          ) : undefined
        }
      >
        {!syncErrors || syncErrors.length === 0 ? (
          <InlineEmpty title="No sync errors" hint="Every connector reported success on its last run." />
        ) : (
          syncErrors.map((item) => (
            <Row
              key={item.id}
              title={item.title}
              detail={item.detail}
              right={
                <>
                  <span className="font-mono-num text-[10.5px] text-[var(--ink3)]">{item.ago}</span>
                  {/* Replay re-queues a dead-lettered provider event. Dead-letter
                      is where an event lands after its retry budget is spent, so
                      without this a transient provider failure is permanent and
                      the mail that event carried never arrives. */}
                  <button
                    type="button"
                    className="zoiko-btn sm"
                    disabled={!can("workspace.settings.write") || replay.isPending}
                    title={
                      can("workspace.settings.write")
                        ? undefined
                        : "Replaying a provider event needs workspace.settings.write"
                    }
                    onClick={() => replay.mutate(item.id)}
                  >
                    {replay.isPending && replay.variables === item.id ? "Replaying…" : item.action}
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
