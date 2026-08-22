"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { useSearchParams } from "next/navigation";
import { acceptInvitation } from "@/lib/owner-api";
import { isLoggedIn } from "@/lib/auth-storage";

function AcceptInvitationInner() {
  const params = useSearchParams();
  const token = params.get("token") ?? "";

  const [status, setStatus] = useState<"loading" | "success" | "error" | "no-token" | "need-login">(
    !token ? "no-token" : "loading"
  );
  const [errorMsg, setErrorMsg] = useState("");

  // Acceptance is a one-time server action, so it must fire exactly once per
  // token. React StrictMode double-invokes effects in development — without
  // this guard the first request consumes the token and the second one fails,
  // which surfaced to users as "Invitation is invalid" right after a
  // successful accept.
  //
  // The ref alone is the single-fire mechanism; there is deliberately NO
  // cancelled flag. A cleanup-time cancel combined with the ref guard left
  // the first (and only) request's response unhandled, parking the page on
  // "Loading…" forever. Late setState after an unmount is a harmless no-op.
  const attemptedToken = useRef<string | null>(null);

  useEffect(() => {
    if (!token) return;

    if (attemptedToken.current === token) return;
    attemptedToken.current = token;

    if (!isLoggedIn()) {
      sessionStorage.setItem("pendingInvitationToken", token);
      setStatus("need-login");
      return;
    }

    acceptInvitation(token)
      .then(() => {
        sessionStorage.removeItem("pendingInvitationToken");
        setStatus("success");
      })
      .catch((e: Error) => {
        setStatus("error");
        setErrorMsg(e.message || "Something went wrong");
      });
  }, [token]);

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

      {status === "loading" && (
        <div className="text-center">
          <div className="mx-auto mb-4 h-8 w-8 animate-spin rounded-full border-2 border-slate-300 border-t-teal-600" />
          <p className="text-sm text-slate-500 dark:text-slate-400">Accepting your invitation…</p>
        </div>
      )}

      {status === "need-login" && (
        <div className="text-center">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-blue-100 text-2xl dark:bg-blue-900/30">
            🔒
          </div>
          <h2 className="text-lg font-semibold text-slate-900 dark:text-white">Sign in required</h2>
          <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
            Please sign in to accept this invitation.
          </p>
          <Link
            href="/login"
            className="mt-6 inline-block rounded-lg bg-teal-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-teal-700"
          >
            Sign in
          </Link>
        </div>
      )}

      {status === "success" && (
        <div className="text-center">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-green-100 text-2xl dark:bg-green-900/30">
            ✓
          </div>
          <h2 className="text-lg font-semibold text-slate-900 dark:text-white">You&apos;re in!</h2>
          <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
            Your invitation has been accepted. Welcome to the team.
          </p>
          <Link
            href="/"
            className="mt-6 inline-block rounded-lg bg-teal-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-teal-700"
          >
            Go to Dashboard
          </Link>
        </div>
      )}

      {status === "error" && (
        <div className="text-center">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-red-100 text-2xl dark:bg-red-900/30">
            ✗
          </div>
          <h2 className="text-lg font-semibold text-slate-900 dark:text-white">Invitation failed</h2>
          <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
            {errorMsg === "Invitation is invalid"
              ? "This invitation link is no longer valid. It may have already been accepted, or a newer invitation email was sent — please use the most recent one."
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

      {status === "no-token" && (
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
