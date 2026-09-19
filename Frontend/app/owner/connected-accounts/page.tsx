"use client";

import { useState } from "react";
import { ProtectedRoute } from "@/components/owner/ProtectedRoute";
import { PageHeader } from "@/components/ui/PageHeader";
import { ConnectedAccountsTable } from "@/components/owner/connected-accounts/ConnectedAccountsTable";
import { useConnectors } from "@/lib/owner-hooks";
import { useGoogleAuth, useMicrosoftAuth } from "@/lib/connectors-hooks";
import { useCreateConnector } from "@/lib/connectors-hooks";
import type { CreateConnectorInput } from "@/lib/connectors-api";
import { Link2, Loader2, AlertCircle, Check, ExternalLink } from "lucide-react";

export default function OwnerConnectedAccountsPage() {
  const { data: connectors = [], isLoading } = useConnectors();
  const googleAuth = useGoogleAuth();
  const microsoftAuth = useMicrosoftAuth();
  const createConnector = useCreateConnector();
  const [authError, setAuthError] = useState<string | null>(null);
  const [showConnectDialog, setShowConnectDialog] = useState<{ provider: "GMAIL" | "MICROSOFT_365" } | null>(null);
  const [connectionType, setConnectionType] = useState<"personal" | "org">("org");

  const handleConnectGoogle = () => {
    setAuthError(null);
    setConnectionType("org");
    setShowConnectDialog({ provider: "GMAIL" });
  };

  const handleConnectMicrosoft = () => {
    setAuthError(null);
    setConnectionType("org");
    setShowConnectDialog({ provider: "MICROSOFT_365" });
  };

  const handleDialogConnect = () => {
    if (!showConnectDialog) return;
    const provider = showConnectDialog.provider;
    setAuthError(null);

    const scopes = provider === "GMAIL"
      ? ["https://www.googleapis.com/auth/gmail.readonly"]
      : ["Mail.Read"];

    const input: CreateConnectorInput = {
      provider,
      providerAccountId: "", // Will be filled by OAuth callback
      email: "", // Will be filled by OAuth callback
      scopes,
      isOrgLevel: connectionType === "org",
    };

    createConnector.mutate(input, {
      onSuccess: (data) => {
        setShowConnectDialog(null);
        setConnectionType("org");
        // For OAuth providers, we need to redirect to the auth URL
        if (provider === "GMAIL") {
          googleAuth.mutate(undefined, {
            onSuccess: (authData) => {
              window.location.href = authData.url;
            },
            onError: (err: any) => {
              const msg = err?.message || "Failed to start Google OAuth.";
              setAuthError(msg);
            },
          });
        } else {
          microsoftAuth.mutate(undefined, {
            onSuccess: (authData) => {
              window.location.href = authData.url;
            },
            onError: (err: any) => {
              const msg = err?.message || "Failed to start Microsoft OAuth.";
              setAuthError(msg);
            },
          });
        }
      },
      onError: (err: any) => {
        const msg = err?.message || `Failed to create ${provider} connection.`;
        setAuthError(msg);
      },
    });
  };

  const handleCloseDialog = () => {
    setShowConnectDialog(null);
    setConnectionType("org");
  };

  return (
    <ProtectedRoute>
      <div className="mx-auto max-w-6xl space-y-6 px-4 py-8 sm:px-6">
        <PageHeader
          title="Connected Accounts"
          description="Manage Gmail and Microsoft 365 connections across your team."
          actions={
            <div className="flex flex-col gap-2 sm:flex-row">
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
              <button
                className="zoiko-btn"
                onClick={handleConnectMicrosoft}
                disabled={microsoftAuth.isPending}
              >
                {microsoftAuth.isPending ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Link2 className="h-3.5 w-3.5" />
                )}
                Connect Microsoft 365 Account
              </button>
            </div>
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
            Organization-level connections can be created by Owners and Admins.
          </p>
        </div>

        {/* Connect Dialog */}
        {showConnectDialog && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
            <div className="w-full max-w-md rounded-xl border border-[var(--border)] bg-[var(--surface)] p-6 shadow-xl">
              <div className="flex items-center justify-between mb-4">
                <h2 className="font-semibold text-[var(--ink)]">
                  Connect {showConnectDialog.provider === "GMAIL" ? "Gmail" : "Microsoft 365"} Account
                </h2>
                <button
                  onClick={handleCloseDialog}
                  className="text-[var(--ink3)] hover:text-[var(--ink)]"
                  aria-label="Close"
                >
                  <ExternalLink className="h-5 w-5" />
                </button>
              </div>

              <p className="mb-5 text-sm text-[var(--ink2)]">How do you want to connect {showConnectDialog.provider === "GMAIL" ? "Gmail" : "Microsoft 365"}?</p>

              <div className="space-y-3 mb-5">
                <label className="flex items-start gap-3 cursor-pointer rounded-lg border border-[var(--border)] bg-[var(--s2)] p-3 hover:border-[var(--accent)] transition-colors">
                  <input
                    type="radio"
                    name="connectionType"
                    value="personal"
                    checked={connectionType === "personal"}
                    onChange={() => setConnectionType("personal")}
                    className="mt-1 h-4 w-4 text-[var(--accent)] border-[var(--border)] focus:ring-[var(--accent)]"
                  />
                  <div>
                    <div className="font-medium text-[var(--ink)]">Personal connection</div>
                    <div className="text-sm text-[var(--ink3)]">Connect only to your account.</div>
                  </div>
                </label>

                <label className="flex items-start gap-3 cursor-pointer rounded-lg border border-[var(--border)] bg-[var(--s2)] p-3 hover:border-[var(--accent)] transition-colors">
                  <input
                    type="radio"
                    name="connectionType"
                    value="org"
                    checked={connectionType === "org"}
                    onChange={() => setConnectionType("org")}
                    className="mt-1 h-4 w-4 text-[var(--accent)] border-[var(--border)] focus:ring-[var(--accent)]"
                  />
                  <div>
                    <div className="font-medium text-[var(--ink)]">Organization connection</div>
                    <div className="text-sm text-[var(--ink3)]">Make this connection available for your organization/workspace. Owner/Admin permissions required.</div>
                  </div>
                </label>
              </div>

              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={handleCloseDialog}
                  className="flex-1 zoiko-btn"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleDialogConnect}
                  disabled={createConnector.isPending || googleAuth.isPending || microsoftAuth.isPending}
                  className="flex-1 zoiko-btn pri"
                >
                  {createConnector.isPending ? (
                    <Loader2 className="mx-auto h-4 w-4 animate-spin" />
                  ) : (
                    `Connect ${showConnectDialog.provider === "GMAIL" ? "Gmail" : "Microsoft 365"}`
                  )}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </ProtectedRoute>
  );
}
