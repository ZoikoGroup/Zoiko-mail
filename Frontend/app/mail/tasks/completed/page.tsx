"use client";

import { Suspense } from "react";
import { WebmailLoading } from "@/components/mail/WebmailLoading";
import { TasksPage } from "@/components/tasks/TasksPage";

/** /mail/tasks/completed — Completed. ?task=<id> opens a task. */
export default function Page() {
  return (
    <Suspense fallback={<WebmailLoading />}>
      <TasksPage page="completed" />
    </Suspense>
  );
}
