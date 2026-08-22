"use client";

import Link from "next/link";
import { ShieldAlert } from "lucide-react";
import { resolveWorkspaceHref } from "@/lib/workspace";

interface AccessDeniedProps {
  /** Role the signed-in user actually holds — shown for context and used
   *  to send them back to a dashboard they can see. */
  role?: string;
  /** Human name of the area that was requested, e.g. "owner" or "admin". */
  dashboard?: string;
}

/**
 * Full-page warning shown when an authenticated account opens a dashboard
 * its membership role does not grant access to. Renders in place — no silent
 * redirect — so it is obvious why the requested content is not shown.
 */
export function AccessDenied({ role, dashboard }: AccessDeniedProps) {
  return (
    <div className="flex min-h-[60vh] items-center justify-center px-4 py-12">
      <div className="w-full max-w-md rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-8 text-center shadow-[var(--sh1)]">
        <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-full bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-300">
          <ShieldAlert className="h-7 w-7" aria-hidden />
        </div>
        <h2 className="text-lg font-semibold text-[var(--ink)]">
          You have no access to see this
        </h2>
        <p className="mt-2 text-sm text-[var(--ink3)]">
          {dashboard
            ? `This area belongs to the ${dashboard} workspace.`
            : "This dashboard is restricted."}{" "}
          {role
            ? `You are signed in as ${role.toLowerCase()}. `
            : ""}
          Ask an administrator if you believe you should have access.
        </p>
        <Link href={resolveWorkspaceHref(role)} className="zoiko-btn pri mt-6 inline-flex">
          Go to my workspace
        </Link>
      </div>
    </div>
  );
}
