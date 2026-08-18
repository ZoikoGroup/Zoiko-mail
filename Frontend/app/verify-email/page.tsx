"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import VerifyOtpForm from "@/components/auth/forms/VerifyOtpForm";

export default function VerifyEmailPage() {
  const router = useRouter();
  const [token, setToken] = useState<string | null>(null);
  const [email, setEmail] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  // Read the pending token stashed by useLogin's EMAIL_VERIFICATION_REQUIRED
  // branch. If someone lands here directly with no stash, we can't do
  // anything useful — send them back to /login.
  useEffect(() => {
    const t = sessionStorage.getItem("zoiko.pending_token");
    const e = sessionStorage.getItem("zoiko.pending_email");
    if (!t || !e) {
      router.replace("/login");
      return;
    }
    setToken(t);
    setEmail(e);
    setReady(true);
  }, [router]);

  const clearStash = () => {
    sessionStorage.removeItem("zoiko.pending_token");
    sessionStorage.removeItem("zoiko.pending_email");
  };

  const handleSuccess = () => {
    // Verification returns a new pending token, but for a
    // login-triggered flow the user still needs to sign in fresh
    // (safer than trying to auto-login from the frontend).
    clearStash();
    router.replace("/login");
  };

  const handleBack = () => {
    clearStash();
    router.replace("/login");
  };

  if (!ready || !token || !email) {
    // Brief flash while sessionStorage reads. Loading spinner isn't
    // needed — this is <50ms in practice.
    return null;
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 p-4 dark:bg-slate-950">
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
        <VerifyOtpForm
          token={token}
          email={email}
          onSuccess={handleSuccess}
          onBack={handleBack}
        />
      </div>
    </div>
  );
}