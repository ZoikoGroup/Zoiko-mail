"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Monitor, MonitorSmartphone } from "lucide-react";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { clearTokens } from "@/lib/auth-storage";
import { fetchMySessions, revokeMySession, type AccountSession } from "@/lib/account-security-api";

/**
 * "Active sessions" — every browser and device this account is signed in on
 * in this workspace, and a way to end one at a time (P1, S2 §09).
 *
 * Ending another device takes effect on that device's next request. Ending
 * this one is a sign-out, so it asks the same way and then leaves.
 */

const QUERY_KEY = ["account-security", "sessions"] as const;

function when(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime())
    ? "—"
    : date.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

export function ActiveSessionsRow() {
  const qc = useQueryClient();
  const router = useRouter();
  const [confirming, setConfirming] = useState<AccountSession | null>(null);

  const list = useQuery({ queryKey: QUERY_KEY, queryFn: fetchMySessions, staleTime: 15_000 });
  const revoke = useMutation({
    mutationFn: (session: AccountSession) => revokeMySession(session.key),
    onSuccess: (result) => {
      if (result.current) {
        // This browser's own session: nothing left to show here.
        clearTokens();
        qc.clear();
        router.replace("/login");
        return;
      }
      void qc.invalidateQueries({ queryKey: QUERY_KEY });
    },
  });

  const sessions = list.data ?? [];

  return (
    <div className="p-5" data-testid="active-sessions">
      <div className="flex flex-wrap items-center gap-3">
        <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-[var(--border)] bg-[var(--s2)] text-[var(--ink2)]">
          <Monitor className="h-4 w-4" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-semibold text-[var(--ink)]">Active sessions</p>
          <p className="text-[12px] text-[var(--ink3)]">
            Every browser and device you are signed in on. Sign out any you do not recognise.
          </p>
        </div>
      </div>

      <div className="mt-4" aria-live="polite">
        {list.isLoading ? (
          <p className="text-[12px] text-[var(--ink3)]">Loading sessions…</p>
        ) : list.isError ? (
          <p className="text-[12px] text-[var(--crit)]" role="alert">
            Sessions could not be loaded. {(list.error as Error).message}
          </p>
        ) : sessions.length === 0 ? (
          <p className="text-[12px] text-[var(--ink3)]">No other sessions.</p>
        ) : (
          <ul className="divide-y divide-[var(--border)] rounded-xl border border-[var(--border)]">
            {sessions.map((session) => (
              <li key={session.key} className="flex flex-wrap items-center gap-3 px-4 py-3" data-testid="session-row">
                <MonitorSmartphone className="h-4 w-4 shrink-0 text-[var(--ink3)]" aria-hidden />
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-2 text-[12.5px] font-semibold text-[var(--ink)]">
                    <span className="truncate">{session.deviceLabel ?? "Unknown device"}</span>
                    {session.current ? (
                      <span className="rounded-full bg-[var(--ok-soft,var(--s2))] px-2 py-0.5 text-[10.5px] font-semibold text-[var(--ok)]">
                        This device
                      </span>
                    ) : null}
                  </p>
                  <p className="text-[11.5px] text-[var(--ink3)]">
                    {session.ipAddress ? `${session.ipAddress} · ` : ""}Signed in {when(session.signedInAt)} · Last active{" "}
                    {when(session.lastActiveAt)}
                  </p>
                </div>
                <button
                  type="button"
                  className="zoiko-btn sm crit"
                  onClick={() => setConfirming(session)}
                  disabled={revoke.isPending}
                  aria-label={session.current ? "Sign out this device" : `Sign out ${session.deviceLabel ?? "this session"}`}
                >
                  Sign out
                </button>
              </li>
            ))}
          </ul>
        )}
        {revoke.isError ? (
          <p className="mt-2 text-[12px] text-[var(--crit)]" role="alert">
            {(revoke.error as Error).message}
          </p>
        ) : null}
      </div>

      <ConfirmDialog
        open={confirming !== null}
        onClose={() => setConfirming(null)}
        onConfirm={() => {
          const target = confirming;
          setConfirming(null);
          if (target) revoke.mutate(target);
        }}
        title={confirming?.current ? "Sign out of this device?" : "Sign out that session?"}
        message={
          confirming?.current
            ? "You will be signed out here and taken to the sign-in page."
            : "That browser or device is signed out on its next request. Anyone using it will have to sign in again."
        }
        confirmLabel="Sign out"
        loading={revoke.isPending}
      />
    </div>
  );
}
