"use client";

import { useState } from "react";
import { Send, Loader2, AlertCircle } from "lucide-react";
import { useComposerSubmit } from "@/lib/mail-hooks";

/**
 * A one-line input that expands into a small textarea on focus. Sends a
 * plain-text reply via the existing reply orchestration (useComposerSubmit,
 * mode "reply") — the same gated-send handling ComposeModal uses, so a
 * blocked send degrades to a saved draft here too rather than silently
 * failing.
 */
export function QuickReply({
  messageId,
  senderName,
  onSent,
}: {
  messageId: string;
  senderName: string;
  onSent?: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [body, setBody] = useState("");
  const submit = useComposerSubmit();

  const send = () => {
    if (!body.trim()) return;
    submit.mutate(
      { mode: "reply", sourceId: messageId, textBody: body, action: "send" },
      {
        onSuccess: (result) => {
          setBody("");
          setExpanded(false);
          onSent?.();
          if (result.gated) {
            // Gated sends (policy/suspension/warm-up) save as a draft
            // instead of failing outright — same contract ComposeModal
            // relies on. Surfacing result.gateMessage as a toast is a
            // Step 4 item alongside the rest of compose's notice UI;
            // for now the reply is at least never lost.
          }
        },
      }
    );
  };

  return (
    <div className="border-t border-[var(--border)] p-3">
      {submit.isError && (
        <div className="mb-2 flex items-center gap-1.5 text-xs text-[var(--crit)]">
          <AlertCircle className="h-3.5 w-3.5" /> Couldn&rsquo;t send. Try again.
        </div>
      )}
      <div className="flex items-end gap-2">
        {expanded ? (
          <textarea
            autoFocus
            value={body}
            onChange={(e) => setBody(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) send();
            }}
            placeholder={`Reply to ${senderName}…`}
            rows={3}
            className="min-h-[72px] w-full resize-y rounded-lg border border-[var(--border)] bg-[var(--surface)] p-2.5 text-sm text-[var(--ink)] placeholder:text-[var(--ink3)] focus:border-[var(--accent)] focus:outline-none"
          />
        ) : (
          <input
            onFocus={() => setExpanded(true)}
            placeholder={`Reply to ${senderName}…`}
            readOnly
            className="h-9 w-full cursor-text rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 text-sm text-[var(--ink3)] focus:border-[var(--accent)] focus:outline-none"
          />
        )}
        <button
          onClick={send}
          disabled={!body.trim() || submit.isPending}
          className="zoiko-btn pri shrink-0"
        >
          {submit.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          <span className="hidden sm:inline">Send</span>
        </button>
      </div>
    </div>
  );
}