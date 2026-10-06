"use client";

import { useCallback, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import {
  clearTokens,
  getPlatformToken,
  isLoggedIn,
  setSignOutNotice,
} from "@/lib/auth-storage";
import { useMe, useLogout } from "@/lib/auth-hooks";
import type { MeResponse } from "@/lib/auth-api";
import { workspaceDenialNotice } from "@/lib/workspace";
import { useSSE, type SSEEvent } from "@/lib/sse-client";
import { useToast } from "@/components/ui/Toast";

/** This hook is the member workspace; only sessions opened for it belong. */
const MEMBER_WORKSPACE = "MEMBER" as const;

// Roles that belong on the member dashboard. SUPPORT has its own dashboard
// at /support and should never land here.
const MEMBER_DASHBOARD_ROLES = ["OWNER", "ADMIN", "MEMBER"];

export type MemberShellStatus =
  | "loading"
  // SUPPORT holding a MEMBER-scoped session: render nothing, no explanation
  // screen. This mirrors the pre-extraction AppShell behaviour exactly —
  // SUPPORT gets a blank page, not AccessDenied.
  | "denied-silent"
  // Any other role that isn't OWNER/ADMIN/MEMBER (shouldn't normally reach
  // here, since the workspace guard effect below redirects first, but this
  // is the in-render fallback if it does).
  | "denied-role"
  | "ready";

/**
 * Every guard and real-time wiring both AppShell (the sidebar console) and
 * WebmailShell (the full-screen mail client) need. Previously duplicated
 * almost verbatim in AppShell; factored out here so the two layouts can't
 * drift apart on what counts as "this session may be here."
 *
 * Each shell still owns its own rendering (sidebar vs. top bar + rail,
 * loading spinner markup, etc.) — this hook only owns the guard decisions
 * and the toast/SSE plumbing feeding into whatever UI the shell renders.
 */
export function useMemberShell() {
  const router = useRouter();
  const { data, isLoading: meLoading } = useMe();
  const me = data as MeResponse | undefined;
  const logout = useLogout();
  const qc = useQueryClient();
  const { toasts, add: addToast, dismiss } = useToast();

  // ── SSE real-time event handlers ──────────────────────────────────────────
  useSSE({
    NEW_MAIL: useCallback((e: SSEEvent) => {
      qc.invalidateQueries({ queryKey: ["mail"] });
      qc.invalidateQueries({ queryKey: ["mail", "unread"] });
      const count = e.payload?.count ?? 1;
      addToast({
        type: "mail",
        title: `${count} new email${count > 1 ? "s" : ""} arrived`,
        duration: 4000,
      });
    }, [qc, addToast]),

    AI_EXTRACTION_DONE: useCallback((e: SSEEvent) => {
      qc.invalidateQueries({ queryKey: ["ai", "actions"] });
      const count = e.payload?.actionCount ?? 0;
      if (count > 0) {
        addToast({
          type: "ai",
          title: `AI found ${count} action${count > 1 ? "s" : ""}`,
          body: "Go to AI drafting & summaries to review",
          duration: 5000,
        });
      }
    }, [qc, addToast]),

    AI_DRAFT_READY: useCallback(() => {
      qc.invalidateQueries({ queryKey: ["mail"] });
      addToast({
        type: "draft",
        title: "AI draft is ready",
        body: "Check your Drafts folder",
        duration: 5000,
      });
    }, [qc, addToast]),

    NOTIFICATION: useCallback((e: SSEEvent) => {
      qc.invalidateQueries({ queryKey: ["notifications"] });
      addToast({
        type: "notification",
        title: e.payload?.title ?? "New notification",
        body: e.payload?.body,
        duration: 4000,
      });
    }, [qc, addToast]),
  });

  // Auth guard for every page that uses either shell.
  useEffect(() => {
    if (!isLoggedIn()) router.replace("/login");
  }, [router]);

  // Staff-token guard: a user with a platform token (staff) has no tenant
  // membership, so useMe() will never resolve here and the loading gate
  // would hang forever. Send them to /support where their token is valid.
  useEffect(() => {
    if (getPlatformToken()) {
      router.replace("/support");
    }
  }, [router]);

  // Workspace guard: this is the member workspace, so only a session opened
  // for it belongs here. A session that belongs elsewhere is ended rather
  // than quietly redirected, because switching workspace requires signing
  // in again.
  useEffect(() => {
    if (getPlatformToken() || meLoading || !me) return;
    const scope = me.workspace;
    if (scope === MEMBER_WORKSPACE) return;

    setSignOutNotice(workspaceDenialNotice(MEMBER_WORKSPACE, scope));
    clearTokens();
    router.replace("/login");
  }, [me, meLoading, router]);

  let status: MemberShellStatus = "loading";
  if (!meLoading && me && me.workspace === MEMBER_WORKSPACE) {
    if (me.membership.role === "SUPPORT") {
      status = "denied-silent";
    } else if (!MEMBER_DASHBOARD_ROLES.includes(me.membership.role)) {
      status = "denied-role";
    } else {
      status = "ready";
    }
  }

  return { me, meLoading, status, logout, toasts, dismissToast: dismiss };
}

export function initials(name?: string, email?: string) {
  const base = (name?.trim() || email || "?").trim();
  const parts = base.split(/\s+/);
  return (parts.length >= 2 ? parts[0][0] + parts[1][0] : base.slice(0, 2)).toUpperCase();
}