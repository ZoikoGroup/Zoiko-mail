"use client";

import { useEffect, useState } from "react";

import { Modal } from "@/components/ui/Modal";
import type { MailboxDto } from "@/lib/admin-api";

/**
 * The Member sign-in link, to copy and send along with a mailbox address.
 *
 * One plain /login/member for everyone: it carries nothing about the mailbox,
 * so it can be shared freely and never needs replacing. The owner types the
 * mailbox address, which opens that mailbox's workspace; the password is
 * still required.
 */
export function MemberLoginLinkDialog({
  mailbox,
  onClose,
}: {
  mailbox: MailboxDto;
  onClose: () => void;
}) {
  // The admin console and the Member login are served by the same app.
  const [url, setUrl] = useState("");
  useEffect(() => {
    setUrl(`${window.location.origin}/login/member`);
  }, []);

  const [copied, setCopied] = useState(false);
  const [copyFailed, setCopyFailed] = useState(false);

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
              <b className="text-[var(--ink)]">{mailbox.address}</b> is shared. Assignees open this link and sign
              in with their own accounts.
            </>
          ) : (
            <>
              Send this link to the owner of <b className="text-[var(--ink)]">{mailbox.address}</b>, together with
              that address. They sign in with it and their password, and land in the{" "}
              <b className="text-[var(--ink)]">Member workspace</b>.
            </>
          )}
        </p>

        <div className="flex gap-2">
          <input
            className="zoiko-input w-full font-mono text-[11.5px]"
            readOnly
            value={url}
            aria-label="Member login link"
            onFocus={(event) => event.currentTarget.select()}
          />
          <button type="button" className="zoiko-btn sm" onClick={() => void copy()} disabled={!url}>
            {copied ? "Copied" : "Copy"}
          </button>
        </div>
        {copyFailed && (
          <p className="text-[11.5px] text-[var(--ink3)]">
            Your browser blocked copying. Select the link above and copy it with Ctrl+C.
          </p>
        )}
        {!shared && (
          <p className="text-[11.5px] text-[var(--ink3)]">
            This is for everyday sign-in. Someone who has not set a password yet needs their invitation link
            instead — use Generate new link on the mailbox.
          </p>
        )}
      </div>
    </Modal>
  );
}
