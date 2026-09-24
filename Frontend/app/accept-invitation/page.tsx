"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { useRouter, useSearchParams } from "next/navigation";
import {
  acceptInvitation,
  claimInvitation,
  lookupInvitation,
  type InvitationLookup,
} from "@/lib/owner-api";
import { isLoggedIn } from "@/lib/auth-storage";
import { logout } from "@/lib/auth-api";

/**
 * Accepting an invitation.
 *
 * This page used to require a session before it would do anything, which was
 * a closed loop for the people it exists for: `createInvitation` gives a new
 * invitee a placeholder account with a random password nobody knows, so they
 * could not sign in, so they could not accept. Clicking the link in the same
 * browser as the inviter produced the other half — a session belonging to
 * somebody else, and "Invitation belongs to another user".
 *
 * The token in the link is the credential now, the way a password-reset link
 * is: it was delivered to the invited address, so presenting it proves
 * control of that mailbox. What happens next depends on whether that address
 * already has an account, which the server answers before anyone signs in:
 *
 *   no account yet  → choose a password here, then sign in
 *   account exists  → sign in first, then accept from their own session
 *
 * The second branch is not a convenience. An admin can invite any address, so
 * a link that could set a password on an existing account would make "invite"
 * a way to take one over.
 */

type Phase =
  | "loading"
  | "set-password"   // no account yet: choose one
  | "needs-signin"   // account exists: sign in and accept
  | "accepting"      // signed in already: the original path
  | "done"
  | "error"
  | "no-token";

function AcceptInvitationInner() {
  const params = useSearchParams();
  const router = useRouter();
  const token = params.get("token") ?? "";

  const [phase, setPhase] = useState<Phase>(!token ? "no-token" : "loading");
  const [invite, setInvite] = useState<InvitationLookup | null>(null);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [errorMsg, setErrorMsg] = useState("");
  const [busy, setBusy] = useState(false);

  // One attempt per token. React StrictMode double-invokes effects in
  // development, and without this guard the first request consumed the token
  // while the second reported "Invitation is invalid" — right after a
  // successful accept. No cancelled flag: a cleanup-time cancel combined with
  // this ref once parked the page on "Loading…" forever, because the only
  // request's response went unhandled. A late setState is a harmless no-op.
  const attempted = useRef<string | null>(null);

  useEffect(() => {
    if (!token || attempted.current === token) return;
    attempted.current = token;

    /**
     * Look the invitation up first, always — before looking at any session.
     *
     * The obvious order is the wrong one. `isLoggedIn()` only reports that a
     * token is *stored*, not that it still works, and the browser that opens
     * an invitation link is very often the one the inviter used: it holds a
     * stale or expired session belonging to somebody else entirely. Trusting
     * it sends a brand-new invitee down the authenticated path, where the
     * server answers 401 and the screen reads "Authentication required" — to
     * a person who has never had an account to authenticate with.
     *
     * The lookup needs no session and cannot leak into one, so asking it
     * first costs a request and removes the whole class of failure.
     */
    lookupInvitation(token)
      .then(async (found) => {
        setInvite(found);

        // No account behind this address yet: a password is the only way
        // forward, and no session — stale, valid or otherwise — changes that.
        if (found.needsPassword) {
          setPhase("set-password");
          return;
        }

        // The address already has an account. A live session that belongs to
        // that person can accept right now; anything else signs in first.
        if (isLoggedIn()) {
          setPhase("accepting");
          try {
            await acceptInvitation(token);
            sessionStorage.removeItem("pendingInvitationToken");
            // Sign out so they return with the new membership on their token.
            await logout();
            window.location.href = "/login";
            return;
          } catch {
            // Expired, or belonging to someone else. Either way this is not
            // an error to show — it is the sign-in the invitation needs, and
            // the stored token is what was misleading us.
            sessionStorage.setItem("pendingInvitationToken", token);
            setPhase("needs-signin");
            return;
          }
        }

        sessionStorage.setItem("pendingInvitationToken", token);
        setPhase("needs-signin");
      })
      .catch((e: Error) => {
        setErrorMsg(e.message || "Something went wrong");
        setPhase("error");
      });
  }, [token]);

  const submit = async () => {
    setErrorMsg("");
    if (password !== confirm) {
      setErrorMsg("Those passwords do not match.");
      return;
    }
    setBusy(true);
    try {
      await claimInvitation(token, password);
      setPhase("done");
      // To the sign-in page, with the password they just chose. Kept separate
      // from claiming on purpose: it proves the password works before they
      // depend on it, and it puts them on the path where MFA enrolment lives.
      setTimeout(() => router.push("/login"), 1400);
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : "Could not set your password.");
      setBusy(false);
    }
  };

  const field =
    "w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none focus:border-teal-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100";

  return (
    <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-8 shadow-xl dark:border-slate-800 dark:bg-slate-950">
      <div className="mb-8 text-center">
        <Image
          src="/ZoikoMail_Logo_DarkBG_PNG.png"
          width={400}
          height={100}
          className="mx-auto mb-4 h-12 w-auto"
          alt="Zoiko Mail"
          priority
        />
      </div>

      {(phase === "loading" || phase === "accepting") && (
        <div className="text-center">
          <div className="mx-auto mb-4 h-8 w-8 animate-spin rounded-full border-2 border-slate-300 border-t-teal-600" />
          <p className="text-sm text-slate-500 dark:text-slate-400">
            {phase === "accepting" ? "Accepting your invitation…" : "Checking your invitation…"}
          </p>
        </div>
      )}

      {phase === "set-password" && invite && (
        <div>
          <h2 className="text-center text-lg font-semibold text-slate-900 dark:text-white">
            Create your password
          </h2>
          <p className="mt-2 text-center text-sm text-slate-500 dark:text-slate-400">
            You have been invited to <strong>{invite.tenantName}</strong> as{" "}
            {invite.role.toLowerCase()}. Choose a password for{" "}
            <strong className="break-all">{invite.email}</strong>.
          </p>

          <div className="mt-6 space-y-3">
            <div>
              <label
                htmlFor="new-password"
                className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-300"
              >
                Password
              </label>
              <input
                id="new-password"
                type="password"
                autoComplete="new-password"
                className={field}
                value={password}
                disabled={busy}
                onChange={(event) => setPassword(event.target.value)}
              />
              <p className="mt-1 text-[11px] text-slate-400">
                At least 12 characters, with an uppercase letter, a lowercase letter and a
                number.
              </p>
            </div>

            <div>
              <label
                htmlFor="confirm-password"
                className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-300"
              >
                Confirm password
              </label>
              <input
                id="confirm-password"
                type="password"
                autoComplete="new-password"
                className={field}
                value={confirm}
                disabled={busy}
                onChange={(event) => setConfirm(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && password && confirm) void submit();
                }}
              />
            </div>

            {errorMsg && <p className="text-xs text-red-600 dark:text-red-400">{errorMsg}</p>}

            <button
              type="button"
              className="w-full rounded-lg bg-teal-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-teal-700 disabled:opacity-50"
              disabled={busy || password.length < 12 || confirm.length === 0}
              onClick={() => void submit()}
            >
              {busy ? "Setting your password…" : "Create password and continue"}
            </button>
          </div>
        </div>
      )}

      {phase === "needs-signin" && (
        <div className="text-center">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-blue-100 text-2xl dark:bg-blue-900/30">
            🔒
          </div>
          <h2 className="text-lg font-semibold text-slate-900 dark:text-white">Sign in to accept</h2>
          <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
            {invite?.email ? (
              <>
                <strong className="break-all">{invite.email}</strong> already has an account.
                Sign in and this invitation will be accepted for you.
              </>
            ) : (
              "Please sign in to accept this invitation."
            )}
          </p>
          <Link
            href="/login"
            className="mt-6 inline-block rounded-lg bg-teal-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-teal-700"
          >
            Sign in
          </Link>
        </div>
      )}

      {phase === "done" && (
        <div className="text-center">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-green-100 text-2xl dark:bg-green-900/30">
            ✓
          </div>
          <h2 className="text-lg font-semibold text-slate-900 dark:text-white">
            You&apos;re in!
          </h2>
          <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
            Your password is set. Taking you to sign in…
          </p>
        </div>
      )}

      {phase === "error" && (
        <div className="text-center">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-red-100 text-2xl dark:bg-red-900/30">
            ✗
          </div>
          <h2 className="text-lg font-semibold text-slate-900 dark:text-white">Invitation failed</h2>
          <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
            {errorMsg === "Invitation is invalid"
              ? "This invitation link is no longer valid. It may have already been used, or a newer invitation email was sent — please use the most recent one."
              : errorMsg || "Something went wrong"}
          </p>
          <Link
            href="/login"
            className="mt-6 inline-block rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
          >
            Back to sign in
          </Link>
        </div>
      )}

      {phase === "no-token" && (
        <div className="text-center">
          <h2 className="text-lg font-semibold text-slate-900 dark:text-white">Invalid link</h2>
          <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
            This invitation link is missing or invalid. Please check the email and try again.
          </p>
          <Link
            href="/login"
            className="mt-6 inline-block rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
          >
            Back to sign in
          </Link>
        </div>
      )}
    </div>
  );
}

export default function AcceptInvitationPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 p-4 dark:bg-slate-950">
      <Suspense>
        <AcceptInvitationInner />
      </Suspense>
    </div>
  );
}
