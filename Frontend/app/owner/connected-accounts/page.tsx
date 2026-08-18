"use client";

import { ProtectedRoute } from "@/components/owner/ProtectedRoute";
import { PageHeader } from "@/components/ui/PageHeader";
import { ConnectedAccountsTable } from "@/components/owner/connected-accounts/ConnectedAccountsTable";
import { Link2 } from "lucide-react";

export default function OwnerConnectedAccountsPage() {
  return (
    <ProtectedRoute>
      <div className="mx-auto max-w-6xl space-y-6 px-4 py-8 sm:px-6">
        <PageHeader
          title="Connected Accounts"
          description="Manage Gmail and Microsoft 365 connections across your team."
          actions={
            <button className="zoiko-btn pri">
              <Link2 className="h-3.5 w-3.5" />
              Connect Account
            </button>
          }
        />
        <ConnectedAccountsTable />
      </div>
    </ProtectedRoute>
  );
}
