"use client";

import { Suspense } from "react";
import { TasksPage } from "@/components/tasks/TasksPage";

/** /mail/tasks — My Tasks. ?task=<id> opens a task. */
export default function Page() {
  return (
    <Suspense>
      <TasksPage page="my" />
    </Suspense>
  );
}
