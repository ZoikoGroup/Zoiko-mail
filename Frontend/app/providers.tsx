"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";

export function Providers({ children }: { children: ReactNode }) {
  // Cache tuning keeps dashboard-to-dashboard navigation fast:
  //   staleTime — 60s before a query is considered stale, so revisiting a page
  //               within that window renders straight from the cache with no
  //               loading skeleton and no refetch.
  //   gcTime    — keep cached data around for 10 minutes, so back-navigation
  //               after browsing elsewhere still shows instantly (and only
  //               refetches in the background once stale).
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 60_000,
            gcTime: 10 * 60_000,
            refetchOnWindowFocus: false,
          },
        },
      })
  );
  return (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
}