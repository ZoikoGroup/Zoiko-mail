"use client";

import { useState } from "react";
import { ShieldCheck } from "lucide-react";

import {
  useBeginMfaEnrolment,
  useConfirmMfaEnrolment,
  useDisableMfa,
  useMfaStatus,
  useRegenerateMfaRecoveryCodes,
} from "@/lib/auth-hooks";

/**
 * Managing your own second factor.
 *
 * This screen used to read "Two-factor authentication · Not configured" behind
 * a disabled Soon button, with the status hardcoded — while the server had a
 * complete TOTP implementation and *enforced* it at sign-in for Owners, Admins
 * and Support. So a privileged user was made to enrol during sign-in and then
 * told by their own settings that they had not, with no way to see their
 * remaining recovery codes or replace a lost authenticator.
 *
 * Distinct from app/verify-mfa, which runs the same enrolment against a
 * short-lived challenge token for an account that has no session yet. This one
 * runs with an ordinary session.
 */
export function MfaSettings() {
  const { data: status, isLoading, error } = useMfaStatus();
  const begin = useBeginMfaEnrolment();
  const confirm = useConfirmMfaEnrolment();
  const regenerate = useRegenerateMfaRecoveryCodes();
  const disable = useDisableMfa();

  const [code, setCode] = useState("");
  const [mode, setMode] = useState<"idle" | "enrolling" | "regenerating" | "disabling">("idle");
  /** Shown once, never fetched again — the server stores only hashes. */
  const [codes, setCodes] = useState<string[] | null>(null);

  const reset = () => {
    setCode("");
    setMode("idle");
    begin.reset();
    confirm.reset();
    regenerate.reset();
    disable.reset();
  };

  const startEnrolment = () => {
    setCodes(null);
    setMode("enrolling");
    begin.mutate();
  };

  const submit = () => {
    if (mode === "enrolling") {
      confirm.mutate(code, {
        onSuccess: (result) => {
          setCodes(result.recoveryCodes);
          setCode("");
        },
      });
    } else if (mode === "regenerating") {
      regenerate.mutate(code, {
        onSuccess: (result) => {
          setCodes(result.recoveryCodes);
          setCode("");
          setMode("idle");
        },
      });
    } else if (mode === "disabling") {
      disable.mutate(code, { onSuccess: reset });
    }
  };

  const busy =
    begin.isPending || confirm.isPending || regenerate.isPending || disable.isPending;
  const failure = begin.error ?? confirm.error ?? regenerate.error ?? disable.error;

  if (isLoading) {
    return <Shell><p className="text-[12.5px] text-slate-500">Checking…</p></Shell>;
  }

  // A read that failed and "not enrolled" are different facts. Saying
  // "Not configured" here is what the old screen did to everybody.
  if (error || !status) {
    return (
      <Shell>
        <p className="text-[12.5px] text-rose-600 dark:text-rose-400">
          Could not read your two-factor status. {error?.message ?? ""}
        </p>
      </Shell>
    );
  }

  return (
    <Shell>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-[13px] font-semibold text-slate-900 dark:text-slate-100">
            {status.enrolled
              ? "On — your authenticator is required at sign-in"
              : status.enrolmentPending
                ? "Started but not finished"
                : "Off"}
          </p>
          <p className="mt-0.5 text-[12px] text-slate-500 dark:text-slate-400">
            {status.enrolled
              ? `${status.remainingRecoveryCodes} recovery code${
                  status.remainingRecoveryCodes === 1 ? "" : "s"
                } left`
              : status.required
                ? `Required for your role${
                    status.requiredBecause ? ` (${status.requiredBecause.toLowerCase()})` : ""
                  } — you will be asked to set it up at your next sign-in.`
                : "Add a second step at sign-in for extra protection."}
          </p>
        </div>

        {mode === "idle" && (
          <div className="flex flex-wrap gap-2">
            {!status.enrolled && (
              <button className="zoiko-btn pri sm" disabled={busy} onClick={startEnrolment}>
                {status.enrolmentPending ? "Finish setup" : "Set up"}
              </button>
            )}
            {status.enrolled && (
              <>
                <button
                  className="zoiko-btn sm"
                  disabled={busy}
                  onClick={() => {
                    setCodes(null);
                    setMode("regenerating");
                  }}
                >
                  New recovery codes
                </button>
                {/* Not offered when the role compels it: the server refuses,
                    and a button that always fails is not a choice. */}
                {!status.required && (
                  <button
                    className="zoiko-btn sm"
                    disabled={busy}
                    onClick={() => setMode("disabling")}
                  >
                    Turn off
                  </button>
                )}
              </>
            )}
          </div>
        )}
      </div>

      {failure && (
        <p className="mt-3 rounded-lg bg-rose-50 px-3 py-2 text-[12px] text-rose-700 dark:bg-rose-950/40 dark:text-rose-300">
          {failure.message}
        </p>
      )}

      {mode === "enrolling" && !codes && (
        <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 p-4 dark:border-slate-800 dark:bg-slate-900">
          {begin.data ? (
            <>
              <p className="text-[11px] uppercase tracking-wide text-slate-500 dark:text-slate-400">
                Setup key
              </p>
              <p className="mt-1 break-all font-mono text-[13px] text-slate-900 dark:text-slate-100">
                {begin.data.secret}
              </p>
              <a
                className="mt-2 inline-block text-[12px] text-slate-600 underline dark:text-slate-300"
                href={begin.data.uri}
              >
                Open in an authenticator app
              </a>
            </>
          ) : (
            <p className="text-[12.5px] text-slate-500">Preparing your key…</p>
          )}
        </div>
      )}

      {mode !== "idle" && !codes && (
        <div className="mt-4">
          <label
            htmlFor="mfa-code"
            className="mb-1 block text-[11px] uppercase tracking-wide text-slate-500 dark:text-slate-400"
          >
            {mode === "enrolling"
              ? "Code from your authenticator"
              : "Confirm with a current code"}
          </label>
          <div className="flex flex-wrap gap-2">
            <input
              id="mfa-code"
              inputMode="numeric"
              autoComplete="one-time-code"
              placeholder="123456"
              value={code}
              disabled={busy}
              onChange={(event) => setCode(event.target.value.trim())}
              onKeyDown={(event) => {
                if (event.key === "Enter" && code) submit();
              }}
              className="w-[160px] rounded-lg border border-slate-200 bg-white px-3 py-2 font-mono text-[13px] text-slate-900 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-100"
            />
            <button className="zoiko-btn pri sm" disabled={busy || !code} onClick={submit}>
              {busy
                ? "Working…"
                : mode === "enrolling"
                  ? "Confirm"
                  : mode === "regenerating"
                    ? "Replace codes"
                    : "Turn off"}
            </button>
            <button className="zoiko-btn sm" disabled={busy} onClick={reset}>
              Cancel
            </button>
          </div>
          {mode === "regenerating" && (
            <p className="mt-2 text-[11.5px] text-slate-500 dark:text-slate-400">
              Your existing recovery codes stop working the moment new ones are issued.
            </p>
          )}
          {mode === "disabling" && (
            <p className="mt-2 text-[11.5px] text-slate-500 dark:text-slate-400">
              A current code is required, so someone at an unlocked screen cannot remove
              the protection that would have stopped them.
            </p>
          )}
        </div>
      )}

      {codes && (
        <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 p-4 dark:border-slate-800 dark:bg-slate-900">
          <p className="text-[13px] font-semibold text-slate-900 dark:text-slate-100">
            Save your recovery codes
          </p>
          <p className="mt-1 text-[12px] text-slate-500 dark:text-slate-400">
            Each works once, if you lose your authenticator. Only hashes are stored, so
            this is the only time they are shown.
          </p>
          <ul className="mt-3 grid grid-cols-2 gap-2 font-mono text-[13px] text-slate-900 dark:text-slate-100">
            {codes.map((recoveryCode) => (
              <li key={recoveryCode}>{recoveryCode}</li>
            ))}
          </ul>
          <button
            className="zoiko-btn sm mt-3"
            onClick={() => {
              setCodes(null);
              reset();
            }}
          >
            I have saved them
          </button>
        </div>
      )}
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="p-5">
      <div className="mb-3 flex items-center gap-2.5">
        <span className="inline-flex h-9 w-9 items-center justify-center rounded-lg bg-slate-100 text-slate-600 dark:bg-slate-900 dark:text-slate-300">
          <ShieldCheck className="h-4 w-4" />
        </span>
        <div>
          <p className="text-[13px] font-semibold text-slate-900 dark:text-slate-100">
            Two-factor authentication
          </p>
          <p className="text-[12px] text-slate-500 dark:text-slate-400">
            A code from your authenticator, in addition to your password.
          </p>
        </div>
      </div>
      {children}
    </div>
  );
}
