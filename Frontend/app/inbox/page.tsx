"use client";

import { useEffect, useState } from "react";
import { AppShell } from "@/components/shell/AppShell";
import { AiActionsInbox } from "@/components/inbox/AiActionsInbox";
import { ActionInbox } from "@/components/inbox/ActionInbox";
import { Tabs } from "@/components/ui/Tabs";

type Tab = "actions" | "commitments";

export default function InboxPage() {
  const [tab, setTab] = useState<Tab>("actions");

  useEffect(() => { document.title = "Inbox | Zoiko Mail"; }, []);

  return (
    <AppShell>
      <div className="mx-auto max-w-3xl border-b border-[var(--border)] px-4 pt-4 sm:px-6">
        <Tabs
          tabs={[
            { id: "actions", label: "Actions" },
            { id: "commitments", label: "Commitments" },
          ]}
          active={tab}
          onChange={(id) => setTab(id as Tab)}
        />
      </div>
      {tab === "actions" ? <AiActionsInbox /> : <ActionInbox />}
    </AppShell>
  );
}