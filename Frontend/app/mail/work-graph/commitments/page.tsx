"use client";

import { Suspense } from "react";
import { CommitmentsPage } from "@/components/workgraph/CommitmentsPage";

/** /mail/work-graph/commitments — Commitments & Follow-ups. ?tab=mine|awaiting|suggested, ?id= selects one. */
export default function WorkGraphCommitmentsPage() {
  return (
    <Suspense>
      <CommitmentsPage />
    </Suspense>
  );
}
