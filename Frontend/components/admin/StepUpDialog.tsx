"use client";

import { useState } from "react";
import { ShieldAlert } from "lucide-react";

import { Modal } from "@/components/ui/Modal";
import { ApiError } from "@/lib/api-client";
import { requestStepUp } from "@/lib/auth-api";

/**
 * Ask for the password again, then run the action that was refused.
 *
 * RBAC §2 marks five admin actions "Step-up": remove domain, delete mailbox,
 * rotate provider credentials, change AI policy, enable AI on a restricted
 * mailbox. The server refuses them without a fresh token and says so in
 * `error.details.requiresStepUp` — this turns that refusal into a prompt
 * rather than a dead end.
 *
 * The token is passed straight to the retried call and never stored. Keeping
 * it would make it a second, longer-lived credential, which is the opposite of
 * what freshness means.
 */
export function StepUpDialog({
  open,
  action,
  onClose,
  onAuthorised,
}: {
  open: boolean;
  /** What the person is about to authorise, in their words. */
  action: string;
  onClose: () => void;
  onAuthorised: (stepUpToken: string) => void | Promise<void>;
}) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setError(null);
    setBusy(true);
    try {
      const token = await requestStepUp(password);
      setPassword("");
      await onAuthorised(token);
      onClose();
    } catch (cause) {
      setError(
        cause instanceof ApiError && cause.status === 401
          ? "That password is not right."
          : cause instanceof Error
            ? cause.message
            : "Could not confirm your password."
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={() => {
        setPassword("");
        setError(null);
        onClose();
      }}
      title="Confirm it is you"
      size="sm"
      footer={
        <>
          <button className="zoiko-btn" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button
            className="zoiko-btn pri"
            onClick={submit}
            disabled={busy || password.length === 0}
          >
            {busy ? "Confirming…" : "Confirm and continue"}
          </button>
        </>
      }
    >
      <div className="flex gap-3">
        <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[var(--warn-soft)] text-[var(--warn)]">
          <ShieldAlert className="h-4 w-4" />
        </span>
        <div className="flex-1">
          <p className="text-[12.6px] text-[var(--ink)]">
            {action} needs your password again, because you signed in a while ago and
            this cannot be undone from here.
          </p>

          <label
            htmlFor="step-up-password"
            className="font-mono-num mb-1 mt-3 block text-[9.5px] uppercase tracking-[0.1em] text-[var(--ink3)]"
          >
            Password
          </label>
          <input
            id="step-up-password"
            type="password"
            autoComplete="current-password"
            value={password}
            disabled={busy}
            onChange={(event) => setPassword(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && password) void submit();
            }}
            className="w-full rounded-lg border border-[var(--border)] bg-[var(--s2)] px-3 py-2 text-[12.6px] text-[var(--ink)]"
          />

          {error && <p className="mt-2 text-[11.5px] text-[var(--crit)]">{error}</p>}
        </div>
      </div>
    </Modal>
  );
}

/**
 * Run an action, and if the server asks for a fresh password, prompt and retry.
 *
 * Returns the state a screen needs to render `StepUpDialog` without each one
 * reimplementing the refused-then-retry dance — which is how two screens end
 * up disagreeing about whether a refusal is an error or a next step.
 */
export function useStepUp() {
  const [pending, setPending] = useState<{
    action: string;
    run: (stepUpToken: string) => Promise<unknown>;
  } | null>(null);

  /**
   * `run` receives the step-up token, or undefined on the first attempt. Call
   * it with whatever the mutation needs; if it throws a step-up refusal, the
   * dialog opens and the same call is made again with a token.
   */
  const attempt = async (
    action: string,
    run: (stepUpToken?: string) => Promise<unknown>
  ) => {
    try {
      await run(undefined);
    } catch (cause) {
      if (cause instanceof ApiError && cause.needsStepUp) {
        setPending({ action, run: (token: string) => run(token) });
        return;
      }
      throw cause;
    }
  };

  return {
    attempt,
    /** Props for the dialog; spread them onto `StepUpDialog`. */
    dialog: {
      open: pending !== null,
      action: pending?.action ?? "",
      onClose: () => setPending(null),
      onAuthorised: async (token: string) => {
        const run = pending?.run;
        setPending(null);
        if (run) await run(token);
      },
    },
  };
}
