"use client";

import { Suspense } from "react";
import { TasksPage } from "@/components/tasks/TasksPage";

/** /mail/tasks/from-email — From Emails. ?task=<id> opens a task. */
export default function Page() {
  return (
    <Suspense>
      <TasksPage page="from-email" />
    </Suspense>
  );
}
