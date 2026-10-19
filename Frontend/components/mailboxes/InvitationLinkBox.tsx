"use client";

import { useEffect, useRef, useState } from "react";

/**
 * A setup or invitation link for the admin to pass on.
 *
 * Whoever opens the link can choose the password for that account, so it is a
 * credential. It is only ever held in memory here, shown on this screen, and
 * never written to storage or the address bar. Closing the screen discards
 * it; a new one is one click away (a new link makes the old one stop working).
 */
export function InvitationLinkBox({ link, recipient }: { link: string; recipient: string | null }) {
  const [copy, setCopy] = useState<"idle" | "copied" | "failed">("idle");
  const field = useRef<HTMLInputElement>(null);
  const timer = useRef<number | undefined>(undefined);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  const copyLink = async () => {
    window.clearTimeout(timer.current);
    try {
      await navigator.clipboard.writeText(link);
      setCopy("copied");
      timer.current = window.setTimeout(() => setCopy("idle"), 4000);
    } catch {
      // Clipboard access can be refused (an insecure origin, a blocked
      // permission). Select the link so copying it by hand is one keystroke.
      setCopy("failed");
      field.current?.select();
    }
  };

  return (
    <div
      className="mt-2 rounded-[10px] border border-[var(--accent)] bg-[var(--s2)] px-3 py-2.5"
      data-testid="invitation-link-box"
    >
      <p className="text-[12px] font-semibold text-[var(--ink)]">Invitation link</p>
      <p className="mt-1 text-[11.5px] leading-relaxed text-[var(--ink2)]">
        Share this with {recipient ?? "the new user"} so they can choose their password. It works once and expires,
        and anyone who has it can use it, so send it only to them. It is shown once: if you close this, generate a new
        link (the old one stops working).
      </p>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <input
          ref={field}
          readOnly
          value={link}
          aria-label="Invitation link"
          onFocus={(event) => event.currentTarget.select()}
          className="min-w-0 flex-1 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-2.5 py-1.5 font-mono-num text-[11px] text-[var(--ink)]"
        />
        <button type="button" className="zoiko-btn sm pri" onClick={() => void copyLink()}>
          {copy === "copied" ? "Copied" : "Copy Invitation Link"}
        </button>
      </div>
      <p aria-live="polite" className="mt-1 min-h-[16px] text-[11px]">
        {copy === "copied" && <span className="text-[var(--ok)]">Link copied to clipboard.</span>}
        {copy === "failed" && (
          <span className="text-[var(--crit)]">Could not copy automatically. The link is selected — press Ctrl+C (⌘C on Mac) to copy it.</span>
        )}
      </p>
    </div>
  );
}
