"use client";

import { Suspense } from "react";
import { OverviewPage } from "@/components/workgraph/OverviewPage";

/** /mail/work-graph — the Work Graph overview. ?stream= picks a workstream. */
export default function WorkGraphPage() {
  return (
    <Suspense>
      <OverviewPage />
    </Suspense>
  );
}
