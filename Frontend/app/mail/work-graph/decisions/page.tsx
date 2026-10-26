"use client";

import { Suspense } from "react";
import { DecisionsPage } from "@/components/workgraph/DecisionsPage";

/** /mail/work-graph/decisions — Decisions & Dependencies. ?tab=awaiting|approved|dependencies|suggested, ?id= selects one. */
export default function WorkGraphDecisionsPage() {
  return (
    <Suspense>
      <DecisionsPage />
    </Suspense>
  );
}
