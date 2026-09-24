"use client";

import { useState } from "react";

import {
  useDownloadExport,
  useLifecycleRequests,
  useRequestDeletion,
  useRequestExport,
} from "@/lib/admin-hooks";
import { useCan } from "@/lib/admin-capabilities";
import { StepUpDialog, useStepUp } from "@/components/admin/StepUpDialog";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import {
  Card,
  InlineEmpty,
  InlineError,
  LoadingRows,
  Notice,
  PageHeader,
  Pill,
  Row,
  type Tone,
} from "@/components/admin/ui";

/**
 * Export and deletion — PRD §16 "Export/deletion", RBAC §2.
 *
 * This screen did not exist because the endpoint behind it refused an Admin
 * before it read anything: the lifecycle router was `requireRole("OWNER")` for
 * its whole surface, so `data.export` sat in the Admin matrix row resolving
 * perfectly to a route that had already said no. Nobody builds a screen for a
 * guaranteed 403.
 *
 * Requesting is not deciding. An Admin may raise either request; approving,
 * scheduling and confirming a deletion stay with the Owner, which is why there
 * are no buttons for them here.
 */

const STATUS_TONE: Record<string, Tone> = {
  REQUESTED: "nu",
  APPROVED: "ok",
  PROCESSING: "warn",
  COMPLETED: "ok",
  BLOCKED: "crit",
  CANCELLED: "nu",
  FAILED: "crit",
};

export default function AdminDataPage() {
  const can = useCan();
  const { data: requests, isLoading, error } = useLifecycleRequests();
  const exportReq = useRequestExport();
  const deletionReq = useRequestDeletion();
  const download = useDownloadExport();
  const stepUp = useStepUp();

  const [reason, setReason] = useState("");
  const [confirmingDeletion, setConfirmingDeletion] = useState(false);

  const canExport = can("data.export");
  const ready = reason.trim().length >= 10;
  const busy = exportReq.isPending || deletionReq.isPending;

  /**
   * A refusal here has two very different meanings and they must not be
   * flattened. NO_ACTIVE_POLICY is not "you may not" — it is "this workspace
   * has not enabled this for administrators", which an Owner can change and
   * which an Owner never sees, because §2 gives them the unconditional column.
   * Showing a bare "Forbidden" sends an Admin to ask for a permission they
   * already hold.
   */
  const failure = exportReq.error ?? deletionReq.error ?? download.error;

  return (
    <>
      <StepUpDialog {...stepUp.dialog} />

      <ConfirmDialog
        open={confirmingDeletion}
        onClose={() => setConfirmingDeletion(false)}
        onConfirm={() => {
          setConfirmingDeletion(false);
          void stepUp.attempt("Requesting deletion of this workspace", (stepUpToken) =>
            deletionReq.mutateAsync({
              targetType: "TENANT",
              reason: reason.trim(),
              stepUpToken,
            })
          );
        }}
        title="Request deletion of this workspace?"
        message="This raises the request; it does not delete anything. An Owner still has to approve, schedule and confirm it, and the workspace keeps working until they do."
        confirmLabel="Raise the request"
        loading={deletionReq.isPending}
      />

      <PageHeader
        title="Data"
        subtitle="Export and deletion requests for this workspace"
      />

      {failure ? <Notice tone="warn">{failure.message}</Notice> : null}
      {exportReq.isSuccess ? (
        <Notice tone="ok">
          Export requested. It runs in the background; the download appears here when it
          finishes.
        </Notice>
      ) : null}

      <Card title="Raise a request">
        <div className="px-4 py-3">
          <label
            htmlFor="lifecycle-reason"
            className="font-mono-num mb-1 block text-[9.5px] uppercase tracking-[0.1em] text-[var(--ink3)]"
          >
            Why, and who asked
          </label>
          <input
            id="lifecycle-reason"
            value={reason}
            disabled={busy}
            onChange={(event) => setReason(event.target.value)}
            placeholder="Customer requested a copy of their data under DSR-2291"
            className="w-full rounded-lg border border-[var(--border)] bg-[var(--s2)] px-3 py-2 text-[12.6px] text-[var(--ink)] placeholder:text-[var(--ink3)]"
          />
          <p className="mt-1.5 text-[11.5px] text-[var(--ink3)]">
            Recorded on the request and in the audit log. Both actions ask for your
            password again — §5 counts them high-risk.
          </p>

          <div className="mt-3 flex gap-2">
            <button
              type="button"
              className="zoiko-btn pri"
              disabled={!canExport || !ready || busy}
              title={
                canExport
                  ? "Queues a full export of this workspace's data"
                  : "Requesting an export needs data.export"
              }
              onClick={() =>
                void stepUp.attempt("Requesting a data export", (stepUpToken) =>
                  exportReq.mutateAsync({ reason: reason.trim(), stepUpToken })
                )
              }
            >
              {exportReq.isPending ? "Requesting…" : "Request export"}
            </button>

            <button
              type="button"
              className="zoiko-btn crit"
              disabled={!ready || busy}
              onClick={() => setConfirmingDeletion(true)}
            >
              Request deletion
            </button>
          </div>
        </div>
      </Card>

      <Card title="Requests">
        {error ? (
          <InlineError message={error.message} />
        ) : isLoading || !requests ? (
          <LoadingRows rows={3} />
        ) : requests.length === 0 ? (
          <InlineEmpty
            title="No requests"
            hint="Exports and deletion requests raised here and by the Owner both appear in this list."
          />
        ) : (
          requests.map((r) => (
            <Row
              key={r.id}
              title={r.type === "EXPORT" ? "Data export" : "Deletion request"}
              detail={r.reason ?? "No reason recorded"}
              right={
                <>
                  {r.hardDeleteDeadline ? (
                    <span className="font-mono-num text-[10.5px] text-[var(--ink3)]">
                      due {new Date(r.hardDeleteDeadline).toLocaleDateString()}
                    </span>
                  ) : null}
                  <Pill tone={STATUS_TONE[r.status] ?? "nu"}>{r.status}</Pill>
                  {r.type === "EXPORT" && r.status === "COMPLETED" ? (
                    <button
                      type="button"
                      className="zoiko-btn sm"
                      disabled={download.isPending}
                      onClick={() =>
                        void stepUp.attempt("Downloading this export", (stepUpToken) =>
                          download.mutateAsync({ requestId: r.id, stepUpToken })
                        )
                      }
                    >
                      {download.isPending && download.variables?.requestId === r.id
                        ? "Preparing…"
                        : "Download"}
                    </button>
                  ) : null}
                </>
              }
            />
          ))
        )}
      </Card>
    </>
  );
}
