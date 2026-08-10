"use client";

import { AppShell } from "@/components/shell/AppShell";
import { ChangePasswordForm } from "@/components/auth";

// Reuses your existing ChangePasswordForm (calls POST /auth/change-password).
export default function AccountPage() {
  return (
    <AppShell>
      <div className="mx-auto max-w-xl px-4 py-8 sm:px-6">
        <h1 className="font-serif text-2xl font-semibold text-slate-900">Security</h1>
        <p className="mt-1 text-sm text-slate-500">Change your password.</p>
        <div className="mt-6 rounded-xl border border-slate-200 bg-white p-6">
          <ChangePasswordForm />
        </div>
      </div>
    </AppShell>
  );
}