"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { FaArrowLeft, FaEnvelope, FaInbox } from "react-icons/fa";

import { ApiError } from "@/lib/api-client";
import type { MemberLoginLink } from "@/lib/auth-api";
import { clearSignOutNotice, peekSignOutNotice } from "@/lib/auth-storage";
import { useGoogleLogin, useLogin } from "@/lib/auth-hooks";

import { FormInput, GoogleSignInButton, PasswordInput } from "@/components/auth";

interface MemberLoginFormProps {
  /** What a mailbox's sign-in link filled in; absent on the plain /login/member. */
  link?: MemberLoginLink | null;
  /** Why the link could not be read, shown above an otherwise usable form. */
  linkError?: string | null;
}

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
 */
export default function MemberLoginForm({ link, linkError }: MemberLoginFormProps) {
  const loginMutation = useLogin();
  const googleLoginMutation = useGoogleLogin();

  const [email, setEmail] = useState(link?.email ?? "");
  const [password, setPassword] = useState("");
  const [errors, setErrors] = useState<FormErrors>({});

  // The link resolves after the first render, so adopt its email when it
  // arrives — unless the person has already typed one.
  useEffect(() => {
    if (link?.email) setEmail((current) => current || link.email!);
  }, [link?.email]);

  const [signOutNotice, setSignOutNotice] = useState<string | null>(null);
  useEffect(() => {
    setSignOutNotice(peekSignOutNotice());
  }, []);
  const dismissSignOutNotice = () => {
    clearSignOutNotice();
    setSignOutNotice(null);
  };

  /**
   * The link's workspace, when it applies to the account signing in: always
   * for a shared mailbox's link, and for a personal one only when the email
   * is still the owner's. Someone else typing their own email here is simply
   * signing in, not into the link's workspace.
   */
  const tenantFor = (signingInAs: string): string | undefined => {
    if (!link) return undefined;
    if (link.shared || !link.email) return link.tenantId;
    return signingInAs.trim().toLowerCase() === link.email.toLowerCase() ? link.tenantId : undefined;
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
      tenantId: tenantFor(email),
      workspace: "MEMBER",
    });
  };

  const busy = loginMutation.isPending || googleLoginMutation.isPending;
  const failure = loginMutation.error ?? googleLoginMutation.error;
  const errorMessage = failure ? (failure instanceof ApiError ? failure.message : "Something went wrong.") : null;

  return (
    <>
      <div className="mb-5 text-center">
        <span className="inline-flex items-center gap-2 rounded-full bg-teal-50 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-teal-700 dark:bg-teal-950/50 dark:text-teal-300">
          <FaInbox className="h-3 w-3" aria-hidden />
          Member workspace
        </span>
        <h2 className="mt-3 text-3xl font-bold tracking-tight text-slate-900 dark:text-white">Member Sign In</h2>
        <p className="mt-3 text-sm leading-6 text-slate-500 dark:text-slate-400">
          Sign in to your mailbox. You&apos;ll go straight to your Member workspace.
        </p>
      </div>

      {link && (
        <div className="mb-4 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm dark:border-slate-700 dark:bg-slate-800/60">
          <div className="flex justify-between gap-3">
            <span className="text-slate-500 dark:text-slate-400">Workspace</span>
            <span className="truncate font-semibold text-slate-800 dark:text-slate-100">{link.workspaceName}</span>
          </div>
          <div className="mt-1 flex justify-between gap-3">
            <span className="text-slate-500 dark:text-slate-400">Mailbox</span>
            <span className="truncate font-semibold text-slate-800 dark:text-slate-100">{link.mailboxAddress}</span>
          </div>
        </div>
      )}

      {linkError && (
        <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
          {linkError}
        </div>
      )}

      <div className="mt-3">
        <GoogleSignInButton
          onSuccess={(idToken) => {
            dismissSignOutNotice();
            googleLoginMutation.mutate({
              idToken,
              // Google says who it is only after the click, so the link's
              // workspace is offered as-is; an account that does not belong
              // there is shown its own workspaces to pick from instead.
              tenantId: link?.tenantId,
              workspace: "MEMBER",
            });
          }}
          disabled={busy}
        />
      </div>

      <div className="relative m-2">
        <div className="absolute inset-0 flex items-center">
          <div className="w-full border-t border-slate-200 dark:border-slate-700" />
        </div>
        <div className="relative flex justify-center">
          <span className="bg-white px-4 text-sm text-slate-500 dark:bg-slate-900 dark:text-slate-400">OR</span>
        </div>
      </div>

      <form onSubmit={onSubmit} className="space-y-3" aria-label="Member sign in">
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
            className="text-sm font-medium text-teal-600 transition hover:text-teal-700 dark:text-teal-400 dark:hover:text-teal-300"
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
          className="flex h-12 w-full items-center justify-center rounded-xl bg-teal-600 text-sm font-semibold text-white transition-all duration-300 hover:bg-teal-700 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {loginMutation.isPending ? "Signing In..." : "Sign In to Member Workspace"}
        </button>
      </form>

      <div className="mt-4 text-center">
        <Link
          href="/login"
          className="inline-flex items-center gap-2 text-sm font-medium text-slate-600 transition hover:text-teal-700 dark:text-slate-300 dark:hover:text-teal-300"
        >
          <FaArrowLeft className="h-3 w-3" aria-hidden />
          Admin, Owner or Support? Use the standard sign-in
        </Link>
      </div>
    </>
  );
}
