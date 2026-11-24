import type { Response } from "express";
import { logger } from "../../config/logger.js";

// ── Event Types ───────────────────────────────────────────────────────────────

export type SSEEventType =
  | "NEW_MAIL"
  | "UNREAD_COUNT"
  | "AI_EXTRACTION_DONE"
  | "AI_DRAFT_READY"
  | "NOTIFICATION"
  | "TASK_UPDATED"
  | "JOB_COMPLETED"
  | "PING";

export interface SSEEvent {
  type: SSEEventType;
  tenantId?: string;
  userId?: string;
  payload?: Record<string, unknown>;
  timestamp: string;
}

// ── Client ────────────────────────────────────────────────────────────────────

interface SSEClient {
  userId: string;
  tenantId: string;
  /** The sign-in that opened this stream, so ending that session can end it. */
  sessionId: string | null;
  res: Response;
  connectedAt: Date;
}

// ── Manager ───────────────────────────────────────────────────────────────────

class SSEManager {
  /**
   * Map of userId → Set of SSEClient.
   * One user can have multiple open tabs, so we store a Set per userId.
   */
  private clients = new Map<string, Set<SSEClient>>();

  /**
   * Register a new SSE client connection.
   * Returns a cleanup function — call it when the connection closes.
   */
  addClient(userId: string, tenantId: string, res: Response, sessionId: string | null = null): () => void {
    const client: SSEClient = { userId, tenantId, sessionId, res, connectedAt: new Date() };

    if (!this.clients.has(userId)) {
      this.clients.set(userId, new Set());
    }
    this.clients.get(userId)!.add(client);

    logger.info({ userId, tenantId, total: this.totalConnections() }, "SSE client connected");

    // Return cleanup function
    return () => {
      const set = this.clients.get(userId);
      if (set) {
        set.delete(client);
        if (set.size === 0) this.clients.delete(userId);
      }
      logger.info({ userId, total: this.totalConnections() }, "SSE client disconnected");
    };
  }

  /**
   * Send an event to all connections for a specific user.
   *
   * An event that names a workspace goes only to that user's streams for
   * that workspace. One person can belong to several, each signed in with its
   * own session, and mail for one is not the other's business — the event
   * carries a message id and the refetch it triggers would be wasted anyway.
   */
  sendToUser(userId: string, event: Omit<SSEEvent, "timestamp">): void {
    const set = this.clients.get(userId);
    if (!set || set.size === 0) return;

    const message = this.format({ ...event, timestamp: new Date().toISOString() });
    for (const client of set) {
      if (event.tenantId && client.tenantId !== event.tenantId) continue;
      this.writeToClient(client, message);
    }
  }

  /**
   * Send an event to all connections within a tenant.
   * Useful for workspace-wide events (e.g. new shared mailbox message).
   */
  sendToTenant(tenantId: string, event: Omit<SSEEvent, "timestamp">): void {
    const message = this.format({ ...event, timestamp: new Date().toISOString() });
    for (const [, set] of this.clients) {
      for (const client of set) {
        if (client.tenantId === tenantId) {
          this.writeToClient(client, message);
        }
      }
    }
  }

  /**
   * Send a heartbeat ping to all connected clients to keep connections alive.
   * Call this every 30 seconds from the server.
   */
  ping(): void {
    const message = this.format({ type: "PING", timestamp: new Date().toISOString() });
    for (const [, set] of this.clients) {
      for (const client of set) {
        this.writeToClient(client, message);
      }
    }
  }

  /**
   * Close the open streams of sessions that were just ended (P1, ZMT-18).
   *
   * A stream is authorised once, when it opens, so without this a signed-out
   * device kept receiving new-mail notifications for as long as the tab
   * stayed open. Closing it makes the browser reconnect, and the reconnect is
   * checked like any request: a live session gets its stream back, an ended
   * one is refused.
   *
   * `sessionId` ends one session's streams; `exceptSessionId` ends all but
   * one (a password change keeps the device that made it). This instance's
   * streams only: with several API instances each must be told.
   */
  endSessions(match: { userId: string; tenantId: string; sessionId?: string | null; exceptSessionId?: string | null }): number {
    const set = this.clients.get(match.userId);
    if (!set) return 0;
    let ended = 0;
    for (const client of [...set]) {
      if (client.tenantId !== match.tenantId) continue;
      if (match.sessionId && client.sessionId !== match.sessionId) continue;
      if (match.exceptSessionId && client.sessionId === match.exceptSessionId) continue;
      set.delete(client);
      ended++;
      try {
        client.res.end();
      } catch {
        // Already gone; nothing to close.
      }
    }
    if (set.size === 0) this.clients.delete(match.userId);
    if (ended) logger.info({ userId: match.userId, ended }, "SSE streams closed for ended sessions");
    return ended;
  }

  totalConnections(): number {
    let total = 0;
    for (const set of this.clients.values()) total += set.size;
    return total;
  }

  /**
   * Force-flush a write past any buffering middleware (gzip, compression).
   * SSE requires bytes to reach the browser immediately.
   */
  private writeToClient(client: SSEClient, message: string): void {
    try {
      client.res.write(message);
      if (typeof (client.res as any).flush === "function") {
        (client.res as any).flush();
      }
    } catch {
      // Connection closed — cleanup happens via the close event
    }
  }

  /**
   * Format an SSE event as per the SSE spec:
   * event: <type>\n
   * data: <json>\n\n
   */
  private format(event: SSEEvent): string {
    return `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
  }
}

// Singleton — one SSE manager for the whole process
export const sseManager = new SSEManager();