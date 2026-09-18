"use client";

import { useEffect, useState, useCallback } from "react";
import { WifiOff, RefreshCw, X } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";

// ── Hook ─────────────────────────────────────────────────────────────────────

/**
 * Tracks browser online/offline state and detects when the connection
 * comes back after being lost. Returns:
 *
 * - `isOnline`     — current navigator.onLine status
 * - `wasOffline`   — true for 5 seconds after reconnection (shows "Back online" toast)
 * - `dismiss`      — manually dismiss the reconnect banner
 */
export function useNetworkStatus() {
  const [isOnline, setIsOnline] = useState(true);
  const [wasOffline, setWasOffline] = useState(false);

  useEffect(() => {
    // Set initial state (SSR safe)
    setIsOnline(navigator.onLine);

    const goOffline = () => setIsOnline(false);
    const goOnline = () => {
      setIsOnline(true);
      setWasOffline(true);
    };

    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);
    return () => {
      window.removeEventListener("online", goOnline);
      window.removeEventListener("offline", goOffline);
    };
  }, []);

  // Auto-dismiss "back online" after 5s
  useEffect(() => {
    if (!wasOffline) return;
    const t = setTimeout(() => setWasOffline(false), 5000);
    return () => clearTimeout(t);
  }, [wasOffline]);

  const dismiss = useCallback(() => setWasOffline(false), []);

  return { isOnline, wasOffline, dismiss };
}

// ── Banner Component ─────────────────────────────────────────────────────────

/**
 * Drop this into your AppShell layout. It shows:
 * - A sticky red banner when offline ("You're offline")
 * - A brief green banner when reconnection is detected ("Back online")
 * - Nothing when everything is normal
 *
 * On reconnection, it auto-refetches all stale React Query caches.
 */
export function NetworkBanner() {
  const { isOnline, wasOffline, dismiss } = useNetworkStatus();
  const qc = useQueryClient();

  // Refetch stale queries when coming back online
  useEffect(() => {
    if (isOnline && wasOffline) {
      qc.refetchQueries({ type: "active", stale: true });
    }
  }, [isOnline, wasOffline, qc]);

  if (isOnline && !wasOffline) return null;

  if (!isOnline) {
    return (
      <div className="sticky top-0 z-50 flex items-center justify-center gap-2 bg-[var(--crit)] px-4 py-2 text-sm font-medium text-white">
        <WifiOff className="h-4 w-4" />
        <span>You&rsquo;re offline. Changes won&rsquo;t be saved until you reconnect.</span>
      </div>
    );
  }

  // wasOffline && isOnline → just reconnected
  return (
    <div className="sticky top-0 z-50 flex items-center justify-center gap-2 bg-[var(--ok)] px-4 py-2 text-sm font-medium text-white animate-in fade-in duration-300">
      <RefreshCw className="h-4 w-4" />
      <span>Back online — refreshing data…</span>
      <button onClick={dismiss} className="ml-2 rounded p-0.5 hover:bg-white/20">
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

export default NetworkBanner;