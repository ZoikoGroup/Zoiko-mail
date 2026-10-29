"use client";

import { Suspense } from "react";
import { WebmailLoading } from "@/components/mail/WebmailLoading";
import { CommitmentsPage } from "@/components/workgraph/CommitmentsPage";

/** /mail/work-graph/commitments — Commitments & Follow-ups. ?tab=mine|awaiting|suggested, ?id= selects one. */
export default function WorkGraphCommitmentsPage() {
  return (
    <Suspense fallback={<WebmailLoading />}>
      <CommitmentsPage />
    </Suspense>
  );
}
