"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { API_BASE } from "@/lib/config";
import { resolveWorkspaceHref } from "@/lib/workspace";
import { setTokens, setPlatformToken } from "@/lib/auth-storage";

// Matches the WorkspaceOption shape the backend returns in the login
// WORKSPACE_SELECTION response.
interface Workspace {
  id: string;
  name: string;
  planCode: string;
  role: string;
  membershipId: string;
  membershipStatus: string;
  tenantStatus: string;
  selectable: boolean;
}

export default function SelectWorkspacePage() {
  const router = useRouter();
  const [token, setToken] = useState<string | null>(null);
  const [workspaces, setWorkspaces] = useState<Workspace[] | null>(null);
  const [ready, setReady] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Read the stash left by useLogin's WORKSPACE_SELECTION branch. If someone
  // lands here directly with no stash, bounce to /login.
  useEffect(() => {
    const t = sessionStorage.getItem("zoiko.selection_token");
    const wRaw = sessionStorage.getItem("zoiko.selection_workspaces");
    if (!t || !wRaw) {
      router.replace("/login");
      return;
    }
    try {
      const parsed = JSON.parse(wRaw) as Workspace[];
      if (!Array.isArray(parsed) || parsed.length === 0) {
        router.replace("/login");
        return;
      }
      setToken(t);
      setWorkspaces(parsed);
      setReady(true);
    } catch {
      router.replace("/login");
    }
  }, [router]);

  const clearStash = useCallback(() => {
    sessionStorage.removeItem("zoiko.selection_token");
    sessionStorage.removeItem("zoiko.selection_workspaces");
  }, []);

  const handlePick = useCallback(
    async (ws: Workspace) => {
      if (!token || submitting) return;
      setSubmitting(true);
      setError(null);
      try {
        const res = await fetch(`${API_BASE}/auth/select-workspace`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ selectionToken: token, tenantId: ws.id }),
        });
        const json = await res.json();
        if (!res.ok || !json.success) {
          setError(json?.error?.message ?? "Failed to select workspace");
          setSubmitting(false);
          return;
        }
        const data = json.data;
        // Handle every state the backend might return after selection.
        // Reuses the same routing logic pattern as useLogin — since all the
        // downstream states (MEMBERSHIP_SUSPENDED, WORKSPACE_DELETING etc.)
        // already have their auth-status pages built, we just build hrefs.
        if (data.state === "SIGNED_IN") {
          const session = data.session ?? data;
          if (session.accessToken) {
            setTokens(session.accessToken, session.refreshToken);
          }
          clearStash();
          router.replace(resolveWorkspaceHref(session.membership?.role));
        } else if (data.state === "STAFF_CONSOLE") {
          if (data.platformToken) setPlatformToken(data.platformToken);
          clearStash();
          router.replace("/platform-console");
        } else if (
          data.state === "MEMBERSHIP_SUSPENDED" ||
          data.state === "WORKSPACE_SUSPENDED" ||
          data.state === "WORKSPACE_DELETING"
        ) {
          const wsName = encodeURIComponent(data.workspace?.name ?? ws.name);
          clearStash();
          router.replace(`/auth-status?state=${data.state}&workspace=${wsName}`);
        } else if (
          data.state === "ACCOUNT_SUSPENDED" ||
          data.state === "ACCOUNT_DISABLED"
        ) {
          clearStash();
          router.replace(`/auth-status?state=${data.state}`);
        } else if (data.state === "WORKSPACE_SELECTION") {
          // Rare — user picked a tenantId that no longer resolves. Backend
          // returned a new selection state with a new token, refresh the
          // page's stash from the fresh response.
          sessionStorage.setItem("zoiko.selection_token", data.selectionToken ?? "");
          sessionStorage.setItem("zoiko.selection_workspaces", JSON.stringify(data.workspaces ?? []));
          setError("That workspace can no longer be selected. Please choose another.");
          setToken(data.selectionToken ?? null);
          setWorkspaces(data.workspaces ?? []);
          setSubmitting(false);
        } else {
          // Unknown state — fall back to login so user can retry.
          clearStash();
          router.replace("/login");
        }
      } catch (e) {
        setError("Network error, please try again.");
        setSubmitting(false);
      }
    },
    [token, submitting, clearStash, router]
  );

  const handleCancel = useCallback(() => {
    clearStash();
    router.replace("/login");
  }, [clearStash, router]);

  if (!ready || !workspaces) {
    return null;
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 p-4 dark:bg-slate-950">
      <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-8 shadow-xl dark:border-slate-800 dark:bg-slate-950">
        <div className="mb-8 text-center">
          <Image
            src="/ZoikoMail_Logo_DarkBG_PNG.png"
            width={400}
            height={100}
            className="mx-auto mb-4 h-12 w-auto"
            alt="Zoiko Mail"
            priority
          />
        </div>

        <div className="mb-6 space-y-2">
          <h1 className="text-xl font-semibold text-slate-900 dark:text-white">
            Select a workspace
          </h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            You have access to more than one workspace. Pick one to continue.
          </p>
        </div>

        {error && (
          <div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
            {error}
          </div>
        )}

        <div className="space-y-2">
          {workspaces.map((ws) => {
            const disabled = !ws.selectable || submitting;
            const reason = !ws.selectable
              ? ws.membershipStatus === "INVITED"
                ? "Invitation not yet accepted"
                : ws.membershipStatus === "SUSPENDED"
                ? "Membership suspended"
                : ws.tenantStatus === "SUSPENDED"
                ? "Workspace suspended"
                : ws.tenantStatus === "DELETING"
                ? "Workspace being deleted"
                : "Not available"
              : null;

            return (
              <button
                key={ws.id}
                onClick={() => handlePick(ws)}
                disabled={disabled}
                className={`w-full rounded-lg border p-4 text-left transition ${
                  disabled
                    ? "cursor-not-allowed border-slate-200 bg-slate-50 opacity-60 dark:border-slate-800 dark:bg-slate-900"
                    : "border-slate-200 bg-white hover:border-teal-500 hover:bg-teal-50 dark:border-slate-700 dark:bg-slate-900 dark:hover:border-teal-500 dark:hover:bg-slate-800"
                }`}
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium text-slate-900 dark:text-white">
                      {ws.name}
                    </p>
                    <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                      {ws.role} · {ws.planCode}
                    </p>
                  </div>
                  {reason && (
                    <span className="shrink-0 rounded-full bg-slate-200 px-2 py-0.5 text-xs text-slate-600 dark:bg-slate-800 dark:text-slate-400">
                      {reason}
                    </span>
                  )}
                </div>
              </button>
            );
          })}
        </div>

        <button
          onClick={handleCancel}
          disabled={submitting}
          className="mt-6 w-full rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
        >
          Cancel and sign in again
        </button>
      </div>
    </div>
  );
}