"use client";

import { useEffect } from "react";
import { AppShell } from "@/components/shell/AppShell";
import { ActionInbox } from "@/components/inbox/ActionInbox";

export default function InboxPage() {
  useEffect(() => { document.title = "Inbox | Zoiko Mail"; }, []);
  return (
    <AppShell>
      <ActionInbox />
    </AppShell>
  );
}