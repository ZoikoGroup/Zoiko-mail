"use client";

import { Suspense } from "react";
import { DecisionsPage } from "@/components/workgraph/DecisionsPage";

/** /mail/work-graph/dependencies — the Dependencies tab of Decisions & Dependencies. */
export default function WorkGraphDependenciesPage() {
  return (
    <Suspense>
      <DecisionsPage initialTab="dependencies" />
    </Suspense>
  );
}
