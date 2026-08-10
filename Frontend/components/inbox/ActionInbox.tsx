"use client";

import React, { useMemo, useState } from "react";
import {
  Inbox, CheckCircle2, XCircle, Clock, Play, Calendar, Plus, X,
  AlertCircle, Loader2,
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

// ---- small presentation helpers -------------------------------------------
const PRIORITY_STYLES: Record<ActionPriority, string> = {
  LOW: "bg-slate-100 text-slate-600 ring-slate-500/20",
  MEDIUM: "bg-sky-50 text-sky-700 ring-sky-600/20",
  HIGH: "bg-amber-50 text-amber-700 ring-amber-600/20",
  URGENT: "bg-rose-50 text-rose-700 ring-rose-600/20",
};

const STATUS_STYLES: Record<ActionStatus, string> = {
  OPEN: "bg-teal-50 text-teal-700 ring-teal-600/20",
  IN_PROGRESS: "bg-indigo-50 text-indigo-700 ring-indigo-600/20",
  SNOOZED: "bg-slate-100 text-slate-500 ring-slate-500/20",
  COMPLETED: "bg-green-50 text-green-700 ring-green-600/20",
  DISMISSED: "bg-slate-100 text-slate-400 ring-slate-400/20",
};

const STATUS_LABEL: Record<ActionStatus, string> = {
  OPEN: "Open",
  IN_PROGRESS: "In progress",
  SNOOZED: "Snoozed",
  COMPLETED: "Completed",
  DISMISSED: "Dismissed",
};

function Chip({ text, cls }: { text: string; cls: string }) {
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${cls}`}>
      {text}
    </span>
  );
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
          <h1 className="flex items-center gap-2 font-serif text-2xl font-semibold text-slate-900">
            <Inbox className="h-6 w-6 text-teal-600" /> Action Inbox
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            {activeCount} active {activeCount === 1 ? "commitment" : "commitments"}.
          </p>
        </div>
        <button
          onClick={() => setShowCreate((s) => !s)}
          className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-teal-600 px-3 py-2 text-sm font-medium text-white transition hover:bg-teal-700"
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
                ? "bg-slate-900 text-white"
                : "bg-white text-slate-600 ring-1 ring-inset ring-slate-200 hover:bg-slate-100"
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {/* List */}
      <div className="mt-4 flex-1 space-y-2">
        {isLoading && (
          <div className="flex items-center gap-2 py-10 text-sm text-slate-400">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading commitments…
          </div>
        )}

        {error && (
          <div className="flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            Couldn&rsquo;t load commitments. Your session may have expired — try logging in again.
          </div>
        )}

        {!isLoading && !error && visible.length === 0 && (
          <div className="flex flex-col items-center py-16 text-center text-slate-400">
            <CheckCircle2 className="h-10 w-10 text-teal-500" />
            <p className="mt-3 text-sm font-medium text-slate-600">Nothing here</p>
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

  return (
    <div
      className={`rounded-xl border bg-white p-4 transition ${
        terminal ? "border-slate-200 opacity-70" : "border-slate-200 hover:border-slate-300 hover:shadow-sm"
      }`}
    >
      <div className="flex flex-wrap items-center gap-2">
        <Chip text={a.priority} cls={PRIORITY_STYLES[a.priority]} />
        <Chip text={STATUS_LABEL[a.status]} cls={STATUS_STYLES[a.status]} />
        <span
          className={`ml-auto inline-flex items-center gap-1 text-xs ${
            due.overdue && !terminal ? "font-medium text-amber-600" : "text-slate-500"
          }`}
        >
          <Clock className="h-3 w-3" /> {due.label}
        </span>
      </div>

      <p className={`mt-2 text-sm font-medium ${terminal ? "text-slate-500 line-through" : "text-slate-900"}`}>
        {a.text}
      </p>

      {a.status === "SNOOZED" && a.snoozedUntil && (
        <p className="mt-1 text-xs text-slate-400">
          Snoozed until {formatDue(a.snoozedUntil).label}
        </p>
      )}

      {/* Lifecycle buttons — reflect the real status machine */}
      {!terminal && (
        <div className="mt-3 flex flex-wrap gap-1.5">
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
        </div>
      )}

      {terminal && (
        <button
          onClick={() => onSetStatus(a, "OPEN")}
          disabled={busy}
          className="mt-3 text-xs font-medium text-teal-700 hover:underline disabled:opacity-50"
        >
          Reopen
        </button>
      )}
    </div>
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
  const styles = {
    primary: "bg-teal-600 text-white hover:bg-teal-700",
    ghost: "text-slate-600 ring-1 ring-inset ring-slate-200 hover:bg-slate-100",
    danger: "text-slate-500 ring-1 ring-inset ring-slate-200 hover:bg-rose-50 hover:text-rose-600",
  }[variant];
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium transition disabled:opacity-50 ${styles}`}
    >
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

  return (
    <form onSubmit={submit} className="mt-4 space-y-3 rounded-xl border border-slate-200 bg-slate-50 p-4">
      <input
        autoFocus
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="What needs doing? e.g. Send the proposal to Meridian"
        className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-teal-500 focus:ring-1 focus:ring-teal-500"
      />
      <div className="flex flex-col gap-3 sm:flex-row">
        <select
          value={priority}
          onChange={(e) => setPriority(e.target.value as ActionPriority)}
          className="rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-teal-500"
        >
          <option value="LOW">Low</option>
          <option value="MEDIUM">Medium</option>
          <option value="HIGH">High</option>
          <option value="URGENT">Urgent</option>
        </select>
        <input
          type="datetime-local"
          value={dueAt}
          onChange={(e) => setDueAt(e.target.value)}
          className="rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-600 outline-none focus:border-teal-500"
        />
        <button
          type="submit"
          disabled={create.isPending || !text.trim()}
          className="rounded-lg bg-teal-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-teal-700 disabled:opacity-50 sm:ml-auto"
        >
          {create.isPending ? "Adding…" : "Add commitment"}
        </button>
      </div>
      {create.isError && (
        <p className="text-xs text-rose-600">Couldn&rsquo;t create that — check the fields and try again.</p>
      )}
    </form>
  );
}