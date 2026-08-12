"use client";

import React, { useMemo, useState } from "react";
import Link from "next/link";
import {
  Inbox, CheckCircle2, XCircle, Clock, Play, Calendar, Plus, X,
  AlertCircle, Loader2, FileSearch,
} from "lucide-react";
import {
  useActions,
  useUpdateAction,
  useCreateAction,
} from "@/lib/actions-hooks";
import type {
  ActionItem,
  ActionStatus,
  ActionPriority,
} from "@/lib/actions-api";

// ---- token tones -----------------------------------------------------------
const PRIORITY_TONE: Record<ActionPriority, string> = {
  LOW: "nu",
  MEDIUM: "accent",
  HIGH: "warn",
  URGENT: "crit",
};

const STATUS_TONE: Record<ActionStatus, string> = {
  OPEN: "accent",
  IN_PROGRESS: "ai",
  SNOOZED: "nu",
  COMPLETED: "ok",
  DISMISSED: "nu",
};

const STATUS_LABEL: Record<ActionStatus, string> = {
  OPEN: "Open",
  IN_PROGRESS: "In progress",
  SNOOZED: "Snoozed",
  COMPLETED: "Completed",
  DISMISSED: "Dismissed",
};

function Pill({ text, tone }: { text: string; tone: string }) {
  return <span className={`zoiko-pill ${tone}`}>{text}</span>;
}

function formatDue(iso: string | null): { label: string; overdue: boolean } {
  if (!iso) return { label: "No due date", overdue: false };
  const d = new Date(iso);
  const now = new Date();
  const overdue = d.getTime() < now.getTime();
  const label = d.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: d.getFullYear() === now.getFullYear() ? undefined : "numeric",
  });
  return { label, overdue };
}

type FilterKey = "active" | "all" | ActionStatus;

// ===========================================================================
export function ActionInbox() {
  const { data: items = [], isLoading, error } = useActions();
  const update = useUpdateAction();
  const [filter, setFilter] = useState<FilterKey>("active");
  const [showCreate, setShowCreate] = useState(false);

  const filters: { key: FilterKey; label: string }[] = [
    { key: "active", label: "Active" },
    { key: "all", label: "All" },
    { key: "OPEN", label: "Open" },
    { key: "IN_PROGRESS", label: "In progress" },
    { key: "SNOOZED", label: "Snoozed" },
    { key: "COMPLETED", label: "Completed" },
  ];

  const visible = useMemo(() => {
    return items
      .filter((a) => {
        if (filter === "active")
          return a.status === "OPEN" || a.status === "IN_PROGRESS";
        if (filter === "all") return true;
        return a.status === filter;
      })
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }, [items, filter]);

  const activeCount = items.filter(
    (a) => a.status === "OPEN" || a.status === "IN_PROGRESS"
  ).length;

  const setStatus = (a: ActionItem, status: ActionStatus, snoozedUntil?: string) =>
    update.mutate({ id: a.id, status, snoozedUntil });

  const onSnooze = (a: ActionItem) => {
    // schema requires snoozedUntil when status is SNOOZED — default +3 days
    const d = new Date();
    d.setDate(d.getDate() + 3);
    setStatus(a, "SNOOZED", d.toISOString());
  };

  return (
    <div className="mx-auto flex min-h-screen max-w-3xl flex-col px-4 py-6 sm:px-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 font-editorial text-2xl sm:text-3xl font-normal tracking-tight text-[var(--ink)]">
            <Inbox className="h-6 w-6 text-[var(--accent)]" /> Commitments
          </h1>
          <p className="mt-1 text-sm text-[var(--ink3)]">
            {activeCount} active {activeCount === 1 ? "commitment" : "commitments"}.
          </p>
        </div>
        <button
          onClick={() => setShowCreate((s) => !s)}
          className="zoiko-btn pri shrink-0"
        >
          {showCreate ? <X className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
          <span className="hidden sm:inline">{showCreate ? "Close" : "New commitment"}</span>
        </button>
      </div>

      {/* Create form (collapsible) */}
      {showCreate && <CreateForm onDone={() => setShowCreate(false)} />}

      {/* Filter tabs — horizontally scrollable on mobile */}
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
          </button>
        ))}
      </div>

      {/* List */}
      <div className="mt-4 flex-1 space-y-2">
        {isLoading && (
          <div className="flex items-center gap-2 py-10 text-sm text-[var(--ink3)]">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading commitments…
          </div>
        )}

        {error && (
          <div className="flex items-start gap-2 rounded-lg border border-[var(--crit)]/30 bg-[var(--crit-soft)] p-4 text-sm text-[var(--crit)]">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            Couldn&rsquo;t load commitments. Your session may have expired — try logging in again.
          </div>
        )}

        {!isLoading && !error && visible.length === 0 && (
          <div className="flex flex-col items-center py-16 text-center text-[var(--ink3)]">
            <CheckCircle2 className="h-10 w-10 text-[var(--ok)]" />
            <p className="mt-3 text-sm font-medium text-[var(--ink2)]">Nothing here</p>
            <p className="text-xs">Create a commitment or switch filters.</p>
          </div>
        )}

        {visible.map((a) => (
          <ActionCard key={a.id} action={a} onSetStatus={setStatus} onSnooze={onSnooze} busy={update.isPending} />
        ))}
      </div>
    </div>
  );
}

// ---- one card --------------------------------------------------------------
function ActionCard({
  action: a,
  onSetStatus,
  onSnooze,
  busy,
}: {
  action: ActionItem;
  onSetStatus: (a: ActionItem, s: ActionStatus) => void;
  onSnooze: (a: ActionItem) => void;
  busy: boolean;
}) {
  const due = formatDue(a.dueAt);
  const terminal = a.status === "COMPLETED" || a.status === "DISMISSED";
  const hasEvidence = Boolean(a.threadId || a.messageId);

  return (
    <div className={`zoiko-card p-4 transition ${terminal ? "opacity-70" : "hover:shadow-[var(--sh2)]"}`}>
      <div className="flex flex-wrap items-center gap-2">
        <Pill text={a.priority} tone={PRIORITY_TONE[a.priority]} />
        <Pill text={STATUS_LABEL[a.status]} tone={STATUS_TONE[a.status]} />
        <span
          className={`ml-auto inline-flex items-center gap-1 text-xs ${
            due.overdue && !terminal ? "font-medium text-[var(--warn)]" : "text-[var(--ink3)]"
          }`}
        >
          <Clock className="h-3 w-3" /> {due.label}
        </span>
      </div>

      <p className={`mt-2 text-sm font-medium ${terminal ? "text-[var(--ink3)] line-through" : "text-[var(--ink)]"}`}>
        {a.text}
      </p>

      {a.status === "SNOOZED" && a.snoozedUntil && (
        <p className="mt-1 text-xs text-[var(--ink3)]">
          Snoozed until {formatDue(a.snoozedUntil).label}
        </p>
      )}

      {/* Lifecycle buttons — reflect the real status machine */}
      {!terminal && (
        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          {a.status === "OPEN" && (
            <Btn onClick={() => onSetStatus(a, "IN_PROGRESS")} disabled={busy} icon={Play}>
              Start
            </Btn>
          )}
          <Btn onClick={() => onSetStatus(a, "COMPLETED")} disabled={busy} icon={CheckCircle2} variant="primary">
            Complete
          </Btn>
          {a.status !== "SNOOZED" && (
            <Btn onClick={() => onSnooze(a)} disabled={busy} icon={Calendar}>
              Snooze 3d
            </Btn>
          )}
          <Btn onClick={() => onSetStatus(a, "DISMISSED")} disabled={busy} icon={XCircle} variant="danger">
            Dismiss
          </Btn>
          {hasEvidence && <EvidenceLink threadId={a.threadId} />}
        </div>
      )}

      {terminal && (
        <div className="mt-3 flex items-center gap-3">
          <button
            onClick={() => onSetStatus(a, "OPEN")}
            disabled={busy}
            className="text-xs font-medium text-[var(--accent-ink)] hover:underline disabled:opacity-50"
          >
            Reopen
          </button>
          {hasEvidence && <EvidenceLink threadId={a.threadId} />}
        </div>
      )}
    </div>
  );
}

// Links to the source thread the commitment was detected from.
// Lights up once the Threads / message-detail screen ships; until then it
// points at that route so no wiring changes are needed later.
function EvidenceLink({ threadId }: { threadId: string | null }) {
  if (!threadId) return null;
  return (
    <Link
      href={`/threads/${threadId}`}
      className="ml-auto inline-flex items-center gap-1 text-xs font-medium text-[var(--ink3)] transition hover:text-[var(--accent-ink)]"
    >
      <FileSearch className="h-3.5 w-3.5" /> View evidence
    </Link>
  );
}

function Btn({
  children,
  onClick,
  disabled,
  icon: Icon,
  variant = "ghost",
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  icon: React.ComponentType<{ className?: string }>;
  variant?: "primary" | "ghost" | "danger";
}) {
  const cls =
    variant === "primary"
      ? "zoiko-btn pri sm"
      : variant === "danger"
      ? "zoiko-btn crit sm"
      : "zoiko-btn sm";
  return (
    <button onClick={onClick} disabled={disabled} className={`${cls} disabled:opacity-50`}>
      <Icon className="h-3.5 w-3.5" />
      {children}
    </button>
  );
}

// ---- create form -----------------------------------------------------------
function CreateForm({ onDone }: { onDone: () => void }) {
  const create = useCreateAction();
  const [text, setText] = useState("");
  const [priority, setPriority] = useState<ActionPriority>("MEDIUM");
  const [dueAt, setDueAt] = useState("");

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!text.trim()) return;
    create.mutate(
      {
        text: text.trim(),
        priority,
        dueAt: dueAt ? new Date(dueAt).toISOString() : undefined,
      },
      {
        onSuccess: () => {
          setText("");
          setDueAt("");
          setPriority("MEDIUM");
          onDone();
        },
      }
    );
  };

  const field =
    "rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm text-[var(--ink)] outline-none focus:border-[var(--accent)] focus:ring-1 focus:ring-[var(--accent)]";

  return (
    <form onSubmit={submit} className="mt-4 space-y-3 rounded-xl border border-[var(--border)] bg-[var(--s2)] p-4">
      <input
        autoFocus
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="What needs doing? e.g. Send the proposal to Meridian"
        className={`w-full ${field}`}
      />
      <div className="flex flex-col gap-3 sm:flex-row">
        <select value={priority} onChange={(e) => setPriority(e.target.value as ActionPriority)} className={field}>
          <option value="LOW">Low</option>
          <option value="MEDIUM">Medium</option>
          <option value="HIGH">High</option>
          <option value="URGENT">Urgent</option>
        </select>
        <input
          type="datetime-local"
          value={dueAt}
          onChange={(e) => setDueAt(e.target.value)}
          className={`text-[var(--ink2)] ${field}`}
        />
        <button type="submit" disabled={create.isPending || !text.trim()} className="zoiko-btn pri disabled:opacity-50 sm:ml-auto">
          {create.isPending ? "Adding…" : "Add commitment"}
        </button>
      </div>
      {create.isError && (
        <p className="text-xs text-[var(--crit)]">Couldn&rsquo;t create that — check the fields and try again.</p>
      )}
    </form>
  );
}