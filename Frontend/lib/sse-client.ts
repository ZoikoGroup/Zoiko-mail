"use client";

import { useEffect, useRef, useCallback } from "react";
import { getAccessToken } from "./auth-storage";
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

// ── Hook ──────────────────────────────────────────────────────────────────────

/**
 * Opens a persistent SSE connection to the backend.
 * Call once at the top of your app (in AppShell).
 * Pass handlers for each event type you care about.
 *
 * Automatically reconnects after disconnect with exponential backoff.
 */
export function useSSE(handlers: Partial<Record<SSEEventType, SSEHandler>>) {
  const esRef = useRef<EventSource | null>(null);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectDelay = useRef(1000); // start at 1s, max 30s
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers; // always use latest handlers without re-running effect

  const connect = useCallback(() => {
    const token = getAccessToken();
    if (!token) return; // not logged in — don't connect

    // Close any existing connection first
    if (esRef.current) {
      esRef.current.close();
      esRef.current = null;
    }

    // SSE URL with token as query param (EventSource can't set headers)
    const url = `${API_BASE}/events/stream?token=${encodeURIComponent(token)}`;
    const es = new EventSource(url);
    esRef.current = es;

    // ── Handle each named event type ─────────────────────────────────────
    const eventTypes: SSEEventType[] = [
      "CONNECTED", "NEW_MAIL", "UNREAD_COUNT",
      "AI_EXTRACTION_DONE", "AI_DRAFT_READY",
      "NOTIFICATION", "JOB_COMPLETED", "PING",
    ];

    for (const type of eventTypes) {
      es.addEventListener(type, (e: MessageEvent) => {
        if (type === "PING") return; // ignore heartbeat
        try {
          const data: SSEEvent = JSON.parse(e.data);
          handlersRef.current[type]?.(data);
        } catch {
          // Malformed event — ignore
        }
      });
    }

    // ── Connection opened — reset backoff ─────────────────────────────────
    es.addEventListener("CONNECTED", () => {
      reconnectDelay.current = 1000;
    });

    // ── On error — reconnect with backoff ─────────────────────────────────
    es.onerror = () => {
      es.close();
      esRef.current = null;

      const delay = reconnectDelay.current;
      reconnectDelay.current = Math.min(delay * 2, 30_000); // cap at 30s

      reconnectTimer.current = setTimeout(() => {
        connect();
      }, delay);
    };
  }, []);

  useEffect(() => {
    connect();

    return () => {
      // Cleanup on unmount
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
      if (esRef.current) {
        esRef.current.close();
        esRef.current = null;
      }
    };
  }, [connect]);
}