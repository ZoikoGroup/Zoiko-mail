"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { AppShell } from "@/components/shell/AppShell";
import { ConnectedAccounts } from "@/components/connectors/ConnectedAccounts";

export default function ConnectedAccountsPage() {
  const router = useRouter();
  // This is the Track A Gmail/Microsoft 365 read-only connector — a
  // different feature from the IMAP/SMTP desktop-client setup guide the
  // new webmail design calls "Connected accounts". It's no longer in
  // member nav; webmail is the member home now. Nothing below was
  // deleted, it just isn't reachable from the UI.
  useEffect(() => { router.replace("/mail"); }, [router]);
  return (
    <AppShell>
      <ConnectedAccounts />
    </AppShell>
  );
}