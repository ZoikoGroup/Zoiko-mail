"use client";

import { RouteError } from "@/components/ui/RouteError";

// Inside the owner console's frame: the sidebar stays usable.
export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <RouteError error={error} reset={reset} />;
}
