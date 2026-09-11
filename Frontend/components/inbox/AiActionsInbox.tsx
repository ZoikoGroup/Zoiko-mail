"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  Sparkles, Loader2, AlertCircle, CheckCircle2, XCircle, FileText,
  ListChecks, Clock, ThumbsUp, Inbox, ChevronRight, ExternalLink,
  RefreshCw, Mail, PenLine, ShieldCheck,
} from "lucide-react";
import { useAiActions, useReviewAiAction, useAiDraftPoll } from "@/lib/ai-hooks";
import type { AIAction, AIActionType, AIActionStatus } from "@/lib/ai-api";
import type { MailItem } from "@/lib/mail-api";
import { useMessage } from "@/lib/mail-hooks";
import { Modal } from "@/components/ui/Modal";

// ---- token tones -----------------------------------------------------------
const TYPE_LABEL: Record<AIActionType, string> = {
  DRAFT: "Draft reply",
  SUMMARY: "Summary",
  COMMITMENT_EXTRACTION: "Commitment",
  REPLY_OWED: "Reply owed",
  DEADLINE: "Deadline",
  APPROVAL: "Approval",
};

// "Why was this flagged?" — a human frame around each extracted type so the
// review step is explainable without inventing backend fields.
const TYPE_REASON: Record<AIActionType, string> = {
  REPLY_OWED:
    "The message sounds like it expects a reply from you.",
  APPROVAL:
    "Something in this message is waiting for your approval or sign-off.",
  DEADLINE:
    "A date or deadline was mentioned that may need tracking.",
  COMMITMENT_EXTRACTION:
    "The message mentions something you committed to doing.",
  DRAFT: "The AI drafted a reply for this message.",
  SUMMARY: "The AI summarised this message.",
};

const STATUS_META: Record<AIActionStatus, { label: string; tone: string }> = {
  PENDING: { label: "Processing", tone: "nu" },
  COMPLETED: { label: "Ready to review", tone: "accent" },
  CONFIRMED: { label: "Confirmed", tone: "ok" },
  DISMISSED: { label: "Dismissed", tone: "nu" },
  FAILED: { label: "Failed", tone: "crit" },
};

const PRIORITY_TONE: Record<string, string> = {
  LOW: "nu",
  MEDIUM: "accent",
  HIGH: "warn",
  URGENT: "crit",
};

const TypeIcon = ({ type }: { type: AIActionType }) => {
  const cls = "h-4 w-4";
  switch (type) {
    case "REPLY_OWED": return <Sparkles className={cls} />;
    case "APPROVAL": return <ThumbsUp className={cls} />;
    case "DEADLINE": return <Clock className={cls} />;
    case "COMMITMENT_EXTRACTION": return <ListChecks className={cls} />;
    case "SUMMARY": return <FileText className={cls} />;
    default: return <PenLine className={cls} />;
  }
};

function draftEligible(a: AIAction): boolean {
  return a.actionType === "REPLY_OWED" || a.actionType === "APPROVAL";
}

function outputText(a: AIAction): string | null {
  if (!a.output) return null;
  const text = a.output.text;
  return typeof text === "string" ? text : null;
}

type FilterKey = "review" | "all" | "CONFIRMED" | "DISMISSED" | "FAILED";

// ===========================================================================
export function AiActionsInbox() {
  const { data: actions = [], isLoading, error } = useAiActions();
  const [filter, setFilter] = useState<FilterKey>("review");
  const [selected, setSelected] = useState<AIAction | null>(null);

  const filters: { key: FilterKey; label: string }[] = [
    { key: "review", label: "To review" },
    { key: "all", label: "All" },
    { key: "CONFIRMED", label: "Confirmed" },
    { key: "DISMISSED", label: "Dismissed" },
    { key: "FAILED", label: "Failed" },
  ];

  const toReview = actions.filter((a) => a.status === "COMPLETED").length;

  const visible = useMemo(() => {
    return actions
      .filter((a) => {
        if (filter === "review") return a.status === "COMPLETED";
        if (filter === "all") return true;
        return a.status === filter;
      })
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }, [actions, filter]);

  return (
    <div className="mx-auto max-w-3xl px-4 py-6 sm:px-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 font-editorial text-2xl sm:text-3xl font-normal tracking-tight text-[var(--ink)]">
            <Inbox className="h-6 w-6 text-[var(--accent)]" /> Action Inbox
          </h1>
          <p className="mt-1 text-sm text-[var(--ink3)]">
            AI-extracted items from your mail — confirm the ones worth keeping, dismiss the rest.
          </p>
        </div>
      </div>

      {/* Filter pills */}
      <div className="mt-4 flex gap-1.5 overflow-x-auto pb-1">
        {filters.map((f) => (
          <button
            key={f.key}
            onClick={() => setFilter(f.key)}
            className={`shrink-0 rounded-full px-3 py-1 text-sm transition ${
              filter === f.key
                ? "bg-[var(--accent)] text-white"
                : "bg-[var(--surface)] text-[var(--ink2)] ring-1 ring-inset ring-[var(--border)] hover:bg-[var(--s2)]"
            }`}
          >
            {f.label}
            {f.key === "review" && toReview > 0 && (
              <span className="ml-1.5 rounded-full bg-white/25 px-1.5 text-xs">{toReview}</span>
            )}
          </button>
        ))}
      </div>

      {/* List */}
      <div className="mt-4 space-y-2">
        {isLoading && (
          <div className="flex items-center gap-2 py-10 text-sm text-[var(--ink3)]">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading AI actions…
          </div>
        )}

        {error && (
          <div className="flex items-start gap-2 rounded-lg border border-[var(--crit)]/30 bg-[var(--crit-soft)] p-4 text-sm text-[var(--crit)]">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            Couldn&rsquo;t load AI actions. Your session may have expired — try logging in again.
          </div>
        )}

        {!isLoading && !error && visible.length === 0 && (
          <div className="flex flex-col items-center py-16 text-center text-[var(--ink3)]">
            <Inbox className="h-10 w-10" />
            <p className="mt-3 text-sm font-medium text-[var(--ink2)]">No AI actions here</p>
            <p className="text-xs">Connect an account and open mail to generate actions, or switch filters.</p>
          </div>
        )}

        {visible.map((a) => (
          <ActionCard
            key={a.id}
            action={a}
            onClick={() => setSelected(a)}
          />
        ))}
      </div>

      <ActionDrawer
        action={selected}
        onClose={() => setSelected(null)}
        onReviewed={(updated) => setSelected(updated)}
      />
    </div>
  );
}

// ---- one row ---------------------------------------------------------------
function ActionCard({
  action: a,
  onClick,
}: {
  action: AIAction;
  onClick: () => void;
}) {
  const meta = STATUS_META[a.status];
  const text = outputText(a);
  const terminal = a.status === "CONFIRMED" || a.status === "DISMISSED";
  const priority = a.output?.priority;
  const priorityTone =
    typeof priority === "string" ? PRIORITY_TONE[priority] ?? "nu" : undefined;

  return (
    <button
      onClick={onClick}
      className={`zoiko-card block w-full cursor-pointer p-4 text-left transition ${
        terminal ? "opacity-75" : "hover:shadow-[var(--sh2)]"
      }`}
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="inline-flex h-7 w-7 items-center justify-center rounded-lg bg-[var(--ai-soft)] text-[var(--ai)]">
          <TypeIcon type={a.actionType} />
        </span>
        <span className="text-sm font-medium text-[var(--ink)]">{TYPE_LABEL[a.actionType]}</span>
        <span className={`zoiko-pill ${meta.tone}`}>{meta.label}</span>
        {priorityTone && priority ? (
          <span className={`zoiko-pill ${priorityTone}`}>{String(priority)}</span>
        ) : null}
        {typeof a.confidenceScore === "number" && (
          <span className="ml-auto text-xs text-[var(--ink3)]">
            {Math.round(a.confidenceScore * 100)}% confidence
          </span>
        )}
        <ChevronRight className="h-4 w-4 text-[var(--ink3)]" />
      </div>

      {text && <p className="mt-2 text-sm text-[var(--ink)]">{text}</p>}

      {a.status === "PENDING" && (
        <p className="mt-2 flex items-center gap-2 text-sm text-[var(--ink3)]">
          <Loader2 className="h-3.5 w-3.5 animate-spin" /> Still analysing…
        </p>
      )}

      {!text && a.sourceExcerpt && (
        <blockquote className="mt-2 border-l-2 border-[var(--border)] pl-3 text-xs italic text-[var(--ink3)]">
          &ldquo;{a.sourceExcerpt}&rdquo;
        </blockquote>
      )}
    </button>
  );
}

// ---- detail drawer ---------------------------------------------------------
function ActionDrawer({
  action,
  onClose,
  onReviewed,
}: {
  action: AIAction | null;
  onClose: () => void;
  onReviewed: (updated: AIAction) => void;
}) {
  const review = useReviewAiAction();
  const [draftRequested, setDraftRequested] = useState(false);

  // Opening a CONFIRMED draft-eligible action resumes/resolves its draft poll;
  // confirming inside this modal flips `action` to CONFIRMED and re-fires it.
  useEffect(() => {
    if (action && action.status === "CONFIRMED" && draftEligible(action)) {
      setDraftRequested(true);
    }
  }, [action]);

  if (!action) return null;
  const a = action;
  const meta = STATUS_META[a.status];
  const canReview = a.status === "COMPLETED";
  const eligible = draftEligible(a);
  const text = outputText(a);
  const due = a.output?.dueAt;
  const priority = a.output?.priority;

  const confirmDraft = () => {
    review.mutate(
      { id: a.id, status: "CONFIRMED" },
      {
        onSuccess: (updated) => {
          if (eligible) setDraftRequested(true);
          onReviewed(updated);
        },
      }
    );
  };

  const dismiss = () => {
    review.mutate(
      { id: a.id, status: "DISMISSED" },
      { onSuccess: onReviewed }
    );
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={`${TYPE_LABEL[a.actionType]} · action`}
      size="lg"
      footer={
        canReview ? (
          <>
            <button
              onClick={dismiss}
              disabled={review.isPending}
              className="zoiko-btn disabled:opacity-50"
            >
              <XCircle className="h-3.5 w-3.5" /> Dismiss
            </button>
            <button
              onClick={confirmDraft}
              disabled={review.isPending}
              className="zoiko-btn pri disabled:opacity-50"
            >
              {review.isPending ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <CheckCircle2 className="h-3.5 w-3.5" />
              )}
              {eligible ? "Confirm & generate draft" : "Confirm"}
            </button>
          </>
        ) : undefined
      }
    >
      <div className="space-y-4">
        {/* Status row */}
        <div className="flex flex-wrap items-center gap-2">
          <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-[var(--ai-soft)] text-[var(--ai)]">
            <TypeIcon type={a.actionType} />
          </span>
          <span className={`zoiko-pill ${meta.tone}`}>{meta.label}</span>
          {priority ? (
            <span className={`zoiko-pill ${PRIORITY_TONE[String(priority)] ?? "nu"}`}>{String(priority)}</span>
          ) : null}
          {typeof a.confidenceScore === "number" && (
            <span className="ml-auto text-xs text-[var(--ink3)]">
              {Math.round(a.confidenceScore * 100)}% confidence
            </span>
          )}
        </div>

        {/* What the AI found */}
        {text && (
          <div>
            <h3 className="font-mono-num text-[11px] font-semibold uppercase tracking-wider text-[var(--ink3)]">Action</h3>
            <p className="mt-1 text-sm text-[var(--ink)]">{text}</p>
            {typeof due === "string" && due ? (
              <p className="mt-1 text-xs text-[var(--warn)]">
                Due {new Date(due).toLocaleString(undefined, { month: "short", day: "numeric", year: "numeric" })}
              </p>
            ) : null}
          </div>
        )}

        {/* Why it was flagged */}
        <div className="rounded-xl border border-[var(--border)] bg-[var(--s2)] p-4">
          <h3 className="flex items-center gap-1.5 font-mono-num text-[11px] font-semibold uppercase tracking-wider text-[var(--ink3)]">
            <ShieldCheck className="h-3.5 w-3.5" /> Why was this flagged?
          </h3>
          <p className="mt-1 text-sm text-[var(--ink2)]">{TYPE_REASON[a.actionType]}</p>
          {a.sourceExcerpt ? (
            <blockquote className="mt-2 border-l-2 border-[var(--border)] pl-3 text-xs italic text-[var(--ink3)]">
              &ldquo;{a.sourceExcerpt}&rdquo;
            </blockquote>
          ) : (
            <p className="mt-2 text-xs text-[var(--ink3)]">No source snippet was captured.</p>
          )}
        </div>

        {/* Source email / thread */}
        <SourceMessage action={a} />

        {/* Draft generation */}
        {a.status === "PENDING" && (
          <p className="flex items-center gap-2 rounded-lg bg-[var(--s2)] p-3 text-sm text-[var(--ink3)]">
            <Loader2 className="h-4 w-4 animate-spin" /> The AI is still analysing this message — it will be ready to review shortly.
          </p>
        )}
        {a.status === "FAILED" && (
          <div className="flex items-start gap-2 rounded-lg border border-[var(--crit)]/30 bg-[var(--crit-soft)] p-3 text-sm text-[var(--crit)]">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" /> This action failed and can&rsquo;t be reviewed.
          </div>
        )}
        {a.status === "DISMISSED" && (
          <p className="text-sm text-[var(--ink3)]">Dismissed — no commitment or draft was created.</p>
        )}
        {a.status === "CONFIRMED" && (
          <>
            <p className="flex items-center gap-2 text-sm text-[var(--ok)]">
              <CheckCircle2 className="h-4 w-4" /> Confirmed
              {eligible && <span className="text-[var(--ink3)]">— a commitment was created.</span>}
            </p>
            {eligible && draftRequested && <DraftStatus action={a} />}
          </>
        )}
        {canReview && (
          <p className="text-xs text-[var(--ink3)]">
            {eligible
              ? "Confirming generates a draft reply in the background — you review and send it from Webmail."
              : "Confirming turns this into a commitment you can track."}
          </p>
        )}
      </div>
    </Modal>
  );
}

// ---- source message --------------------------------------------------------
function SourceMessage({ action: a }: { action: AIAction }) {
  // The drawer only ever renders one action at a time, so this hook is called
  // unconditionally for every render (mail-hooks disables itself on null).
  const { data: item, isLoading } = useMessage(a.messageId ?? null);

  if (!a.threadId && !a.messageId) {
    return (
      <div className="rounded-xl border border-[var(--border)] bg-[var(--s2)] p-4">
        <h3 className="font-mono-num text-[11px] font-semibold uppercase tracking-wider text-[var(--ink3)]">Source</h3>
        <p className="mt-1 text-sm text-[var(--ink3)]">Not linked to a message.</p>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--s2)] p-4">
      <h3 className="font-mono-num text-[11px] font-semibold uppercase tracking-wider text-[var(--ink3)]">Source</h3>
      {item ? (
        <SourceCard item={item} />
      ) : isLoading ? (
        <p className="mt-1 flex items-center gap-2 text-sm text-[var(--ink3)]">
          <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading message…
        </p>
      ) : (
        <p className="mt-1 text-sm text-[var(--ink3)]">
          {a.threadId ? "Linked to a conversation." : "Source message unavailable."}
        </p>
      )}
      {a.threadId && (
        <Link
          href={`/threads/${a.threadId}`}
          className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-[var(--accent-ink)] hover:underline"
        >
          <ExternalLink className="h-3.5 w-3.5" /> Open source thread
        </Link>
      )}
    </div>
  );
}

function SourceCard({ item }: { item: MailItem }) {
  const m = item.message;
  const sender = m.fromName || m.fromAddress || m.author?.email || "Unknown sender";
  const to = m.recipients
    .filter((r) => r.type === "TO" || r.type === "CC")
    .map((r) => r.email)
    .join(", ");

  return (
    <div className="mt-2">
      <p className="text-sm font-medium text-[var(--ink)]">{m.subject || "(no subject)"}</p>
      <p className="mt-0.5 truncate text-xs text-[var(--ink3)]">
        <Mail className="mr-1 inline h-3 w-3" />
        {sender}
        {to ? <span className="text-[var(--ink3)]"> to {to}</span> : null}
      </p>
      {m.textBody && (
        <p className="mt-2 line-clamp-3 whitespace-pre-wrap rounded-lg bg-[var(--surface)] p-2 text-xs text-[var(--ink2)]">
          {m.textBody}
        </p>
      )}
    </div>
  );
}

// ---- generated-draft status -------------------------------------------------
function DraftStatus({ action: a }: { action: AIAction }) {
  const { state, retry } = useAiDraftPoll(a.id);

  switch (state.phase) {
    case "generating":
      return (
        <div className="flex items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--ai-soft)] p-3 text-sm text-[var(--ai)]">
          <Loader2 className="h-4 w-4 animate-spin" /> Generating a draft reply…
          {a.threadId && (
            <Link href={`/threads/${a.threadId}`} className="ml-auto text-xs hover:underline">
              View source
            </Link>
          )}
        </div>
      );
    case "ready": {
      const d = state.draft.message;
      return (
        <div className="rounded-lg border border-[var(--ok)]/30 bg-[var(--ok-soft)] p-3">
          <p className="flex items-center gap-1.5 text-sm font-medium text-[var(--ok)]">
            <CheckCircle2 className="h-4 w-4" /> Draft ready
          </p>
          <p className="mt-1 truncate text-sm text-[var(--ink)]">{d.subject}</p>
          <p className="mt-0.5 line-clamp-2 whitespace-pre-wrap text-xs text-[var(--ink2)]">{d.textBody}</p>
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            <Link href="/mail" className="zoiko-btn pri sm">
              <PenLine className="h-3.5 w-3.5" /> Open in Webmail
            </Link>
            {a.threadId && (
              <Link href={`/threads/${a.threadId}`} className="zoiko-btn sm">
                <ExternalLink className="h-3.5 w-3.5" /> View source
              </Link>
            )}
          </div>
        </div>
      );
    }
    case "failed":
      return (
        <div className="flex items-start gap-2 rounded-lg border border-[var(--crit)]/30 bg-[var(--crit-soft)] p-3 text-sm text-[var(--crit)]">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <div>
            <p>{state.message}</p>
            <button onClick={retry} className="zoiko-btn crit sm mt-2">
              <RefreshCw className="h-3.5 w-3.5" /> Retry
            </button>
          </div>
        </div>
      );
    default:
      return null;
  }
}