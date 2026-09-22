"use client";

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ShieldAlert } from "lucide-react";
import { useMe } from "@/lib/auth-hooks";
import { getPlatformToken } from "@/lib/auth-storage";
import { resolveWorkspaceHref } from "@/lib/workspace";

// Both consoles are large component trees; loading each one lazily keeps the
// staff console's chunk out of a tenant member's session (and vice versa) and
// keeps this route's initial payload small.
const PlatformConsole = dynamic(() => import("@/components/support/PlatformConsole"), {
  loading: () => <FullPageLoading />,
  ssr: false,
});
const TenantSupportConsole = dynamic(() => import("@/components/support/TenantSupportConsole"), {
  loading: () => <FullPageLoading />,
  ssr: false,
});

/**
 * The single support dashboard.
 *
 * Exactly two kinds of actor are admitted, and nothing else:
 *   A. Zoiko staff — a session issued as STAFF_CONSOLE carries a platform
 *      token; the backend only issues those to platformRole
 *      SUPPORT / SUPER_ADMIN. They get the full fleet-wide console.
 *   B. Tenant SUPPORT members — invited into a workspace by its Owner, whose
 *      session is bound to the SUPPORT workspace scope. They get the
 *      tenant-scoped console (their own workspace only).
 *
 * Anyone else signed in sees "You don't have access to the Support Dashboard."
 * instead of a silent redirect or a dead-end API error, and someone signed out
 * is sent to sign in. The same rule is enforced on the backend for every API
 * call (staff routes via requireSupportAccess, tenant routes via role checks),
 * so this page is the first gate, not the only one.
 */
export default function SupportPage() {
  const router = useRouter();
  const meQuery = useMe();
  const me = meQuery.data;
  // The platform token lives in localStorage, which does not exist during SSR.
  // Resolving it on mount keeps the first render identical to the server tree.
  const [isPlatform, setIsPlatform] = useState<boolean | null>(null);

  useEffect(() => {
    document.title = "Support | Zoiko Mail";
  }, []);

  useEffect(() => {
    setIsPlatform(Boolean(getPlatformToken()));
  }, []);

  const session = (() => {
    if (isPlatform === null) return "loading";
    if (isPlatform) return "staff";
    if (meQuery.isLoading) return "loading";
    if (!me) return "anon";
    return me.workspace === "SUPPORT" ? "member" : "denied";
  })();

  useEffect(() => {
    if (session === "anon") router.replace("/login");
  }, [session, router]);

  if (session === "staff") return <PlatformConsole />;
  if (session === "member") return <TenantSupportConsole />;

  if (session === "denied") {
    return <SupportAccessDenied role={meQuery.data?.membership?.role} />;
  }

  if (session === "anon") return null;

  return <FullPageLoading />;
}

function FullPageLoading() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-[var(--ground)]">
      <div className="flex items-center gap-2.5 text-sm text-[var(--ink3)]">
        <span className="inline-block h-5 w-5 animate-spin rounded-full border-2 border-[var(--border)] border-t-[var(--accent)]" />
        Loading…
      </div>
    </div>
  );
}

/**
 * Shown when a signed-in account that is neither staff nor a tenant SUPPORT
 * member opens the support dashboard. Renders in place so the refusal is
 * obvious rather than a puzzling bounce back to sign-in.
 */
function SupportAccessDenied({ role }: { role?: string }) {
  return (
    <div className="flex min-h-[60vh] items-center justify-center px-4 py-12">
      <div className="w-full max-w-md rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-8 text-center shadow-[var(--sh1)]">
        <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-full bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-300">
          <ShieldAlert className="h-7 w-7" aria-hidden />
        </div>
        <h2 className="text-lg font-semibold text-[var(--ink)]">
          You don&apos;t have access to the Support Dashboard.
        </h2>
        <p className="mt-2 text-sm text-[var(--ink3)]">
          The support dashboard is for the Zoiko support team and for workspace
          members holding the Support role.
          {role ? ` You are signed in as ${role.toLowerCase()}.` : ""} If you
          believe this is wrong, ask your workspace administrator.
        </p>
        <Link href={resolveWorkspaceHref(role)} className="zoiko-btn pri mt-6 inline-flex">
          Go to my workspace
        </Link>
      </div>
    </div>
  );
}