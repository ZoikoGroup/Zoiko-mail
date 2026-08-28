"use client";

import { useEffect, useState } from "react";
import { FaEnvelope } from "react-icons/fa";

import { ApiError } from "@/lib/api-client";
import { useGoogleResendOtp, useGoogleVerifyOtp } from "@/lib/auth-hooks";

/**
 * The code step of Google sign-in.
 *
 * Google has already proved the address; this is the product's extra
 * confirmation before a session exists. Nothing here holds credentials — the
 * pending token identifies who is signing in and nothing more, and the session
 * is only minted server-side once the code checks out.
 */
interface GoogleOtpStepProps {
  pendingToken: string;
  sentTo: string;
  onCancel: () => void;
}

export default function GoogleOtpStep({ pendingToken, sentTo, onCancel }: GoogleOtpStepProps) {
  const verify = useGoogleVerifyOtp();
  const resend = useGoogleResendOtp();
  const [code, setCode] = useState("");
  const [cooldown, setCooldown] = useState(0);

  // Counts down locally so the resend button cannot be hammered against a
  // limit the server is going to refuse anyway.
  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  const message = (err: unknown) =>
    err instanceof ApiError ? err.message : "Something went wrong. Try again.";

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (code.trim().length < 4) return;
    verify.mutate({ pendingToken, code: code.trim() });
  };

  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="text-center">
        <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-teal-50 text-teal-600 dark:bg-teal-950 dark:text-teal-400">
          <FaEnvelope className="text-lg" />
        </span>
        <h2 className="mt-3 text-lg font-semibold text-slate-900 dark:text-slate-100">
          Check your email
        </h2>
        <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
          We sent a sign-in code to <span className="font-medium">{sentTo}</span>
        </p>
      </div>

      <input
        value={code}
        onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 8))}
        inputMode="numeric"
        autoComplete="one-time-code"
        autoFocus
        placeholder="Enter code"
        aria-label="Sign-in code"
        className="h-12 w-full rounded-xl border border-slate-300 bg-white text-center text-lg tracking-[0.4em] text-slate-900 outline-none focus:border-teal-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
      />

      {(verify.error || resend.error) && (
        <p role="alert" className="text-center text-sm text-red-600 dark:text-red-400">
          {message(verify.error ?? resend.error)}
        </p>
      )}

      <button
        type="submit"
        disabled={verify.isPending || code.trim().length < 4}
        className="h-12 w-full rounded-xl bg-teal-600 text-sm font-semibold text-white transition-colors hover:bg-teal-700 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {verify.isPending ? "Verifying..." : "Verify and sign in"}
      </button>

      <div className="flex items-center justify-between text-sm">
        <button
          type="button"
          onClick={onCancel}
          className="text-slate-600 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200"
        >
          Use a different account
        </button>

        <button
          type="button"
          disabled={resend.isPending || cooldown > 0}
          onClick={() =>
            resend.mutate(pendingToken, {
              onSuccess: (r) => setCooldown(Math.ceil((r?.cooldownMs ?? 60_000) / 1000)),
            })
          }
          className="font-semibold text-teal-600 hover:text-teal-700 disabled:cursor-not-allowed disabled:opacity-60 dark:text-teal-400"
        >
          {cooldown > 0 ? `Resend in ${cooldown}s` : resend.isPending ? "Sending..." : "Resend code"}
        </button>
      </div>
    </form>
  );
}
