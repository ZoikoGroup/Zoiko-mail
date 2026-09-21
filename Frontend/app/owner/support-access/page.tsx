"use client";

import { useState } from "react";
import { ShieldCheck, ShieldOff, Clock } from "lucide-react";

import { ProtectedRoute } from "@/components/owner/ProtectedRoute";
import { PageHeader } from "@/components/ui/PageHeader";
import { Skeleton } from "@/components/ui/Skeleton";
import { StepUpDialog, useStepUp } from "@/components/admin/StepUpDialog";
import { useCan } from "@/lib/admin-capabilities";
import {
  useApproveSupportAccess,
  useDenySupportAccess,
  useSupportAccessRequests,
} from "@/lib/owner-hooks";
import type { SupportAccessRequest } from "@/lib/owner-api";

/**
 * Deciding whether Zoiko support may read this workspace — Runbook §7.
 *
 * The enforcement shipped before this screen did: support cannot read a
 * workspace without an approved, unexpired grant, and every read it makes is
 * audited. For a while nothing in the product could create a grant, so the
 * control was real and unusable — the only way to open access was a direct
 * API call. This is where it is decided.
 *
 * Owner-only, and the approval takes a step-up. RBAC §2 records "Approve
 * support access" as Owner Yes / Admin No, and Security §5 lists it among the
 * high-risk actions that need a fresh password. Admins can still decline a
 * request, because refusing access is not the same decision as opening it.
 */

const SCOPE_LABEL: Record<string, string> = {
  TENANT_DIAGNOSTICS: "Workspace diagnostics",
  DNS_DIAGNOSTICS: "DNS and domains",
  DELIVERY_DIAGNOSTICS: "Delivery and bounces",
  AUDIT_READ: "Audit log",
  MAIL_CONTENT: "Read inside a mailbox",
};

/**
 * The one scope that is not routine.
 *
 * RBAC §2 gives Support "Read private user mailbox" only through a grant and
 * Security §4 calls it "blocked by default; exceptional security-approved
 * path only". An owner skimming a list of four grey chips would approve it
 * without noticing, which is exactly the outcome those two lines exist to
 * prevent, so this one is marked and named.
 */
const EXCEPTIONAL_SCOPES = new Set(["MAIL_CONTENT"]);

function when(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
  });
}

export default function SupportAccessPage() {
  const { data, isLoading, error } = useSupportAccessRequests();
  const approve = useApproveSupportAccess();
  const deny = useDenySupportAccess();
  const stepUp = useStepUp();
  const can = useCan();

  // RBAC §2: "Approve support access" is Owner Yes, Admin No — so an Admin
  // reaching this screen sees the requests and can decline them, but is not
  // offered a button the server will refuse. The server is still the gate;
  // this only stops the UI promising something it cannot deliver.
  const canApprove = can("support.grant.create");
  const canDecline = can("support.grant.end");

  const [minutes, setMinutes] = useState<Record<string, number>>({});
  const [failed, setFailed] = useState<string | null>(null);

  const requests = data?.requests ?? [];
  const pending = requests.filter((r) => r.status === "PENDING");
  const decided = requests.filter((r) => r.status !== "PENDING");

  const onApprove = (r: SupportAccessRequest) => {
    setFailed(null);
    void stepUp.attempt(`Approving support access for ${r.supportMembership.user.email}`, (token) =>
      approve
        .mutateAsync({ requestId: r.id, stepUpToken: token, minutes: minutes[r.id] })
        .catch((e: unknown) => {
          setFailed(e instanceof Error ? e.message : "Could not approve that request.");
          throw e;
        })
    );
  };

  const onDeny = (r: SupportAccessRequest) => {
    setFailed(null);
    deny.mutate(
      { requestId: r.id },
      { onError: (e) => setFailed(e instanceof Error ? e.message : "Could not decline that request.") }
    );
  };

  return (
    <ProtectedRoute>
      <StepUpDialog {...stepUp.dialog} />

      <PageHeader
        title="Support access"
        description="Zoiko support has no standing access to this workspace. Each request is time-boxed, tied to a case, and every read it allows is recorded in your audit log."
      />

      {failed && (
        <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
          {failed}
        </div>
      )}

      {isLoading ? (
        <Skeleton className="h-40 w-full" />
      ) : error ? (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          Could not load support access requests. {(error as Error).message}
        </div>
      ) : (
        <>
          <section className="mb-8">
            <h2 className="mb-3 text-sm font-semibold text-slate-900 dark:text-white">
              Waiting for your decision
              {pending.length > 0 && (
                <span className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800 dark:bg-amber-900/40 dark:text-amber-200">
                  {pending.length}
                </span>
              )}
            </h2>

            {!canApprove && pending.length > 0 && (
              <p className="mb-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300">
                Only a workspace owner can approve support access. You can decline a request.
              </p>
            )}

            {pending.length === 0 ? (
              <p className="rounded-xl border border-slate-200 bg-white px-4 py-6 text-sm text-slate-500 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-400">
                Nothing waiting. Support will appear here when they ask for access, and you will
                get a notification.
              </p>
            ) : (
              <ul className="space-y-3">
                {pending.map((r) => (
                  <li
                    key={r.id}
                    className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-950"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-slate-900 dark:text-white">
                          {r.supportMembership.user.displayName}{" "}
                          <span className="font-normal text-slate-500 dark:text-slate-400">
                            ({r.supportMembership.user.email})
                          </span>
                        </p>
                        <p className="mt-1 text-sm text-slate-700 dark:text-slate-300">{r.reason}</p>

                        {r.scopes.some((sc) => EXCEPTIONAL_SCOPES.has(sc)) && (
                          <p className="mt-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
                            This request includes reading inside a member&apos;s mailbox. Support
                            would see message senders, recipients, subjects and delivery status —
                            not message bodies. Approve it only if the case needs it.
                          </p>
                        )}

                        <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
                          <span className="inline-flex items-center gap-1">
                            <Clock className="h-3.5 w-3.5" aria-hidden />
                            asked {when(r.createdAt)}
                          </span>
                          {r.ticket && (
                            <span className="rounded bg-slate-100 px-1.5 py-0.5 dark:bg-slate-800">
                              #{r.ticket.ticketNumber} {r.ticket.subject}
                            </span>
                          )}
                          {r.scopes.map((sc) => (
                            <span
                              key={sc}
                              className={
                                EXCEPTIONAL_SCOPES.has(sc)
                                  ? "rounded bg-amber-100 px-1.5 py-0.5 font-medium text-amber-900 dark:bg-amber-900/50 dark:text-amber-200"
                                  : "rounded bg-slate-100 px-1.5 py-0.5 dark:bg-slate-800"
                              }
                            >
                              {SCOPE_LABEL[sc] ?? sc}
                            </span>
                          ))}
                        </div>
                      </div>

                      <div className="flex shrink-0 items-center gap-2">
                        {/*
                          The approver may shorten the window but not lengthen
                          it — the server caps at what was asked for, so the
                          request stays the thing being approved.
                        */}
                        <label className="sr-only" htmlFor={`minutes-${r.id}`}>
                          Minutes of access to grant
                        </label>
                        <input
                          id={`minutes-${r.id}`}
                          type="number"
                          min={5}
                          max={r.requestedMinutes}
                          defaultValue={r.requestedMinutes}
                          onChange={(e) =>
                            setMinutes((m) => ({ ...m, [r.id]: Number(e.target.value) }))
                          }
                          className="w-20 rounded-lg border border-slate-300 px-2 py-1.5 text-sm dark:border-slate-700 dark:bg-slate-900"
                        />
                        <span className="text-xs text-slate-500 dark:text-slate-400">min</span>

                        {canApprove && (
                        <button
                          type="button"
                          onClick={() => onApprove(r)}
                          disabled={approve.isPending}
                          className="inline-flex items-center gap-1.5 rounded-lg bg-teal-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-teal-700 disabled:opacity-60"
                        >
                          <ShieldCheck className="h-4 w-4" aria-hidden />
                          Approve
                        </button>
                        )}
                        {canDecline && (
                        <button
                          type="button"
                          onClick={() => onDeny(r)}
                          disabled={deny.isPending}
                          className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-900"
                        >
                          <ShieldOff className="h-4 w-4" aria-hidden />
                          Decline
                        </button>
                        )}
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section>
            <h2 className="mb-3 text-sm font-semibold text-slate-900 dark:text-white">
              Already decided
            </h2>
            {decided.length === 0 ? (
              <p className="text-sm text-slate-500 dark:text-slate-400">Nothing yet.</p>
            ) : (
              <ul className="space-y-2">
                {decided.map((r) => (
                  <li
                    key={r.id}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-200 bg-white px-4 py-2.5 text-sm dark:border-slate-800 dark:bg-slate-950"
                  >
                    <span className="min-w-0 truncate text-slate-700 dark:text-slate-300">
                      {r.supportMembership.user.email} — {r.reason}
                    </span>
                    <span className="shrink-0 text-xs text-slate-500 dark:text-slate-400">
                      {r.status.toLowerCase()}
                      {r.decidedBy ? ` by ${r.decidedBy.displayName}` : ""}
                      {r.decidedAt ? ` · ${when(r.decidedAt)}` : ""}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </ProtectedRoute>
  );
}
