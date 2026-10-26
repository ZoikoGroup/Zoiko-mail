"use client";

import { Suspense } from "react";
import { AssistantPage } from "@/components/assistant/AssistantPage";

/** /mail/alet — Alet, the AI assistant. ?c=<conversation id> opens a saved chat. */
export default function AletPage() {
  return (
    <Suspense>
      <AssistantPage />
    </Suspense>
  );
}
