"use client";

import { Suspense } from "react";
import { TasksPage } from "@/components/tasks/TasksPage";

/** /mail/tasks/team/<teamId> — one team workspace (a shared mailbox). ?task=<id> opens a task. */
export default function Page({ params }: { params: { teamId: string } }) {
  return (
    <Suspense>
      {/* Keyed by team, so moving between teams starts each one fresh. */}
      <TasksPage key={params.teamId} page="team" teamId={params.teamId} />
    </Suspense>
  );
}
