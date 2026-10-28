"use client";

import { Suspense } from "react";
import { WebmailLoading } from "@/components/mail/WebmailLoading";
import { DecisionsPage } from "@/components/workgraph/DecisionsPage";

/** /mail/work-graph/dependencies — the Dependencies tab of Decisions & Dependencies. */
export default function WorkGraphDependenciesPage() {
  return (
    <Suspense fallback={<WebmailLoading />}>
      <DecisionsPage initialTab="dependencies" />
    </Suspense>
  );
}
