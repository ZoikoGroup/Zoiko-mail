"use client";

import { useState } from "react";
import { HiArrowLeft } from "react-icons/hi";
import { MdGroups } from "react-icons/md";

import { useJoinWorkspace } from "@/lib/auth-hooks";
import type { PendingInvitation } from "@/lib/auth-api";

interface JoinWorkspaceFormProps {
  /** Pending token from the verify-otp step (Bearer auth for the call). */
  token: string;
  invitations: PendingInvitation[];
  onBack: () => void;
}

const roleLabels: Record<string, string> = {
  ADMIN: "Administrator",
  MEMBER: "Member",
};

/**
 * Shown after email verification when the registering account already has
 * pending workspace invitations. Joining grants the invited role
 * (ADMIN/MEMBER) — only accounts without invitations create a new
 * workspace as OWNER.
 */
export default function JoinWorkspaceForm({
  token,
  invitations,
  onBack,
}: JoinWorkspaceFormProps) {
  const joinMutation = useJoinWorkspace();
  const [error, setError] = useState("");
  const [selectedId, setSelectedId] = useState(invitations[0]?.membershipId ?? "");

  const selected = invitations.find((i) => i.membershipId === selectedId);

  const join = () => {
    if (!selected) return;
    setError("");
    joinMutation.mutate(
      { token, membershipId: selected.membershipId },
      {
        onError: (e) => {
          setError(e instanceof Error ? e.message : "Unable to join the workspace.");
        },
      }
    );
  };

  return (
    <>
      <button
        onClick={onBack}
        className="mb-6 flex items-center gap-2 text-sm text-slate-500 transition hover:text-teal-600 dark:text-slate-400 dark:hover:text-teal-400"
      >
        <HiArrowLeft />
        Back
      </button>

      <div className="mb-8 text-center">
        <div className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-full bg-teal-100 dark:bg-teal-900/40">
          <MdGroups className="text-3xl text-teal-600 dark:text-teal-400" />
        </div>

        <h2 className="text-2xl md:text-3xl font-bold text-slate-900 dark:text-white">
          You&apos;re invited
        </h2>

        <p className="mt-3 text-sm leading-6 text-slate-500 dark:text-slate-400">
          This email has been invited to an existing workspace.
          {invitations.length === 1
            ? " Accept it to continue."
            : " Choose the workspace you'd like to join."}
        </p>
      </div>

      <div className="space-y-3">
        {invitations.map((invitation) => (
          <label
            key={invitation.membershipId}
            className={`flex cursor-pointer items-center justify-between rounded-xl border p-4 transition ${
              selectedId === invitation.membershipId
                ? "border-teal-600 bg-teal-50 dark:border-teal-500 dark:bg-teal-900/20"
                : "border-slate-200 bg-white hover:border-slate-300 dark:border-slate-700 dark:bg-slate-900"
            }`}
          >
            <span>
              <span className="block text-sm font-semibold text-slate-900 dark:text-white">
                {invitation.tenantName}
              </span>
              <span className="mt-0.5 block text-xs text-slate-500 dark:text-slate-400">
                Invited as {roleLabels[invitation.role] ?? invitation.role}
              </span>
            </span>
            <input
              type="radio"
              name="workspace-invitation"
              checked={selectedId === invitation.membershipId}
              onChange={() => setSelectedId(invitation.membershipId)}
              className="h-4 w-4 accent-teal-600"
            />
          </label>
        ))}

        {error && (
          <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
            {error}
          </div>
        )}

        <button
          type="button"
          onClick={join}
          disabled={joinMutation.isPending || !selected}
          className="flex h-12 w-full items-center justify-center rounded-xl bg-teal-600 text-sm font-semibold text-white transition-all duration-300 hover:bg-teal-700 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {joinMutation.isPending
            ? "Joining…"
            : `Join ${selected?.tenantName ?? "workspace"}`}
        </button>

        <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-700 dark:bg-slate-800/40">
          <p className="text-center text-sm leading-6 text-slate-600 dark:text-slate-300">
            By joining, you become a member of this workspace with the invited
            role. You can create your own workspace later if you need one.
          </p>
        </div>
      </div>
    </>
  );
}
