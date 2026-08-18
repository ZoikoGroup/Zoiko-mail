"use client";

import { useMemo, useState } from "react";
import { AppShell } from "@/components/shell/AppShell";
import { useAiActions, useReviewAiAction } from "@/lib/ai-hooks";
import type { AIAction, AIActionType, AIActionStatus } from "@/lib/ai-api";
import {
  Sparkles, Loader2, AlertCircle, CheckCircle2, XCircle, FileText,
  ListChecks, Clock, ThumbsUp, Inbox,
} from "lucide-react";

const TYPE_LABEL: Record<AIActionType, string> = {
  DRAFT: "Draft reply",
  SUMMARY: "Summary",
  COMMITMENT_EXTRACTION: "Commitments",
  REPLY_OWED: "Reply owed",
  DEADLINE: "Deadline",
  APPROVAL: "Approval",
};

const STATUS_META: Record<AIActionStatus, { label: string; tone: string }> = {
  PENDING: { label: "Processing", tone: "nu" },
  COMPLETED: { label: "Ready to review", tone: "accent" },
  CONFIRMED: { label: "Confirmed", tone: "ok" },
  DISMISSED: { label: "Dismissed", tone: "nu" },
  FAILED: { label: "Failed", tone: "crit" },
};

type Tab = "review" | "all" | "PENDING" | "CONFIRMED" | "DISMISSED";

export default function AiActionsPage() {
  const { data: actions = [], isLoading, error } = useAiActions();
  const review = useReviewAiAction();
  const [tab, setTab] = useState<Tab>("review");

  const tabs: { key: Tab; label: string }[] = [
    { key: "review", label: "To review" },
    { key: "all", label: "All" },
    { key: "PENDING", label: "Processing" },
    { key: "CONFIRMED", label: "Confirmed" },
    { key: "DISMISSED", label: "Dismissed" },
  ];

  const visible = useMemo(() => {
    return actions.filter((a) => {
      if (tab === "review") return a.status === "COMPLETED";
      if (tab === "all") return true;
      return a.status === tab;
    });
  }, [actions, tab]);

  const toReview = actions.filter((a) => a.status === "COMPLETED").length;

  return (
    <AppShell>
      <div className="mx-auto max-w-3xl px-4 py-8 sm:px-6">
        <h1 className="flex items-center gap-2 font-editorial text-2xl sm:text-3xl font-normal tracking-tight text-[var(--ink)]">
          <Sparkles className="h-6 w-6 text-[var(--ai)]" /> AI actions
        </h1>
        <p className="mt-1 text-sm text-[var(--ink3)]">
          Drafts, summaries and detected items the AI generated from your mail — you review before anything is used.
        </p>

        <div className="mt-4 flex gap-1.5 overflow-x-auto pb-1">
          {tabs.map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`shrink-0 rounded-full px-3 py-1 text-sm transition ${
                tab === t.key
                  ? "bg-[var(--accent)] text-white"
                  : "bg-[var(--surface)] text-[var(--ink2)] ring-1 ring-inset ring-[var(--border)] hover:bg-[var(--s2)]"
              }`}
            >
              {t.label}
              {t.key === "review" && toReview > 0 && (
                <span className="ml-1.5 rounded-full bg-white/25 px-1.5 text-xs">{toReview}</span>
              )}
            </button>
          ))}
        </div>

        <div className="mt-4 space-y-3">
          {isLoading && (
            <div className="flex items-center gap-2 py-10 text-sm text-[var(--ink3)]">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading AI actions…
            </div>
          )}
          {error && (
            <div className="flex items-start gap-2 rounded-lg border border-[var(--crit)]/30 bg-[var(--crit-soft)] p-4 text-sm text-[var(--crit)]">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" /> Couldn&rsquo;t load AI actions.
            </div>
          )}
          {!isLoading && !error && visible.length === 0 && (
            <div className="flex flex-col items-center py-16 text-center text-[var(--ink3)]">
              <Inbox className="h-10 w-10" />
              <p className="mt-3 text-sm font-medium text-[var(--ink2)]">Nothing here</p>
              <p className="text-xs">
                AI actions are generated from your mail — open a message in Webmail and ask for a summary or draft.
              </p>
            </div>
          )}

          {visible.map((a) => (
            <AiActionCard
              key={a.id}
              action={a}
              busy={review.isPending}
              onReview={(status) => review.mutate({ id: a.id, status })}
            />
          ))}
        </div>
      </div>
    </AppShell>
  );
}

function AiActionCard({
  action: a,
  onReview,
  busy,
}: {
  action: AIAction;
  onReview: (status: "CONFIRMED" | "DISMISSED") => void;
  busy: boolean;
}) {
  const meta = STATUS_META[a.status];
  const canReview = a.status === "COMPLETED";
  const TypeIcon =
    a.actionType === "DRAFT" ? FileText :
    a.actionType === "SUMMARY" ? FileText :
    a.actionType === "COMMITMENT_EXTRACTION" ? ListChecks :
    a.actionType === "DEADLINE" ? Clock :
    a.actionType === "APPROVAL" ? ThumbsUp : Sparkles;

  return (
    <div className="zoiko-card p-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="inline-flex h-7 w-7 items-center justify-center rounded-lg bg-[var(--ai-soft)] text-[var(--ai)]">
          <TypeIcon className="h-4 w-4" />
        </span>
        <span className="text-sm font-medium text-[var(--ink)]">{TYPE_LABEL[a.actionType]}</span>
        <span className={`zoiko-pill ${meta.tone}`}>{meta.label}</span>
        {typeof a.confidenceScore === "number" && (
          <span className="ml-auto text-xs text-[var(--ink3)]">
            {Math.round(a.confidenceScore * 100)}% confidence
          </span>
        )}
      </div>

      {/* Output */}
      {a.status === "PENDING" && (
        <p className="mt-3 flex items-center gap-2 text-sm text-[var(--ink3)]">
          <Loader2 className="h-3.5 w-3.5 animate-spin" /> The AI is still working on this…
        </p>
      )}
      {a.status === "FAILED" && (
        <p className="mt-3 text-sm text-[var(--crit)]">This action couldn&rsquo;t be completed.</p>
      )}
      {a.output && a.status !== "PENDING" && (
        <div className="mt-3">
          <AiOutput output={a.output} />
        </div>
      )}

      {/* Source excerpt — the evidence the AI used */}
      {a.sourceExcerpt && (
        <blockquote className="mt-3 border-l-2 border-[var(--border)] pl-3 text-xs italic text-[var(--ink3)]">
          &ldquo;{a.sourceExcerpt}&rdquo;
        </blockquote>
      )}

      {/* Review actions */}
      {canReview && (
        <div className="mt-4 flex items-center gap-1.5">
          <button onClick={() => onReview("CONFIRMED")} disabled={busy} className="zoiko-btn pri sm disabled:opacity-50">
            <CheckCircle2 className="h-3.5 w-3.5" /> Confirm
          </button>
          <button onClick={() => onReview("DISMISSED")} disabled={busy} className="zoiko-btn sm disabled:opacity-50">
            <XCircle className="h-3.5 w-3.5" /> Dismiss
          </button>
        </div>
      )}
    </div>
  );
}

// The `output` JSON is free-form (worker-defined). Render the common shapes
// nicely; otherwise fall back to formatted JSON so nothing is hidden.
function AiOutput({ output }: { output: Record<string, unknown> }) {
  const str = (v: unknown) => (typeof v === "string" ? v : null);

  const summary = str(output.summary) ?? str(output.text);
  const subject = str(output.subject);
  const body = str(output.body) ?? str(output.draft) ?? str(output.reply);
  const commitments = Array.isArray(output.commitments) ? output.commitments : null;

  if (summary || subject || body || commitments) {
    return (
      <div className="rounded-lg bg-[var(--s2)] p-3 text-sm text-[var(--ink)]">
        {summary && <p className="whitespace-pre-wrap">{summary}</p>}
        {subject && <p className="font-medium">Subject: {subject}</p>}
        {body && <p className="mt-1 whitespace-pre-wrap text-[var(--ink2)]">{body}</p>}
        {commitments && (
          <ul className="mt-1 list-disc space-y-0.5 pl-5 text-[var(--ink2)]">
            {commitments.map((c, i) => (
              <li key={i}>{typeof c === "string" ? c : JSON.stringify(c)}</li>
            ))}
          </ul>
        )}
      </div>
    );
  }

  return (
    <pre className="overflow-auto rounded-lg bg-[var(--s2)] p-3 text-xs text-[var(--ink2)]">
      {JSON.stringify(output, null, 2)}
    </pre>
  );
}