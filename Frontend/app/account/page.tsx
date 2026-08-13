// "use client";

// import { AppShell } from "@/components/shell/AppShell";
// import { ChangePasswordForm } from "@/components/auth";


// export default function AccountPage() {
//   return (
//     <AppShell>
//       <div className="mx-auto max-w-xl px-4 py-8 sm:px-6">
//         <h1 className="font-serif text-2xl font-semibold text-slate-900">Security</h1>
//         <p className="mt-1 text-sm text-slate-500">Change your password.</p>
//         <div className="mt-6 rounded-xl border border-slate-200 bg-white p-6">
//           <ChangePasswordForm />
//         </div>
//       </div>
//     </AppShell>
//   );
// }

"use client";

import { AppShell } from "@/components/shell/AppShell";
import { ChangePasswordForm } from "@/components/auth";
import { Avatar, RoleBadge } from "@/components/home/HomeBits";
import { useMe } from "@/lib/auth-hooks";
import type { MeResponse } from "@/lib/auth-api";
import { KeyRound, ShieldCheck, Fingerprint } from "lucide-react";

export default function AccountPage() {
  const { data } = useMe();
  const me = data as MeResponse | undefined;

  return (
    <AppShell>
      <div className="mx-auto max-w-2xl px-4 py-8 sm:px-6">
        <h1 className="font-editorial text-2xl sm:text-3xl font-normal tracking-tight text-[var(--ink)]">
          Profile
        </h1>
        <p className="mt-1 text-sm text-[var(--ink3)]">
          Your account details and sign-in security.
        </p>

        {/* Identity */}
        <div className="zoiko-card mt-6 p-6">
          <div className="flex items-center gap-4">
            <Avatar name={me?.displayName} email={me?.email} />
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="truncate text-lg font-semibold text-[var(--ink)]">
                  {me?.displayName ?? "—"}
                </span>
                {me && <RoleBadge role={me.membership.role} />}
              </div>
              <div className="truncate text-sm text-[var(--ink3)]">{me?.email ?? "—"}</div>
            </div>
          </div>

          <dl className="mt-6 grid grid-cols-1 gap-px overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--border)] sm:grid-cols-3">
            <Detail label="Workspace" value={me?.tenant.name ?? "—"} />
            <Detail label="Role" value={me?.membership.role ?? "—"} />
            <Detail label="Plan" value={me?.tenant.planCode ?? "—"} />
          </dl>
        </div>

        {/* Security */}
        <h2 className="font-mono-num mt-10 text-[11px] font-semibold uppercase tracking-wider text-[var(--ink3)]">
          Security
        </h2>

        <div className="zoiko-card mt-3 divide-y divide-[var(--border)]">
          <SecurityRow
            icon={ShieldCheck}
            title="Two-factor authentication"
            desc="Add a second step at sign-in for extra protection."
            status="Not configured"
            actionLabel="Set up"
            soon
          />
          <SecurityRow
            icon={Fingerprint}
            title="ZoikoID"
            desc="Link your ZoikoID for single sign-on across Zoiko."
            status="Not linked"
            actionLabel="Link"
            soon
          />
        </div>

        {/* Password */}
        <h2 className="font-mono-num mt-10 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-[var(--ink3)]">
          <KeyRound className="h-3.5 w-3.5" /> Password
        </h2>
        <div className="zoiko-card mt-3 p-6">
          <ChangePasswordForm />
        </div>
      </div>
    </AppShell>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-[var(--surface)] p-4">
      <dt className="font-mono-num text-[10px] font-medium uppercase tracking-wider text-[var(--ink3)]">
        {label}
      </dt>
      <dd className="mt-1 truncate text-sm font-medium text-[var(--ink)]">{value}</dd>
    </div>
  );
}

function SecurityRow({
  icon: Icon,
  title,
  desc,
  status,
  actionLabel,
  soon,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  desc: string;
  status: string;
  actionLabel: string;
  soon?: boolean;
}) {
  return (
    <div className="flex items-center gap-4 p-5">
      <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[var(--s3)] text-[var(--ink2)]">
        <Icon className="h-5 w-5" />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-[var(--ink)]">{title}</span>
          <span className="zoiko-pill nu">{status}</span>
        </div>
        <p className="mt-0.5 text-xs text-[var(--ink3)]">{desc}</p>
      </div>
      <button className="zoiko-btn sm shrink-0 disabled:opacity-50" disabled={soon} title={soon ? "Coming soon" : undefined}>
        {actionLabel}
        {soon && <span className="zoiko-pill nu ml-1">Soon</span>}
      </button>
    </div>
  );
}