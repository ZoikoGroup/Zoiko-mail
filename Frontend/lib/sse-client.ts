"use client";

import { useEffect, useRef, useSyncExternalStore } from "react";
import { ACCESS_KEY, TOKENS_CHANGED_EVENT, getAccessToken } from "./auth-storage";
import { refreshAccessToken } from "./api-client";
import { API_BASE } from "./config";

// ── Event Types (mirror backend SSEEventType) ─────────────────────────────────

export type SSEEventType =
  | "CONNECTED"
  | "NEW_MAIL"
  | "UNREAD_COUNT"
  | "AI_EXTRACTION_DONE"
  | "AI_DRAFT_READY"
  | "NOTIFICATION"
  | "JOB_COMPLETED"
  | "PING";

export interface SSEEvent {
  type: SSEEventType;
  tenantId?: string;
  userId?: string;
  payload?: {
    count?: number;
    folder?: string;
    actionCount?: number;
    messageId?: string;
    draftId?: string;
    aiActionId?: string;
    subject?: string;
    title?: string;
    body?: string;
  };
  timestamp: string;
}

export type SSEHandler = (event: SSEEvent) => void;

export interface SSEOptions {
  /**
   * Called when the stream opens again after having been down. Events sent
   * while it was down are gone, so this is where to re-read what they would
   * have announced.
   */
  onReconnect?: () => void;
}

// ── Connection status (read by the fallback polling in mail-hooks) ───────────

export type SSEStatus = "idle" | "connecting" | "open" | "down";

let status: SSEStatus = "idle";
const listeners = new Set<() => void>();
function setStatus(next: SSEStatus) {
  if (status === next) return;
  status = next;
  listeners.forEach((listener) => listener());
}

/** Whether the live stream is up right now. */
export function getSSEStatus(): SSEStatus {
  return status;
}

export function useSSEStatus(): SSEStatus {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => status,
    () => "idle"
  );
}

// ── Tokens ────────────────────────────────────────────────────────────────────

interface TokenClaims {
  sub?: string;
  tenantId?: string;
  sid?: string;
  exp?: number;
}

function claimsOf(token: string | null): TokenClaims | null {
  if (!token) return null;
  try {
    const part = token.split(".")[1];
    const json = atob(part.replace(/-/g, "+").replace(/_/g, "/"));
    return JSON.parse(json) as TokenClaims;
  } catch {
    return null;
  }
}

/** Who a token speaks for: the same person in the same workspace and sign-in. */
export function tokenIdentity(token: string | null): string | null {
  const claims = claimsOf(token);
  return claims?.sub ? `${claims.sub}|${claims.tenantId ?? ""}|${claims.sid ?? ""}` : null;
}

/** Expired, or about to be: the stream would be refused, so refresh first. */
function expiresSoon(token: string): boolean {
  const exp = claimsOf(token)?.exp;
  return typeof exp === "number" && exp * 1000 - Date.now() < 30_000;
}

// ── Hook ──────────────────────────────────────────────────────────────────────

const EVENT_TYPES: SSEEventType[] = [
  "CONNECTED", "NEW_MAIL", "UNREAD_COUNT",
  "AI_EXTRACTION_DONE", "AI_DRAFT_READY",
  "NOTIFICATION", "JOB_COMPLETED", "PING",
];

/** The server pings every 30s. Silence for this long means a dead connection
 * that never reported an error — a proxy or a sleeping laptop can leave one. */
const SILENCE_LIMIT_MS = 75_000;
const MIN_DELAY_MS = 1_000;
const MAX_DELAY_MS = 30_000;

/**
 * Opens a persistent SSE connection to the backend.
 * Call once at the top of your app (in the shell).
 * Pass handlers for each event type you care about.
 *
 * The stream is authenticated once, when it opens, so it is opened again
 * whenever that stops being right: when the signed-in account changes (in
 * this tab or another), when it drops, and when it goes silent. A token about
 * to expire is refreshed before connecting rather than sent to be refused.
 * Reconnects back off exponentially with jitter, and happen at once when the
 * browser comes back online or the tab becomes visible again.
 */
export function useSSE(handlers: Partial<Record<SSEEventType, SSEHandler>>, options: SSEOptions = {}) {
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers; // always use latest handlers without re-running effect
  const optionsRef = useRef(options);
  optionsRef.current = options;

  useEffect(() => {
    let es: EventSource | null = null;
    let identity: string | null = null;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    let silenceTimer: ReturnType<typeof setTimeout> | undefined;
    let delay = MIN_DELAY_MS;
    let hasOpened = false;
    let missedSomething = false;
    let disposed = false;
    let generation = 0;

    const close = () => {
      generation += 1;
      clearTimeout(silenceTimer);
      if (es) {
        es.close();
        es = null;
      }
    };

    const scheduleRetry = () => {
      clearTimeout(retryTimer);
      if (disposed) return;
      // Offline, retrying is pointless; the online event reconnects.
      if (typeof navigator !== "undefined" && navigator.onLine === false) return;
      // Jitter, so a server restart isn't met by every tab at the same instant.
      const wait = delay / 2 + Math.random() * (delay / 2);
      delay = Math.min(delay * 2, MAX_DELAY_MS);
      retryTimer = setTimeout(() => void connect(), wait);
    };

    const fail = () => {
      close();
      if (hasOpened) missedSomething = true;
      setStatus("down");
      scheduleRetry();
    };

    const heardFrom = (mine: number) => {
      if (mine !== generation) return;
      clearTimeout(silenceTimer);
      silenceTimer = setTimeout(() => {
        if (mine === generation) fail();
      }, SILENCE_LIMIT_MS);
    };

    const connect = async () => {
      clearTimeout(retryTimer);
      close();
      if (disposed) return;
      let token = getAccessToken();
      if (!token) {
        // Signed out: nothing to listen for until a token appears.
        identity = null;
        setStatus("idle");
        return;
      }
      setStatus("connecting");
      if (expiresSoon(token)) {
        const refreshed = await refreshAccessToken();
        if (disposed) return;
        token = getAccessToken();
        if (!refreshed || !token) {
          // The session can't be renewed; the next API call will end it.
          fail();
          return;
        }
      }
      identity = tokenIdentity(token);
      const mine = generation;
      const source = new EventSource(`${API_BASE}/events/stream?token=${encodeURIComponent(token)}`);
      es = source;

      for (const type of EVENT_TYPES) {
        source.addEventListener(type, (e: MessageEvent) => {
          if (mine !== generation) return; // a stream already replaced
          heardFrom(mine);
          if (type === "PING") return; // heartbeat only
          if (type === "CONNECTED") {
            delay = MIN_DELAY_MS;
            setStatus("open");
            if (missedSomething) {
              missedSomething = false;
              optionsRef.current.onReconnect?.();
            }
            hasOpened = true;
          }
          try {
            const data: SSEEvent = JSON.parse(e.data);
            handlersRef.current[type]?.(data);
          } catch {
            // Malformed event — ignore
          }
        });
      }

      // EventSource would retry on its own, but with the token it was built
      // with — which may be the one that just expired. Retry here instead.
      source.onerror = () => {
        if (mine === generation) fail();
      };
      heardFrom(mine);
    };

    // The account changed, in this tab (sign-in, refresh, sign-out) or another.
    const onTokens = () => {
      const token = getAccessToken();
      const next = tokenIdentity(token);
      if (!token) {
        close();
        identity = null;
        setStatus("idle");
        return;
      }
      if (next !== identity || status !== "open") {
        delay = MIN_DELAY_MS;
        if (next !== identity) hasOpened = false;
        void connect();
      }
    };
    const onStorage = (event: StorageEvent) => {
      if (event.key === null || event.key === ACCESS_KEY) onTokens();
    };
    const reconnectNow = () => {
      if (status === "open" || !getAccessToken()) return;
      delay = MIN_DELAY_MS;
      void connect();
    };
    const onVisible = () => {
      if (document.visibilityState === "visible") reconnectNow();
    };
    // A dropped network rarely errors the open connection; it just goes
    // quiet. So going offline counts as down, and coming back always opens a
    // fresh stream and re-reads what was missed — even if the old one still
    // looks open.
    const onOffline = () => {
      if (!es) return;
      close();
      if (hasOpened) missedSomething = true;
      setStatus("down");
    };
    const onOnline = () => {
      if (!getAccessToken()) return;
      if (hasOpened) missedSomething = true;
      delay = MIN_DELAY_MS;
      void connect();
    };

    window.addEventListener(TOKENS_CHANGED_EVENT, onTokens);
    window.addEventListener("storage", onStorage);
    window.addEventListener("offline", onOffline);
    window.addEventListener("online", onOnline);
    document.addEventListener("visibilitychange", onVisible);
    void connect();

    return () => {
      disposed = true;
      clearTimeout(retryTimer);
      close();
      setStatus("idle");
      window.removeEventListener(TOKENS_CHANGED_EVENT, onTokens);
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("offline", onOffline);
      window.removeEventListener("online", onOnline);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);
}
