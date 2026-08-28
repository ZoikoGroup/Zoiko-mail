"use client";

import { useState } from "react";
import { ProtectedRoute } from "@/components/owner/ProtectedRoute";
import { PageHeader } from "@/components/ui/PageHeader";
import { ConnectedAccountsTable } from "@/components/owner/connected-accounts/ConnectedAccountsTable";
import { useConnectors } from "@/lib/owner-hooks";
import { useGoogleAuth } from "@/lib/connectors-hooks";
import { Link2, Loader2, AlertCircle } from "lucide-react";

export default function OwnerConnectedAccountsPage() {
  const { data: connectors = [], isLoading } = useConnectors();
  const googleAuth = useGoogleAuth();
  const [authError, setAuthError] = useState<string | null>(null);

  const handleConnectGoogle = () => {
    setAuthError(null);
    googleAuth.mutate(undefined, {
      onSuccess: (data) => {
        window.location.href = data.url;
      },
      onError: (err: any) => {
        const msg = err?.message || "Failed to start Google OAuth. Make sure GOOGLE_CLIENT_ID is configured in the backend .env.";
        setAuthError(msg);
      },
    });
  };

  return (
    <ProtectedRoute>
      <div className="mx-auto max-w-6xl space-y-6 px-4 py-8 sm:px-6">
        <PageHeader
          title="Connected Accounts"
          description="Manage Gmail and Microsoft 365 connections across your team."
          actions={
            <button
              className="zoiko-btn pri"
              onClick={handleConnectGoogle}
              disabled={googleAuth.isPending}
            >
              {googleAuth.isPending ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Link2 className="h-3.5 w-3.5" />
              )}
              Connect Gmail Account
            </button>
          }
        />
        {authError && (
          <div className="flex items-start gap-2 rounded-lg border border-[var(--crit)]/30 bg-[var(--crit-soft)] p-4 text-sm text-[var(--crit)]">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{authError}</span>
          </div>
        )}
        <ConnectedAccountsTable />
        <div className="rounded-lg border border-[var(--border)] bg-[var(--s2)] p-4">
          <p className="text-sm text-[var(--ink3)]">
            To connect a new account, users can do so from their{" "}
            <a href="/connected-accounts" className="text-[var(--accent)] hover:underline">
              personal connected accounts page
            </a>.
            Organization-level OAuth connection is coming soon.
          </p>
        </div>
      </div>
    </ProtectedRoute>
  );
}
