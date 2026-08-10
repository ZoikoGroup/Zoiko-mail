"use client";

import { AppShell } from "@/components/shell/AppShell";
import { ConnectedAccounts } from "@/components/connectors/ConnectedAccounts";

export default function ConnectedAccountsPage() {
  return (
    <AppShell>
      <ConnectedAccounts />
    </AppShell>
  );
}