"use client";

import { Suspense } from "react";
import { TasksPage } from "@/components/tasks/TasksPage";

/** /mail/tasks/following — Following. ?task=<id> opens a task. */
export default function Page() {
  return (
    <Suspense>
      <TasksPage page="following" />
    </Suspense>
  );
}
