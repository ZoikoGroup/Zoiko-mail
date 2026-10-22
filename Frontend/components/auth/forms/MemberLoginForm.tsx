"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { FaArrowRight, FaEnvelope, FaLock, FaUsers } from "react-icons/fa";

import { ApiError } from "@/lib/api-client";
import { clearSignOutNotice, peekSignOutNotice } from "@/lib/auth-storage";
import { useLogin } from "@/lib/auth-hooks";

import { AuthBrand, FormInput, PasswordInput } from "@/components/auth";

type FormErrors = {
  email?: string;
  password?: string;
};

/**
 * The Member-only sign-in.
 *
 * Same account and password as the standard sign-in, but every request carries
 * workspace: "MEMBER", so the session always opens the Member workspace
 * (webmail) whatever the account's role. The server narrows the session's
 * authority to a member's, so an Admin or Owner signing in here cannot reach
 * a console from it; that needs the standard sign-in and the admin's
 * Workspace Access setting.
 *
 * Email (or mailbox address) and password only, by decision: no Google
 * sign-in here, and the API refuses a Google sign-in that asks for the Member
 * workspace. Google remains on the standard sign-in.
 *
 * One plain /login/member for everyone, with nothing prefilled. A mailbox
 * address picks its own workspace on the server.
 */
export default function MemberLoginForm() {
  const loginMutation = useLogin();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [errors, setErrors] = useState<FormErrors>({});

  const [signOutNotice, setSignOutNotice] = useState<string | null>(null);
  useEffect(() => {
    setSignOutNotice(peekSignOutNotice());
  }, []);
  const dismissSignOutNotice = () => {
    clearSignOutNotice();
    setSignOutNotice(null);
  };

  const validate = () => {
    const next: FormErrors = {};
    if (!email.trim()) next.email = "Email is required.";
    else if (!/^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$/i.test(email.trim())) next.email = "Please enter a valid email.";
    if (!password) next.password = "Password is required.";
    setErrors(next);
    return Object.keys(next).length === 0;
  };

  const onSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!validate()) return;
    dismissSignOutNotice();
    loginMutation.mutate({
      email: email.trim(),
      password,
      workspace: "MEMBER",
    });
  };

  const busy = loginMutation.isPending;
  const failure = loginMutation.error;
  const errorMessage = failure ? (failure instanceof ApiError ? failure.message : "Something went wrong.") : null;

  return (
    <>
      <div className="mb-6 text-center">
        <AuthBrand />
        <span className="mt-4 inline-flex items-center gap-2 rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300">
          <FaLock className="h-3 w-3" aria-hidden />
          Member workspace
        </span>
        <h2 className="mt-3 text-3xl font-bold tracking-tight text-slate-900 dark:text-white">Member Sign In</h2>
        <p className="mt-2 text-sm leading-6 text-slate-500 dark:text-slate-400">
          Sign in to your mailbox. You&apos;ll go straight to your Member workspace.
        </p>
      </div>

      <form onSubmit={onSubmit} className="space-y-4" aria-label="Member sign in">
        <FormInput
          // The account email or the mailbox address both sign in — an admin
          // usually hands over the mailbox address.
          label="Email or Mailbox Address"
          type="email"
          placeholder="john@example.com"
          icon={FaEnvelope}
          value={email}
          onChange={(event) => {
            setEmail(event.target.value);
            setErrors((prev) => ({ ...prev, email: undefined }));
          }}
          error={errors.email}
        />

        <PasswordInput
          label="Password"
          placeholder="Enter your password"
          value={password}
          onChange={(event) => {
            setPassword(event.target.value);
            setErrors((prev) => ({ ...prev, password: undefined }));
          }}
          error={errors.password}
        />

        <div className="flex justify-end">
          <Link
            href="/login?step=forgotPassword"
            className="text-sm font-semibold text-blue-600 transition hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300"
          >
            Forgot password?
          </Link>
        </div>

        {errorMessage && (
          <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
            {errorMessage}
          </div>
        )}
        {!errorMessage && signOutNotice && (
          <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600 dark:border-slate-700 dark:bg-slate-900/60 dark:text-slate-300">
            {signOutNotice}
          </div>
        )}

        <button
          type="submit"
          disabled={busy}
          className="flex h-[52px] w-full items-center justify-center gap-3 rounded-xl bg-blue-600 text-[15px] font-semibold text-white shadow-lg shadow-blue-600/25 transition-all duration-300 hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {loginMutation.isPending ? "Signing In..." : "Sign In to Member Workspace"}
          {!loginMutation.isPending && <FaArrowRight className="h-3.5 w-3.5" aria-hidden />}
        </button>
      </form>

      <div className="relative my-5">
        <div className="absolute inset-0 flex items-center">
          <div className="w-full border-t border-slate-200 dark:border-slate-700" />
        </div>
        <div className="relative flex justify-center">
          <span className="bg-white px-4 text-sm text-slate-500 dark:bg-slate-900 dark:text-slate-400">
            OR
          </span>
        </div>
      </div>

      <Link
        href="/login"
        className="group flex items-center gap-4 rounded-xl border border-slate-200 bg-white px-5 py-4 transition hover:border-blue-300 hover:bg-blue-50/50 dark:border-slate-700 dark:bg-slate-900 dark:hover:border-blue-700 dark:hover:bg-slate-800"
      >
        <FaUsers className="h-6 w-6 shrink-0 text-blue-600 dark:text-blue-400" aria-hidden />
        <span className="flex-1 text-left">
          <span className="block text-sm font-semibold text-slate-900 dark:text-white">
            Admin, Owner or Support?
          </span>
          <span className="block text-sm text-slate-500 dark:text-slate-400">
            Use the standard sign-in
          </span>
        </span>
        <FaArrowRight className="h-3.5 w-3.5 text-slate-500 transition group-hover:translate-x-0.5 group-hover:text-blue-600" aria-hidden />
      </Link>
    </>
  );
}
