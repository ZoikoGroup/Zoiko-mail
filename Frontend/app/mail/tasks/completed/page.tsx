"use client";

import { Suspense } from "react";
import { TasksPage } from "@/components/tasks/TasksPage";

/** /mail/tasks/completed — Completed. ?task=<id> opens a task. */
export default function Page() {
  return (
    <Suspense>
      <TasksPage page="completed" />
    </Suspense>
  );
}
