"use client";

import { RouteError } from "@/components/ui/RouteError";

// Any screen that throws while rendering, outside the admin and owner
// consoles (which have their own boundary inside their shell).
export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <RouteError error={error} reset={reset} fullScreen />;
}
