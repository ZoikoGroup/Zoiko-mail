"use client";

import { useState } from "react";

import { Modal } from "@/components/ui/Modal";
import { BrandLoader } from "@/components/ui/BrandLoader";
import { StepUpDialog, useStepUp } from "@/components/admin/StepUpDialog";
import {
  useMailboxCredentialStatus,
  useResetMailboxCredentials,
  useSendMailboxCredentialResetEmail,
} from "@/lib/admin-hooks";
import type { MailboxDto } from "@/lib/admin-api";
import { ApiError } from "@/lib/api-client";

/** The same rules the server enforces, so the form says what is wrong before submitting. */
function passwordProblems(password: string): string[] {
  const problems: string[] = [];
  if (password.length < 8) problems.push("at least 8 characters");
  if (password.length > 128) problems.push("at most 128 characters");
  if (!/[A-Za-z]/.test(password)) problems.push("a letter");
  if (!/\d/.test(password)) problems.push("a number");
  if (password !== password.trim()) problems.push("no space at the start or end");
  return problems;
}

/**
 * Manage Credentials for one mailbox.
 *
 * Asks the server what is allowed before offering anything: a password can be
 * set only when it signs the owner into this workspace alone, by an admin
 * whose role ranks at or above the owner's, after re-authenticating. Where it
 * cannot, the owner is emailed a reset code instead and chooses the password
 * themselves. Shared mailboxes have no password of their own.
 */
export function MailboxCredentialsDialog({
  mailbox,
  onClose,
}: {
  mailbox: MailboxDto;
  onClose: () => void;
}) {
  const status = useMailboxCredentialStatus(mailbox.id);
  const reset = useResetMailboxCredentials();
  const sendEmail = useSendMailboxCredentialResetEmail();
  const stepUp = useStepUp();

  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [show, setShow] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const data = status.data;
  const problems = passwordProblems(password);
  const mismatch = confirm.length > 0 && confirm !== password;
  const canSubmit =
    data?.mode === "SET_PASSWORD" && password.length > 0 && problems.length === 0 && confirm === password && confirmed;
  const busy = reset.isPending || sendEmail.isPending;

  const submit = () => {
    setFailure(null);
    setDone(null);
    void stepUp
      .attempt(`Setting a new password for ${mailbox.address}`, async (stepUpToken) => {
        try {
          const result = await reset.mutateAsync({
            mailboxId: mailbox.id,
            newPassword: password,
            confirmPassword: confirm,
            stepUpToken,
          });
          setPassword("");
          setConfirm("");
          setConfirmed(false);
          setDone(
            `Password saved for ${result.ownerEmail}` +
              (result.mailServer === "HOSTED" ? " in Zoiko and on the mail server (IMAP/SMTP)" : "") +
              `. They sign in with ${mailbox.address}` +
              (result.ownerEmail.toLowerCase() !== mailbox.address.toLowerCase() ? ` or ${result.ownerEmail}` : "") +
              " and the new password. They have been signed out everywhere and emailed a notice. Share the new password with them privately."
          );
        } catch (error) {
          // The step-up refusal goes back to useStepUp, which opens the
          // password prompt and retries. Every other refusal is shown here,
          // in this dialog, rather than inside the prompt.
          if (error instanceof ApiError && error.needsStepUp) throw error;
          setFailure(describeFailure(error));
        }
      })
      .catch((error: unknown) => setFailure(describeFailure(error)));
  };

  const sendCode = () => {
    setFailure(null);
    sendEmail.mutate(mailbox.id, {
      onSuccess: (result) => setDone(`A reset code was emailed to ${result.sentTo}. It expires shortly; they choose their own password.`),
      onError: (error) => setFailure((error as Error).message),
    });
  };

  return (
    <>
      {/*
        Hidden while the password prompt is up. Both are full-screen modals at
        the same layer, and this one, rendered later, used to sit on top of the
        prompt — so "Set password" appeared to do nothing while the prompt
        waited unseen behind it. Its state lives in this component, so hiding
        the modal loses nothing.
      */}
      <Modal
        open={!stepUp.dialog.open}
        onClose={onClose}
        title="Manage credentials"
        size="sm"
        footer={
          done ? (
            <button type="button" className="zoiko-btn pri" onClick={onClose}>
              Done
            </button>
          ) : (
            <>
              <button type="button" className="zoiko-btn" onClick={onClose} disabled={busy}>
                Cancel
              </button>
              {data?.mode === "SET_PASSWORD" && (
                <button type="button" className="zoiko-btn pri" disabled={!canSubmit || busy} onClick={submit}>
                  {reset.isPending ? "Saving…" : "Set password"}
                </button>
              )}
              {data?.mode === "RESET_EMAIL" && (
                <button type="button" className="zoiko-btn pri" disabled={busy} onClick={sendCode}>
                  {sendEmail.isPending ? "Sending…" : "Email a reset code"}
                </button>
              )}
            </>
          )
        }
      >
        <div className="flex flex-col gap-3 text-[12.5px]">
          <p>
            <span className="font-semibold text-[var(--ink)]">{mailbox.address}</span>
            {data?.owner && (
              <span className="block text-[11.5px] text-[var(--ink3)]">
                Signs in as {data.owner.displayName} ({data.owner.email}) · {data.owner.role.toLowerCase()}
              </span>
            )}
          </p>

          {status.isLoading && (
            <BrandLoader variant="compact" label="Checking what can be changed" onRetry={() => void status.refetch()} />
          )}
          {status.error && <p className="text-[var(--crit)]">{(status.error as Error).message}</p>}

          {done ? (
            <p className="rounded-md bg-[var(--s2)] p-3">{done}</p>
          ) : (
            data && (
              <>
                {data.message && (
                  <p className={data.mode === "UNAVAILABLE" ? "text-[var(--ink2)]" : "rounded-md bg-[var(--s2)] p-3"}>
                    {data.message}
                  </p>
                )}

                {data.mode === "SET_PASSWORD" && (
                  <form
                    className="flex flex-col gap-2"
                    onSubmit={(event) => {
                      event.preventDefault();
                      if (canSubmit && !busy) submit();
                    }}
                  >
                    <label className="flex flex-col gap-1">
                      New password
                      <input
                        className="zoiko-input"
                        type={show ? "text" : "password"}
                        autoComplete="new-password"
                        value={password}
                        onChange={(event) => setPassword(event.target.value)}
                        aria-invalid={password.length > 0 && problems.length > 0}
                      />
                    </label>
                    {password.length > 0 && problems.length > 0 && (
                      <span className="text-[11px] text-[var(--crit)]">Needs {problems.join(", ")}.</span>
                    )}
                    <label className="flex flex-col gap-1">
                      Confirm new password
                      <input
                        className="zoiko-input"
                        type={show ? "text" : "password"}
                        autoComplete="new-password"
                        value={confirm}
                        onChange={(event) => setConfirm(event.target.value)}
                        aria-invalid={mismatch}
                      />
                    </label>
                    {mismatch && <span className="text-[11px] text-[var(--crit)]">The passwords do not match.</span>}
                    <label className="flex items-center gap-2 text-[11.5px]">
                      <input type="checkbox" checked={show} onChange={(event) => setShow(event.target.checked)} />
                      Show passwords
                    </label>
                    <label className="flex items-start gap-2 text-[11.5px]">
                      <input
                        type="checkbox"
                        className="mt-0.5"
                        checked={confirmed}
                        onChange={(event) => setConfirmed(event.target.checked)}
                      />
                      I understand this replaces their current password and signs them out on every device.
                    </label>
                    <p className="text-[11px] text-[var(--ink3)]">
                      {data.mailServer === "HOSTED"
                        ? "This also replaces the password their mail apps use (IMAP/SMTP). "
                        : ""}
                      You will be asked for your own password first. The change is recorded in the audit log.
                    </p>
                    {/* Enter submits; the footer button does the same. */}
                    <button type="submit" hidden aria-hidden tabIndex={-1} />
                  </form>
                )}
              </>
            )
          )}

          {failure && <p className="text-[var(--crit)]">{failure}</p>}
        </div>
      </Modal>
      <StepUpDialog {...stepUp.dialog} />
    </>
  );
}

/** A refusal in words that say what to do next. */
function describeFailure(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 0) return "Could not reach the server. Check your connection and try again.";
    return error.readableMessage || error.message;
  }
  return error instanceof Error ? error.message : "The password could not be saved.";
}
