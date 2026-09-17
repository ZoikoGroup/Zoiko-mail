"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import {
  beginMfaEnrolmentFromChallenge,
  confirmMfaEnrolmentFromChallenge,
  verifyMfaChallenge,
  type MfaEnrolmentOffer,
} from "@/lib/auth-api";
import { routeAuthState } from "@/lib/auth-hooks";
import { ApiError } from "@/lib/api-client";

/**
 * The second factor — AC-002.
 *
 * A privileged sign-in stops here holding nothing but a short-lived challenge
 * token: no session exists yet, which is why this route sits outside
 * ProtectedRoute alongside /create-workspace and /verify-email.
 *
 * Two shapes, from the two states the server can return. An account with an
 * authenticator is asked for a code. An account without one is walked through
 * enrolment first, because refusing the session and offering no way to enrol
 * would lock a newly promoted Admin out of the product entirely.
 */

type Phase = "code" | "enrol" | "recovery";

export default function VerifyMfaPage() {
  const router = useRouter();
  const [token, setToken] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [reason, setReason] = useState("");
  const [phase, setPhase] = useState<Phase>("code");
  const [offer, setOffer] = useState<MfaEnrolmentOffer | null>(null);
  const [recoveryCodes, setRecoveryCodes] = useState<string[]>([]);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  // Read what routeAuthState stashed. Landing here directly means there is no
  // challenge to answer, so there is nothing useful to show.
  useEffect(() => {
    const stashed = sessionStorage.getItem("zoiko.mfa_token");
    const state = sessionStorage.getItem("zoiko.mfa_state");
    if (!stashed || !state) {
      router.replace("/login");
      return;
    }
    setToken(stashed);
    setEmail(sessionStorage.getItem("zoiko.mfa_email") ?? "");
    setReason(sessionStorage.getItem("zoiko.mfa_reason") ?? "");
    setPhase(state === "MFA_ENROLLMENT_REQUIRED" ? "enrol" : "code");
    setReady(true);
  }, [router]);

  // Fetch the secret as soon as we know enrolment is what is needed, so the
  // screen shows something to scan rather than a button that fetches one.
  useEffect(() => {
    if (phase !== "enrol" || !token || offer) return;
    let cancelled = false;
    beginMfaEnrolmentFromChallenge(token)
      .then((next) => {
        if (!cancelled) setOffer(next);
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Could not start enrolment.");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [phase, token, offer]);

  const clearStash = () => {
    for (const key of ["mfa_token", "mfa_state", "mfa_email", "mfa_reason"]) {
      sessionStorage.removeItem(`zoiko.${key}`);
    }
  };

  const fail = (err: unknown) => {
    if (err instanceof ApiError && err.status === 401 && err.code === "TOKEN_INVALID") {
      // The ten-minute window closed. Sending them back to sign in is the
      // only way forward, and saying why avoids a silent bounce.
      clearStash();
      setError("This verification step expired. Sign in again.");
      setTimeout(() => router.replace("/login"), 1500);
      return;
    }
    setError(err instanceof Error ? err.message : "That code was not accepted.");
  };

  const submitCode = async () => {
    if (!token) return;
    setBusy(true);
    setError(null);
    try {
      const auth = await verifyMfaChallenge(token, code.trim());
      clearStash();
      routeAuthState(auth, router);
    } catch (err) {
      fail(err);
      setCode("");
    } finally {
      setBusy(false);
    }
  };

  const submitEnrolment = async () => {
    if (!token) return;
    setBusy(true);
    setError(null);
    try {
      const result = await confirmMfaEnrolmentFromChallenge(token, code.trim());
      // The codes are shown once and only their hashes are kept, so the
      // sign-in waits behind this screen rather than racing past it.
      setRecoveryCodes(result.recoveryCodes);
      setPhase("recovery");
      sessionStorage.setItem("zoiko.mfa_signed_in", JSON.stringify(result.auth));
    } catch (err) {
      fail(err);
      setCode("");
    } finally {
      setBusy(false);
    }
  };

  const finish = () => {
    const stored = sessionStorage.getItem("zoiko.mfa_signed_in");
    clearStash();
    sessionStorage.removeItem("zoiko.mfa_signed_in");
    if (stored) routeAuthState(JSON.parse(stored), router);
    else router.replace("/login");
  };

  if (!ready) return null;

  const field =
    "w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-center text-lg tracking-[0.4em] text-slate-900 outline-none focus:border-slate-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100";

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 p-4 dark:bg-slate-950">
      <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-8 shadow-xl dark:border-slate-800 dark:bg-slate-950">
        <div className="mb-6 text-center">
          <Image
            src="/ZoikoMail_Logo_DarkBG_PNG.png"
            width={400}
            height={100}
            alt="Zoiko Mail"
            className="mx-auto h-10 w-auto"
          />
        </div>

        {phase === "code" && (
          <>
            <h1 className="text-center text-lg font-semibold text-slate-900 dark:text-slate-100">
              Enter your authenticator code
            </h1>
            <p className="mt-2 text-center text-sm text-slate-500 dark:text-slate-400">
              {email
                ? `Signing in as ${email}. `
                : ""}
              Open your authenticator app, or use one of your recovery codes.
            </p>
            <input
              className={`${field} mt-6`}
              inputMode="text"
              autoComplete="one-time-code"
              placeholder="000000"
              value={code}
              onChange={(event) => setCode(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") void submitCode();
              }}
              autoFocus
            />
            <button
              type="button"
              className="mt-4 w-full rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50 dark:bg-slate-100 dark:text-slate-900"
              disabled={busy || code.trim().length < 6}
              onClick={() => void submitCode()}
            >
              {busy ? "Checking…" : "Continue"}
            </button>
          </>
        )}

        {phase === "enrol" && (
          <>
            <h1 className="text-center text-lg font-semibold text-slate-900 dark:text-slate-100">
              Set up two-factor authentication
            </h1>
            <p className="mt-2 text-center text-sm text-slate-500 dark:text-slate-400">
              {reason
                ? `Required for ${reason.toLowerCase()} accounts.`
                : "Required for this account."}{" "}
              Add the key below to an authenticator app, then enter the code it
              shows.
            </p>

            {offer ? (
              <div className="mt-5 rounded-lg border border-slate-200 bg-slate-50 p-4 dark:border-slate-800 dark:bg-slate-900">
                <p className="text-[11px] uppercase tracking-wide text-slate-500 dark:text-slate-400">
                  Setup key
                </p>
                <p className="mt-1 break-all font-mono text-sm text-slate-900 dark:text-slate-100">
                  {offer.secret}
                </p>
                <a
                  className="mt-3 inline-block text-xs text-slate-600 underline dark:text-slate-300"
                  href={offer.uri}
                >
                  Open in an authenticator app
                </a>
              </div>
            ) : (
              <p className="mt-5 text-center text-sm text-slate-400">Preparing your key…</p>
            )}

            <input
              className={`${field} mt-5`}
              inputMode="numeric"
              autoComplete="one-time-code"
              placeholder="000000"
              value={code}
              onChange={(event) => setCode(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") void submitEnrolment();
              }}
            />
            <button
              type="button"
              className="mt-4 w-full rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50 dark:bg-slate-100 dark:text-slate-900"
              disabled={busy || !offer || code.trim().length < 6}
              onClick={() => void submitEnrolment()}
            >
              {busy ? "Confirming…" : "Confirm and sign in"}
            </button>
          </>
        )}

        {phase === "recovery" && (
          <>
            <h1 className="text-center text-lg font-semibold text-slate-900 dark:text-slate-100">
              Save your recovery codes
            </h1>
            <p className="mt-2 text-center text-sm text-slate-500 dark:text-slate-400">
              Each one works once, if you lose your authenticator. This is the
              only time they are shown.
            </p>
            <ul className="mt-5 grid grid-cols-2 gap-2 rounded-lg border border-slate-200 bg-slate-50 p-4 font-mono text-sm text-slate-900 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-100">
              {recoveryCodes.map((recoveryCode) => (
                <li key={recoveryCode}>{recoveryCode}</li>
              ))}
            </ul>
            <button
              type="button"
              className="mt-4 w-full rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white dark:bg-slate-100 dark:text-slate-900"
              onClick={finish}
            >
              I have saved them — continue
            </button>
          </>
        )}

        {error && (
          <p className="mt-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-center text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
            {error}
          </p>
        )}

        <button
          type="button"
          className="mt-6 w-full text-center text-xs text-slate-500 underline dark:text-slate-400"
          onClick={() => {
            clearStash();
            router.replace("/login");
          }}
        >
          Back to sign in
        </button>
      </div>
    </div>
  );
}
