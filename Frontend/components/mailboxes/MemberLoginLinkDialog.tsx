"use client";

import { useState } from "react";

import { Modal } from "@/components/ui/Modal";
import { useRegenerateMemberLoginLink } from "@/lib/admin-hooks";
import type { MailboxDto } from "@/lib/admin-api";

/**
 * A mailbox's Member sign-in link, to copy and send to its owner.
 *
 * The link opens the Member login with the owner's email and workspace filled
 * in and always lands in the Member workspace. It is not a credential — the
 * password is still required — so sharing it is safe; regenerating it is for
 * a link that was sent to the wrong place or is simply no longer wanted.
 */
export function MemberLoginLinkDialog({
  mailbox,
  onClose,
}: {
  mailbox: MailboxDto;
  onClose: () => void;
}) {
  const regenerate = useRegenerateMemberLoginLink();
  // Shown at once after a regenerate, before the list re-read lands.
  const [fresh, setFresh] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [copyFailed, setCopyFailed] = useState(false);
  const [confirming, setConfirming] = useState(false);

  const url = fresh ?? mailbox.memberLoginUrl;
  const shared = mailbox.type === "SHARED";

  const copy = async () => {
    if (!url) return;
    setCopyFailed(false);
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard access is refused on plain-http origins and in some
      // browsers; the field is selectable, so say how to copy it by hand.
      setCopyFailed(true);
    }
  };

  const replace = () => {
    regenerate.mutate(mailbox.id, {
      onSuccess: (next) => {
        setFresh(next);
        setConfirming(false);
        setCopied(false);
      },
    });
  };

  return (
    <Modal
      open
      onClose={onClose}
      title="Member login link"
      size="sm"
      footer={
        <button type="button" className="zoiko-btn pri" onClick={onClose}>
          Done
        </button>
      }
    >
      <div className="flex flex-col gap-3 text-[12.5px] text-[var(--ink2)]">
        <p>
          {shared ? (
            <>
              <b className="text-[var(--ink)]">{mailbox.address}</b> is shared, so the link opens the
              Member login for this workspace without an email filled in. Assignees sign in with their own
              accounts.
            </>
          ) : (
            <>
              Send this link to the owner of <b className="text-[var(--ink)]">{mailbox.address}</b>. It opens
              the Member login with their email and this workspace filled in, and signs them in to the{" "}
              <b className="text-[var(--ink)]">Member workspace</b>. Their password is still required.
            </>
          )}
        </p>

        {url ? (
          <div className="flex gap-2">
            <input
              className="zoiko-input w-full font-mono text-[11.5px]"
              readOnly
              value={url}
              aria-label={`Member login link for ${mailbox.address}`}
              onFocus={(event) => event.currentTarget.select()}
            />
            <button type="button" className="zoiko-btn sm" onClick={() => void copy()}>
              {copied ? "Copied" : "Copy"}
            </button>
          </div>
        ) : (
          <p className="text-[var(--warn)]">
            The server did not return a link for this mailbox. It needs the API build that adds Member login
            links.
          </p>
        )}
        {copyFailed && (
          <p className="text-[11.5px] text-[var(--ink3)]">
            Your browser blocked copying. Select the link above and copy it with Ctrl+C.
          </p>
        )}
        {fresh && (
          <p className="text-[11.5px] text-[var(--ok)]">
            New link created. The previous link no longer works.
          </p>
        )}

        <div className="border-t border-[var(--border)] pt-3">
          {confirming ? (
            <div className="flex flex-col gap-2">
              <p>
                Replace this link? Anyone holding the current link will be told to ask for the new one. Signed-in
                sessions are not affected.
              </p>
              <div className="flex gap-2">
                <button
                  type="button"
                  className="zoiko-btn crit sm"
                  disabled={regenerate.isPending}
                  onClick={replace}
                >
                  {regenerate.isPending ? "Replacing…" : "Replace link"}
                </button>
                <button
                  type="button"
                  className="zoiko-btn sm"
                  disabled={regenerate.isPending}
                  onClick={() => setConfirming(false)}
                >
                  Keep current link
                </button>
              </div>
            </div>
          ) : (
            <button type="button" className="zoiko-btn sm" onClick={() => setConfirming(true)} disabled={!url}>
              Generate a new link
            </button>
          )}
          {regenerate.isError && (
            <p className="mt-2 text-[11.5px] text-[var(--crit)]">
              Could not replace the link. {(regenerate.error as Error).message}
            </p>
          )}
        </div>
      </div>
    </Modal>
  );
}
