"use client";

import { useState } from "react";

import {
  useConnectors,
  useDisconnectConnector,
  useReplayDeadLetter,
  useRotateConnector,
  useSyncErrors,
} from "@/lib/admin-hooks";
import { useCan } from "@/lib/admin-capabilities";
import { StepUpDialog, useStepUp } from "@/components/admin/StepUpDialog";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
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
import type { ConnectorDto } from "@/lib/admin-api";

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
  const rotate = useRotateConnector();
  const disconnect = useDisconnectConnector();
  const stepUp = useStepUp();

  // Which account the disconnect confirmation is about. Held as the row
  // rather than an id so the dialog can name the address it is about to cut
  // off — "Disconnect this account?" is not a question anyone can answer.
  const [disconnecting, setDisconnecting] = useState<ConnectorDto | null>(null);

  const canRotate = can("connector.credentials.rotate");
  const canDisconnect = can("connector.tenant.disconnect");

  return (
    <>
      <StepUpDialog {...stepUp.dialog} />

      <ConfirmDialog
        open={disconnecting !== null}
        onClose={() => setDisconnecting(null)}
        onConfirm={() => {
          const target = disconnecting;
          setDisconnecting(null);
          if (target) disconnect.mutate(target.id);
        }}
        title={`Disconnect ${disconnecting?.detail ?? "this account"}?`}
        message="Sync stops and the provider's access is revoked. Mail already pulled into Zoiko stays; nothing new arrives from this account until its owner reconnects it themselves — you cannot reconnect it for them."
        confirmLabel="Disconnect"
        loading={disconnect.isPending}
      />

      <PageHeader
        title="Provider sync"
        subtitle="Connector and hosted-mail provider health"
        action={
          <span className="font-mono-num text-[10.5px] text-[var(--ink3)]">
            provider IDs are secondary references only
          </span>
        }
      />

      {rotate.error ? (
        <Notice tone="warn">
          Could not rotate that credential. {rotate.error.message}
        </Notice>
      ) : null}
      {rotate.isSuccess ? (
        <Notice tone="ok">
          Credential rotated. The account holds a fresh token; nothing else changed.
        </Notice>
      ) : null}
      {disconnect.error ? (
        <Notice tone="warn">
          Could not disconnect that account. {disconnect.error.message}
        </Notice>
      ) : null}

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
            const busy =
              (rotate.isPending && rotate.variables?.accountId === connector.id) ||
              (disconnect.isPending && disconnect.variables === connector.id);
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

                    {/*
                      Rotation exchanges the stored refresh token for a new
                      access token. Until this existed the machinery ran only
                      as a side effect of a sync that happened to find an
                      expired token, so an operator who suspected a leaked
                      credential had no way to act on the suspicion.

                      Step-up per §5 — the server refuses without a fresh
                      token and `useStepUp` turns that refusal into a prompt.
                    */}
                    <button
                      type="button"
                      className="zoiko-btn sm"
                      disabled={!canRotate || busy}
                      title={
                        canRotate
                          ? "Exchange this account's refresh token for a new access token"
                          : "Rotating a provider credential needs connector.credentials.rotate"
                      }
                      onClick={() =>
                        void stepUp.attempt(
                          `Rotating the credential for ${connector.detail}`,
                          (stepUpToken) =>
                            rotate.mutateAsync({ accountId: connector.id, stepUpToken })
                        )
                      }
                    >
                      {rotate.isPending && rotate.variables?.accountId === connector.id
                        ? "Rotating…"
                        : "Rotate"}
                    </button>

                    {/*
                      The tenant-scope disconnect. `DELETE /connectors/:id`
                      looks like it would do this and does not — it scopes by
                      membershipId, so it only ever reaches your own account.
                      An admin surface needs the route that can reach anyone's.
                    */}
                    <button
                      type="button"
                      className="zoiko-btn sm"
                      disabled={!canDisconnect || busy}
                      title={
                        canDisconnect
                          ? "Revoke this account's provider access and stop its sync"
                          : "Disconnecting someone else's account needs connector.tenant.disconnect"
                      }
                      onClick={() => setDisconnecting(connector)}
                    >
                      {disconnect.isPending && disconnect.variables === connector.id
                        ? "Disconnecting…"
                        : "Disconnect"}
                    </button>
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
