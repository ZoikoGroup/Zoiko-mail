"use client";

import { Check, Flag, ListChecks, Mail, Sparkles, UserRound } from "lucide-react";
import { useCompleteTask } from "@/lib/tasks-hooks";
import type { Task } from "@/lib/tasks-api";
import {
  PRIORITY_CLASS,
  PRIORITY_LABEL,
  PRIORITY_SHORT,
  STATUS_LABEL,
  clock,
  dueClass,
  dueLabel,
  initials,
  shortDay,
  type TaskGroup,
} from "./format";

function Chip({ children, tone = "nu" }: { children: React.ReactNode; tone?: "nu" | "accent" | "ai" | "ok" }) {
  const cls =
    tone === "accent"
      ? "border-[var(--accent)]/40 text-[var(--accent-ink)]"
      : tone === "ai"
        ? "border-[var(--ai)]/40 text-[var(--ai)]"
        : tone === "ok"
          ? "border-[var(--ok)]/40 text-[var(--ok)]"
          : "border-[var(--border)] text-[var(--ink2)]";
  return <span className={`inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[11px] ${cls}`}>{children}</span>;
}

/** What a task is linked to and where it came from. */
export function TaskChips({ task }: { task: Task }) {
  return (
    <span className="flex flex-wrap gap-1.5">
      {task.hasLinkedEmail && (
        <Chip tone="accent">
          <Mail className="h-3 w-3" aria-hidden /> Linked email
        </Chip>
      )}
      {task.isAssigned && (
        <Chip tone="ai">
          <UserRound className="h-3 w-3" aria-hidden /> From {task.createdBy.displayName.split(" ")[0] || task.createdBy.email}
        </Chip>
      )}
      {task.fromAi && (
        <Chip tone="ai">
          <Sparkles className="h-3 w-3" aria-hidden /> Suggested by Alet
        </Chip>
      )}
      {(task.status === "PLANNED" || task.status === "IN_PROGRESS" || task.status === "SNOOZED") && <Chip>{STATUS_LABEL[task.status]}</Chip>}
      {task.checklistProgress.total > 0 && (
        <Chip tone={task.checklistProgress.done === task.checklistProgress.total ? "ok" : "nu"}>
          <ListChecks className="h-3 w-3" aria-hidden /> {task.checklistProgress.done}/{task.checklistProgress.total}
        </Chip>
      )}
    </span>
  );
}

/** Ticking the box completes the task; a completed task's box is already ticked. */
function CompleteBox({ task, onReopen }: { task: Task; onReopen?: (task: Task) => void }) {
  const complete = useCompleteTask();
  const done = task.status === "COMPLETED";
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={done}
      aria-label={done ? `Reopen ${task.title}` : `Mark ${task.title} complete`}
      disabled={complete.isPending}
      onClick={(e) => {
        e.stopPropagation();
        if (done) onReopen?.(task);
        else complete.mutate(task.id);
      }}
      className={`mt-0.5 flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-[5px] border transition focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] ${
        done ? "border-[var(--ok)] bg-[var(--ok)]" : "border-[var(--bstrong,var(--border))] hover:border-[var(--accent)]"
      }`}
    >
      {(done || complete.isPending) && <Check className={`h-3 w-3 ${done ? "text-white" : "text-[var(--accent)]"}`} strokeWidth={3} />}
    </button>
  );
}

function rowClass(active: boolean) {
  return `relative w-full cursor-pointer text-left transition ${
    active
      ? "bg-[var(--zm-selected)] before:absolute before:inset-y-0 before:left-0 before:w-[3px] before:bg-[var(--accent)]"
      : "hover:bg-[var(--s2)]"
  }`;
}

/** The card-style list used by My Tasks, Today, Upcoming and the My Work views. */
export function GroupedTaskList({
  groups,
  selectedId,
  onSelect,
  onReopen,
  showHeaders,
}: {
  groups: TaskGroup[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onReopen: (task: Task) => void;
  showHeaders: boolean;
}) {
  return (
    <div data-testid="task-list">
      {groups.map((group) => (
        <div key={group.key}>
          {showHeaders && (
            <div className="flex items-baseline gap-2 px-5 pb-2 pt-4 text-[11px]">
              <span
                className={`font-semibold uppercase tracking-[0.12em] ${
                  group.tone === "crit" ? "text-[var(--crit)]" : group.tone === "warn" ? "text-[var(--warn)]" : "text-[var(--ink2)]"
                }`}
              >
                {group.label}
              </span>
              {group.note && <span className="text-[var(--ink3)]">{group.note}</span>}
            </div>
          )}
          <ul className="space-y-0 px-3">
            {group.tasks.map((task) => {
              const active = task.id === selectedId;
              return (
                <li key={task.id}>
                  <div
                    role="button"
                    tabIndex={0}
                    aria-current={active ? "true" : undefined}
                    onClick={() => onSelect(task.id)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        onSelect(task.id);
                      }
                    }}
                    className={`${rowClass(active)} flex gap-3 rounded-xl border-b border-[var(--border)] px-3 py-3.5 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] ${
                      active ? "border border-[var(--accent)]/60" : ""
                    }`}
                  >
                    <CompleteBox task={task} onReopen={onReopen} />
                    <span className="min-w-0 flex-1">
                      <span className={`block truncate text-[14px] font-semibold ${task.status === "COMPLETED" ? "text-[var(--ink3)] line-through" : "text-[var(--ink)]"}`}>
                        {task.title}
                      </span>
                      {task.description && <span className="mt-0.5 block truncate text-[12.5px] text-[var(--ink2)]">{task.description}</span>}
                      <span className="mt-2 block">
                        <TaskChips task={task} />
                      </span>
                    </span>
                    <span className="flex shrink-0 flex-col items-end gap-2 text-right text-[12px]">
                      <span className={task.status === "COMPLETED" ? "text-[var(--ink3)]" : dueClass(task)}>
                        {task.status === "COMPLETED" && task.completedAt ? `Done ${shortDay(task.completedAt)}` : dueLabel(task.dueAt)}
                      </span>
                      <span className={`flex items-center gap-1 ${PRIORITY_CLASS[task.priority]}`}>
                        {(task.priority === "HIGH" || task.priority === "URGENT") && <Flag className="h-3 w-3" aria-hidden />}
                        {PRIORITY_LABEL[task.priority]}
                      </span>
                    </span>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </div>
  );
}

function SourceLine({ task }: { task: Task }) {
  if (!task.hasLinkedEmail && !task.isAssigned) return null;
  return (
    <span className="mt-0.5 flex items-center gap-1 truncate text-[11.5px] text-[var(--accent-ink)]">
      <Mail className="h-3 w-3 shrink-0" aria-hidden />
      {[task.hasLinkedEmail ? "Linked email" : null, task.isAssigned ? `Assigned by ${task.createdBy.displayName}` : null].filter(Boolean).join(" · ")}
    </span>
  );
}

const th = "px-3 py-2.5 text-left text-[10.5px] font-semibold uppercase tracking-[0.1em] text-[var(--ink3)]";

function TableRow({ task, active, onSelect, children }: { task: Task; active: boolean; onSelect: (id: string) => void; children: React.ReactNode }) {
  return (
    <tr
      tabIndex={0}
      aria-selected={active}
      onClick={() => onSelect(task.id)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onSelect(task.id);
        }
      }}
      // No ::before on a <tr>: tables lay it out as an extra cell. The selection bar is the first cell's inset shadow.
      className={`cursor-pointer border-b border-[var(--border)] transition focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--accent)] ${
        active ? "bg-[var(--zm-selected)] [&>td:first-child]:shadow-[inset_3px_0_0_var(--accent)]" : "hover:bg-[var(--s2)]"
      }`}
    >
      {children}
    </tr>
  );
}

function TaskCell({ task }: { task: Task }) {
  return (
    <td className="max-w-0 px-3 py-3 pl-5">
      <span className="block truncate text-[13.5px] font-semibold text-[var(--ink)]">{task.title}</span>
      {task.description && <span className="block truncate text-[12px] text-[var(--ink2)]">{task.description}</span>}
      <SourceLine task={task} />
    </td>
  );
}

/** Overdue: by original due date, with how late each one is. */
export function OverdueTable({ tasks, selectedId, onSelect }: { tasks: Task[]; selectedId: string | null; onSelect: (id: string) => void }) {
  return (
    <table className="w-full table-fixed" data-testid="task-list">
      <thead className="sticky top-0 bg-[var(--surface)]">
        <tr className="border-b border-[var(--border)]">
          <th className={`${th} pl-5`}>Task / source</th>
          <th className={`${th} w-[130px]`}>Original due</th>
          <th className={`${th} w-[100px]`}>Overdue</th>
          <th className={`${th} w-[90px]`}>Priority</th>
        </tr>
      </thead>
      <tbody>
        {tasks.map((task) => {
          const due = task.originalDueAt ?? task.dueAt;
          return (
            <TableRow key={task.id} task={task} active={task.id === selectedId} onSelect={onSelect}>
              <TaskCell task={task} />
              <td className="px-3 py-3 text-[12.5px] text-[var(--ink)]">
                {due ? (
                  <>
                    <span className="block font-semibold">{shortDay(due)}</span>
                    <span className="text-[var(--ink3)]">{clock(due)}</span>
                  </>
                ) : (
                  "–"
                )}
              </td>
              <td className="px-3 py-3">
                <span className="inline-flex rounded-lg bg-[var(--crit-soft)] px-2.5 py-1 text-[12px] font-semibold text-[var(--crit)]">
                  {task.daysOverdue} {task.daysOverdue === 1 ? "day" : "days"}
                </span>
              </td>
              <td className={`px-3 py-3 text-[12.5px] ${PRIORITY_CLASS[task.priority]}`}>{PRIORITY_SHORT[task.priority]}</td>
            </TableRow>
          );
        })}
      </tbody>
    </table>
  );
}

/** Completed: a read-only history of who finished what, and when. */
export function CompletedTable({ tasks, selectedId, onSelect }: { tasks: Task[]; selectedId: string | null; onSelect: (id: string) => void }) {
  return (
    <table className="w-full table-fixed" data-testid="task-list">
      <thead className="sticky top-0 bg-[var(--surface)]">
        <tr className="border-b border-[var(--border)]">
          <th className={`${th} pl-5`}>Task / linked source</th>
          <th className={`${th} w-[140px]`}>Completed by</th>
          <th className={`${th} w-[110px]`}>Completed</th>
          <th className={`${th} w-[90px]`}>Priority</th>
        </tr>
      </thead>
      <tbody>
        {tasks.map((task) => (
          <TableRow key={task.id} task={task} active={task.id === selectedId} onSelect={onSelect}>
            <TaskCell task={task} />
            <td className="px-3 py-3 text-[12.5px] text-[var(--ink)]">
              {task.completedBy ? (
                <span className="flex items-center gap-2">
                  <span className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[var(--accent)] text-[10px] font-bold text-white" aria-hidden>
                    {initials(task.completedBy.displayName || task.completedBy.email)}
                  </span>
                  <span className="truncate">{task.completedBy.displayName.split(" ")[0]}</span>
                </span>
              ) : (
                "–"
              )}
            </td>
            <td className="px-3 py-3 text-[12.5px] text-[var(--ink)]">
              {task.completedAt ? (
                <>
                  <span className="block font-semibold">{shortDay(task.completedAt)}</span>
                  <span className="text-[var(--ink3)]">{clock(task.completedAt)}</span>
                </>
              ) : (
                "–"
              )}
            </td>
            <td className={`px-3 py-3 text-[12.5px] ${PRIORITY_CLASS[task.priority]}`}>{PRIORITY_SHORT[task.priority]}</td>
          </TableRow>
        ))}
      </tbody>
    </table>
  );
}
