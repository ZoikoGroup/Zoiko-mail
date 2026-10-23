"use client";

import { Suspense } from "react";
import { TemplatesPage } from "@/components/calendar/TemplatesPage";

/** /mail/calendar/templates — Meeting Templates. ?tab=mine|team|review opens a tab; ?template= selects one. */
export default function CalendarTemplatesPage() {
  return (
    <Suspense>
      <TemplatesPage />
    </Suspense>
  );
}
