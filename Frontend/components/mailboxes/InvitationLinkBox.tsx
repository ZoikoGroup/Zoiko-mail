"use client";

import { useState } from "react";

/**
 * The invitation link, when this deployment cannot email it.
 *
 * With system email off nobody can receive an invitation, so the server hands
 * the link to the person who created the mailbox, once, to pass on. It is a
 * credential: whoever opens it can set the password for that mailbox's owner.
 * So it is only ever held in memory here, shown on this screen, and never
 * written to storage or the address bar. Closing this screen discards it; a
 * new one is one click away (a new link makes the old one stop working).
 */
export function InvitationLinkBox({ link, recipient }: { link: string; recipient: string | null }) {
  const [copied, setCopied] = useState(false);
  const [failed, setFailed] = useState(false);

  const copy = async () => {
    setFailed(false);
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard access can be refused (an insecure origin, a blocked
      // permission). The link is still selectable in the field below.
      setFailed(true);
    }
  };

  return (
    <div
      className="mt-2 rounded-[10px] border border-[var(--warn)] bg-[var(--warn-soft)] px-3 py-2.5"
      data-testid="invitation-link-box"
    >
      <p className="text-[12px] font-semibold text-[var(--ink)]">Invitation link — email is turned off</p>
      <p className="mt-1 text-[11.5px] leading-relaxed text-[var(--ink2)]">
        Send this to {recipient ?? "the new user"} yourself. They open it to choose their password. Anyone who has the link
        can do that, so share it only with them. It is shown once: if you close this, get a new link (the old one stops
        working).
      </p>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <input
          readOnly
          value={link}
          aria-label="Invitation link"
          onFocus={(event) => event.currentTarget.select()}
          className="min-w-0 flex-1 rounded-lg border border-[var(--border)] bg-[var(--s2)] px-2.5 py-1.5 font-mono-num text-[11px] text-[var(--ink)]"
        />
        <button type="button" className="zoiko-btn sm" onClick={() => void copy()}>
          {copied ? "Copied" : "Copy link"}
        </button>
      </div>
      {failed && (
        <p className="mt-1 text-[11px] text-[var(--crit)]">Could not copy automatically. Select the link above and copy it.</p>
      )}
    </div>
  );
}
