"use client";

import { Suspense } from "react";
import Link from "next/link";
import Image from "next/image";
import { useSearchParams } from "next/navigation";

// Copy for each state we handle. Add more entries here later without
// creating new files or routes.
const STATE_CONFIG: Record<
  string,
  {
    title: string;
    message: string;
    supportNote?: string;
  }
> = {
  ACCOUNT_SUSPENDED: {
    title: "Your account is suspended",
    message:
      "Access to this account has been temporarily suspended. Contact support to resolve this and restore access.",
    supportNote: "This is usually resolvable — reach out and we'll sort it.",
  },
  ACCOUNT_DISABLED: {
    title: "This account is no longer active",
    message:
      "This account has been disabled and can no longer be used to sign in. If you believe this is a mistake, contact support.",
  },
  MEMBERSHIP_SUSPENDED: {
    title: "Your workspace access is suspended",
    message:
      "Your access to this workspace has been suspended by a workspace administrator. Please contact your workspace owner to restore access.",
  },
  WORKSPACE_SUSPENDED: {
    title: "This workspace is suspended",
    message:
      "The workspace is currently suspended. Please contact your workspace owner or administrator to restore access.",
  },
  WORKSPACE_DELETING: {
    title: "This workspace is being deleted",
    message:
      "The workspace is scheduled for deletion. If this is a mistake, the workspace owner can cancel deletion within the grace period.",
  },
  INVITATION_PENDING: {
    title: "You have pending invitations",
    message:
      "You have been invited to one or more workspaces. Check your email for the acceptance link to join.",
  },
};

const SUPPORT_EMAIL = "support@zoiko.com";

function AuthStatusInner() {
  const params = useSearchParams();
  const state = params.get("state") ?? "";
  const workspace = params.get("workspace") ?? "";
  const invitations = params.get("invitations") ?? "";

  const config = STATE_CONFIG[state];

  // Unknown state — send them back to login rather than showing a broken page.
  if (!config) {
    return (
      <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-8 shadow-xl dark:border-slate-800 dark:bg-slate-950">
        <h1 className="text-xl font-bold text-slate-900 dark:text-white">Something went wrong</h1>
        <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
          We couldn&apos;t determine your account status. Please sign in again.
        </p>
        <Link
          href="/login"
          className="mt-6 inline-block rounded-lg bg-teal-600 px-4 py-2 text-sm font-medium text-white hover:bg-teal-700"
        >
          Back to sign in
        </Link>
      </div>
    );
  }

  // MEMBERSHIP_SUSPENDED is the only state that shows a workspace name.
  // const showWorkspace = state === "MEMBERSHIP_SUSPENDED" && workspace;
  const showWorkspace =
    (state === "MEMBERSHIP_SUSPENDED" ||
      state === "WORKSPACE_SUSPENDED" ||
      state === "WORKSPACE_DELETING") &&
    workspace;
  const showSupport = state === "ACCOUNT_SUSPENDED" || state === "ACCOUNT_DISABLED";

  return (
    <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-8 shadow-xl dark:border-slate-800 dark:bg-slate-950">
      {/* <div className="mb-8 text-center">
        <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-xl bg-teal-600 text-xl font-bold text-white">
          Z
        </div>
        <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Zoiko Mail</h1>
      </div> */}
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

      <div className="space-y-4">
        <h2 className="text-lg font-semibold text-slate-900 dark:text-white">{config.title}</h2>
        {showWorkspace && (
          <p className="text-sm font-medium text-slate-700 dark:text-slate-300">
            Workspace: <span className="text-slate-900 dark:text-white">{workspace}</span>
          </p>
        )}

        {state === "INVITATION_PENDING" && invitations && (
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 dark:border-slate-800 dark:bg-slate-900">
            <p className="text-xs font-medium uppercase text-slate-500 dark:text-slate-400">
              Pending invitations
            </p>
            <ul className="mt-2 space-y-1 text-sm text-slate-900 dark:text-white">
              {invitations.split(",").map((name) => (
                <li key={name}>• {name}</li>
              ))}
            </ul>
          </div>
        )}
        <p className="text-sm text-slate-500 dark:text-slate-400">{config.message}</p>
        {config.supportNote && (
          <p className="text-sm text-slate-500 dark:text-slate-400">{config.supportNote}</p>
        )}
      </div>

      <div className="mt-8 flex flex-col gap-3">
        {showSupport && (
          <a
            href={`mailto:${SUPPORT_EMAIL}`}
            className="inline-block rounded-lg bg-teal-600 px-4 py-2.5 text-center text-sm font-medium text-white hover:bg-teal-700"
          >
            Contact support
          </a>
        )}
        <Link
          href="/login"
          className="inline-block rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-center text-sm font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
        >
          Back to sign in
        </Link>
      </div>
    </div>
  );
}

export default function AuthStatusPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 p-4 dark:bg-slate-950">
      {/* Suspense boundary is required because useSearchParams() suspends
          during static rendering — without this, next build errors out on
          this route. */}
      <Suspense>
        <AuthStatusInner />
      </Suspense>
    </div>
  );
}