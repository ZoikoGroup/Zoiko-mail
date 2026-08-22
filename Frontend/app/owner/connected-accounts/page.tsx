"use client";

import { useState } from "react";
import { ProtectedRoute } from "@/components/owner/ProtectedRoute";
import { PageHeader } from "@/components/ui/PageHeader";
import { ConnectedAccountsTable } from "@/components/owner/connected-accounts/ConnectedAccountsTable";
import { useConnectors } from "@/lib/owner-hooks";
import { Link2 } from "lucide-react";

export default function OwnerConnectedAccountsPage() {
  const { data: connectors = [], isLoading } = useConnectors();
  const [showInfo, setShowInfo] = useState(false);

  return (
    <ProtectedRoute>
      <div className="mx-auto max-w-6xl space-y-6 px-4 py-8 sm:px-6">
        <PageHeader
          title="Connected Accounts"
          description="Manage Gmail and Microsoft 365 connections across your team."
          actions={
            <button
              className="zoiko-btn pri"
              disabled
              title="OAuth connection flow coming soon"
            >
              <Link2 className="h-3.5 w-3.5" />
              Connect Account
            </button>
          }
        />
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
