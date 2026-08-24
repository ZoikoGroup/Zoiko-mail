"use client";

import { useState, useEffect } from "react";
import { ProtectedRoute } from "@/components/owner/ProtectedRoute";
import { PageHeader } from "@/components/ui/PageHeader";
import { Skeleton } from "@/components/ui/Skeleton";
import { useMe, useChangePassword } from "@/lib/auth-hooks";
import type { MeResponse } from "@/lib/auth-api";
import { Save, Lock, Mail } from "lucide-react";

function initials(name?: string, email?: string) {
  const base = (name?.trim() || email || "?").trim();
  const parts = base.split(/\s+/);
  return (parts.length >= 2 ? parts[0][0] + parts[1][0] : base.slice(0, 2)).toUpperCase();
}

export default function ProfilePage() {
  const { data, isLoading, error } = useMe();
  const me = data as MeResponse | undefined;
  const changePassword = useChangePassword();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [pwSaved, setPwSaved] = useState(false);
  const [pwError, setPwError] = useState("");

  useEffect(() => {
    if (changePassword.isError) {
      setPwError(changePassword.error?.message || "Failed to update password.");
    }
  }, [changePassword.isError, changePassword.error]);

  const handlePasswordChange = () => {
    setPwError("");
    if (!currentPassword || !newPassword || newPassword !== confirmPassword) return;
    changePassword.mutate(
      { currentPassword, newPassword },
      {
        onSuccess: () => {
          setPwSaved(true);
          setCurrentPassword("");
          setNewPassword("");
          setConfirmPassword("");
          setTimeout(() => setPwSaved(false), 3000);
        },
      }
    );
  };

  if (isLoading) {
    return (
      <ProtectedRoute>
        <div className="mx-auto max-w-3xl space-y-6 px-4 py-8 sm:px-6">
          <PageHeader title="Profile" description="Manage your personal account settings." />
          <div className="zoiko-card p-6">
            <div className="flex items-center gap-4 mb-6">
              <Skeleton variant="circle" className="h-16 w-16" />
              <div className="space-y-2">
                <Skeleton className="h-5 w-40" />
                <Skeleton className="h-4 w-56" />
                <Skeleton className="h-5 w-16 rounded-full" />
              </div>
            </div>
          </div>
          <div className="zoiko-card p-6">
            <Skeleton className="h-5 w-32 mb-4" />
            <div className="space-y-4 max-w-sm">
              <Skeleton className="h-9 w-full" />
              <Skeleton className="h-9 w-full" />
              <Skeleton className="h-9 w-full" />
            </div>
          </div>
        </div>
      </ProtectedRoute>
    );
  }

  if (error) {
    return (
      <ProtectedRoute>
        <div className="mx-auto max-w-3xl space-y-6 px-4 py-8 sm:px-6">
          <PageHeader title="Profile" description="Manage your personal account settings." />
          <div className="zoiko-card p-6 text-center">
            <p className="text-sm text-[var(--crit)]">Failed to load profile. Please try again.</p>
          </div>
        </div>
      </ProtectedRoute>
    );
  }

  return (
    <ProtectedRoute>
      <div className="mx-auto max-w-3xl space-y-6 px-4 py-8 sm:px-6">
        <PageHeader
          title="Profile"
          description="Manage your personal account settings."
        />

        {/* Profile Info */}
        <div className="zoiko-card p-6">
          <div className="flex items-center gap-4 mb-6">
            <span className="inline-flex h-16 w-16 items-center justify-center rounded-full bg-[var(--accent)] text-lg font-bold text-white">
              {initials(me?.displayName, me?.email)}
            </span>
            <div>
              <h3 className="text-base font-semibold text-[var(--ink)]">{me?.displayName ?? "—"}</h3>
              <div className="flex items-center gap-2 text-sm text-[var(--ink3)]">
                <Mail className="h-3.5 w-3.5" />
                {me?.email ?? "—"}
              </div>
              <div className="mt-1">
                <span className="zoiko-pill accent">{me?.membership.role ?? "—"}</span>
              </div>
            </div>
          </div>
        </div>

        {/* Change Password */}
        <div className="zoiko-card p-6">
          <div className="flex items-center gap-3 mb-6">
            <span className="inline-flex h-10 w-10 items-center justify-center rounded-lg bg-[var(--warn-soft)] text-[var(--warn)]">
              <Lock className="h-5 w-5" />
            </span>
            <div>
              <h3 className="text-sm font-semibold text-[var(--ink)]">Change Password</h3>
              <p className="text-[11px] text-[var(--ink3)]">Update your account password.</p>
            </div>
          </div>

          <div className="space-y-4 max-w-sm">
            <div>
              <label className="mb-1 block text-sm font-medium text-[var(--ink2)]">Current Password</label>
              <input
                type="password"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                className="h-9 w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 text-sm text-[var(--ink)] focus:border-[var(--accent)] focus:outline-none focus:ring-1 focus:ring-[var(--accent)]"
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-[var(--ink2)]">New Password</label>
              <input
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                className="h-9 w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 text-sm text-[var(--ink)] focus:border-[var(--accent)] focus:outline-none focus:ring-1 focus:ring-[var(--accent)]"
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-[var(--ink2)]">Confirm New Password</label>
              <input
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                className="h-9 w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 text-sm text-[var(--ink)] focus:border-[var(--accent)] focus:outline-none focus:ring-1 focus:ring-[var(--accent)]"
              />
              {newPassword && confirmPassword && newPassword !== confirmPassword && (
                <p className="mt-1 text-[11px] text-[var(--crit)]">Passwords do not match.</p>
              )}
            </div>
          </div>

          <div className="mt-4 flex items-center gap-3">
            <button
              onClick={handlePasswordChange}
              disabled={changePassword.isPending || !currentPassword || !newPassword || newPassword !== confirmPassword}
              className="zoiko-btn pri"
            >
              <Save className="h-3.5 w-3.5" />
              {changePassword.isPending ? "Updating…" : "Update Password"}
            </button>
            {pwSaved && <span className="text-xs text-[var(--ok)]">Password updated successfully.</span>}
            {pwError && <span className="text-xs text-[var(--crit)]">{pwError}</span>}
          </div>
        </div>
      </div>
    </ProtectedRoute>
  );
}
