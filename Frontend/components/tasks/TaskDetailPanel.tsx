"use client";

import Link from "next/link";
import { useState, type ReactNode } from "react";
import {
  AlertTriangle,
  ArrowLeft,
  ArrowUpRight,
  BellRing,
  CalendarClock,
  Check,
  CheckCircle2,
  Eye,
  EyeOff,
  Lock,
  Mail,
  MoreHorizontal,
  Pencil,
  Plus,
  RotateCcw,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import { BrandLoader } from "@/components/ui/BrandLoader";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { Spinner } from "@/components/ui/Spinner";
import { DropdownItem, DropdownMenu } from "@/components/ui/DropdownMenu";
import {
  useAddChecklistItem,
  useCompleteTask,
  useDeleteTask,
  useFollowTask,
  useRemoveChecklistItem,
  useTask,
  useTaskActivity,
  useToggleChecklistItem,
  useUpdateTask,
} from "@/lib/tasks-hooks";
import type { EditableTaskStatus, LinkedEmail, TaskDetail, TaskUser } from "@/lib/tasks-api";
import { ReminderDialog, ReopenDialog, RescheduleDialog, TaskDialog } from "./TaskDialogs";
import { teamHref } from "./TasksSidebar";
import { PRIORITY_SHORT, STATUS_DOT, STATUS_LABEL, dueLong, initials, stamp } from "./format";

/** Where "Open source email" goes: the mailbox, with that message open. */
export function emailHref(email: Extract<LinkedEmail, { accessible: true }>): string {
  const params = new URLSearchParams({ message: email.messageId });
  if (email.folder) params.set("folder", email.folder);
  // In a shared inbox: open that inbox, not one's own.
  if (email.mailboxId) params.set("mailbox", email.mailboxId);
  return `/mail?${params}`;
}

function Avatar({ user }: { user: TaskUser }) {
  return (
    <span className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[var(--accent)] text-[10px] font-bold text-white" aria-hidden>
      {initials(user.displayName || user.email)}
    </span>
  );
}

function Person({ user, meId }: { user: TaskUser; meId: string | undefined }) {
  return (
    <span className="flex items-center gap-2">
      <Avatar user={user} />
      <span className="truncate">
        {user.displayName || user.email}
        {user.id === meId && <span className="text-[var(--ink3)]"> (you)</span>}
      </span>
    </span>
  );
}

function Row({ term, children }: { term: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[110px_minmax(0,1fr)] items-center gap-3 py-1.5 text-[13px]">
      <dt className="text-[var(--ink3)]">{term}</dt>
      <dd className="min-w-0 font-medium text-[var(--ink)]">{children}</dd>
    </div>
  );
}

function Section({ title, aside, children }: { title: string; aside?: ReactNode; children: ReactNode }) {
  return (
    <section className="border-t border-[var(--border)] pt-4">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h3 className="text-[13px] font-semibold text-[var(--ink)]">{title}</h3>
        {aside && <span className="text-[12px] text-[var(--ink3)]">{aside}</span>}
      </div>
      {children}
    </section>
  );
}

function Callout({ tone, children }: { tone: "crit" | "warn" | "ok"; children: ReactNode }) {
  const cls =
    tone === "crit"
      ? "border-[var(--crit)]/40 bg-[var(--crit-soft)] text-[var(--crit)]"
      : tone === "warn"
        ? "border-[var(--warn)]/40 bg-[var(--warn-soft)] text-[var(--warn)]"
        : "border-[var(--ok)]/40 bg-[var(--ok-soft)] text-[var(--ok)]";
  const Icon = tone === "ok" ? CheckCircle2 : AlertTriangle;
  return (
    <div className={`flex gap-2 rounded-xl border px-3 py-2.5 text-[12.5px] leading-relaxed ${cls}`}>
      <Icon className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
      <span>{children}</span>
    </div>
  );
}

function Soon() {
  return <span className="rounded-full border border-[var(--border)] px-1.5 text-[9.5px] font-semibold uppercase tracking-wide text-[var(--ink3)]">Soon</span>;
}

function Checklist({ task }: { task: TaskDetail }) {
  const toggle = useToggleChecklistItem();
  const add = useAddChecklistItem();
  const remove = useRemoveChecklistItem();
  const [text, setText] = useState("");
  const readOnly = task.status === "COMPLETED";
  const submit = () => {
    const value = text.trim();
    if (!value) return;
    add.mutate({ id: task.id, text: value }, { onSuccess: () => setText("") });
  };

  return (
    <Section title="Checklist" aside={task.checklistProgress.total > 0 ? `${task.checklistProgress.done} of ${task.checklistProgress.total} complete` : undefined}>
      {task.checklist.length === 0 && readOnly && <p className="text-[12.5px] text-[var(--ink3)]">No checklist.</p>}
      <ul className="space-y-0.5">
        {task.checklist.map((item) => (
          <li key={item.id} className="group flex items-center gap-3 rounded-lg px-1 py-1.5 hover:bg-[var(--s2)]">
            <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-3 text-[13px]">
              <input
                type="checkbox"
                className="peer sr-only"
                checked={item.done}
                disabled={readOnly}
                onChange={(e) => toggle.mutate({ id: task.id, itemId: item.id, done: e.target.checked })}
              />
              <span
                aria-hidden
                className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-[4px] border peer-focus-visible:ring-2 peer-focus-visible:ring-[var(--accent)] ${
                  item.done ? "border-[var(--accent)] bg-[var(--accent)]" : "border-[var(--bstrong,var(--border))]"
                }`}
              >
                {item.done && <Check className="h-3 w-3 text-white" strokeWidth={3} />}
              </span>
              <span className={`truncate ${item.done ? "text-[var(--ink3)] line-through" : "text-[var(--ink)]"}`}>{item.text}</span>
            </label>
            {!readOnly && (
              <button
                type="button"
                aria-label={`Remove ${item.text}`}
                onClick={() => remove.mutate({ id: task.id, itemId: item.id })}
                className="rounded p-0.5 text-[var(--ink3)] opacity-0 transition hover:text-[var(--crit)] focus:opacity-100 group-hover:opacity-100"
              >
                <X className="h-3.5 w-3.5" aria-hidden />
              </button>
            )}
          </li>
        ))}
      </ul>
      {!readOnly && (
        <div className="mt-2 flex gap-2">
          <input
            className="zoiko-input flex-1"
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                submit();
              }
            }}
            maxLength={500}
            placeholder="Add a step"
            aria-label="Add a checklist step"
          />
          <button type="button" className="zoiko-btn" onClick={submit} disabled={!text.trim() || add.isPending} aria-label="Add step">
            <Plus className="h-4 w-4" aria-hidden />
          </button>
        </div>
      )}
      {(add.error || remove.error || toggle.error) && (
        <p role="alert" className="mt-2 text-[12px] text-[var(--crit)]">
          {((add.error ?? remove.error ?? toggle.error) as Error).message}
        </p>
      )}
    </Section>
  );
}

/** Follow a task you do not own, to hear when it is completed, handed over or reopened. */
function FollowButton({ task }: { task: TaskDetail }) {
  const follow = useFollowTask();
  const on = task.isFollowing;
  return (
    <button
      type="button"
      aria-pressed={on}
      disabled={follow.isPending}
      onClick={() => follow.mutate({ id: task.id, follow: !on })}
      title={on ? "Stop following" : "Hear when this is completed, handed over or reopened"}
      className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-[12px] font-medium transition disabled:opacity-60 ${
        on ? "border-[var(--accent)]/50 bg-[var(--accent-soft)] text-[var(--accent-ink)]" : "border-[var(--border)] text-[var(--ink2)] hover:bg-[var(--s2)]"
      }`}
    >
      {on ? <EyeOff className="h-3.5 w-3.5" aria-hidden /> : <Eye className="h-3.5 w-3.5" aria-hidden />}
      {on ? "Following" : "Follow"}
      {task.followerCount > 0 && <span className="text-[var(--ink3)]">· {task.followerCount}</span>}
    </button>
  );
}

/** The task's history from the audit log, newest first. */
function Activity({ taskId }: { taskId: string }) {
  const activity = useTaskActivity(taskId);
  const [all, setAll] = useState(false);
  const items = [...(activity.data ?? [])].reverse();
  const shown = all ? items : items.slice(0, 4);
  return (
    <Section title="Activity" aside={items.length ? `${items.length} ${items.length === 1 ? "event" : "events"}` : undefined}>
      {activity.isLoading ? (
        <Spinner size="sm" label="Loading activity" className="text-[12.5px]" />
      ) : activity.isError ? (
        <p className="text-[12.5px] text-[var(--ink3)]">History is not available right now.</p>
      ) : items.length === 0 ? (
        <p className="text-[12.5px] text-[var(--ink3)]">No history yet.</p>
      ) : (
        <ol className="space-y-2" data-testid="task-activity">
          {shown.map((item) => (
            <li key={item.id} className="flex gap-2.5 text-[12.5px]">
              <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${item.type.includes("COMPLETED") || item.label === "Marked complete" ? "bg-[var(--ok)]" : "bg-[var(--accent)]"}`} aria-hidden />
              <span className="min-w-0">
                <span className="text-[var(--ink)]">{item.label}</span>
                <span className="block text-[11.5px] text-[var(--ink3)]">
                  {item.actor ? `${item.actor.displayName} · ` : ""}
                  {stamp(item.at)}
                </span>
              </span>
            </li>
          ))}
        </ol>
      )}
      {items.length > 4 && (
        <button type="button" onClick={() => setAll((v) => !v)} className="mt-2 text-[12px] font-medium text-[var(--accent-ink)] hover:underline">
          {all ? "Show less" : `Show all ${items.length}`}
        </button>
      )}
    </Section>
  );
}

function Correspondence({ email }: { email: LinkedEmail }) {
  if (!email.accessible) {
    return (
      <Section title="Linked correspondence" aside="Source context">
        <div className="flex items-center gap-3 rounded-xl border border-[var(--border)] bg-[var(--s2)] p-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[var(--s3)] text-[var(--ink3)]">
            <Lock className="h-4 w-4" aria-hidden />
          </span>
          <span className="min-w-0 text-[12.5px]">
            <span className="block font-semibold text-[var(--ink)]">Linked email</span>
            <span className="text-[var(--ink3)]">Opens only with mailbox permission</span>
          </span>
        </div>
      </Section>
    );
  }
  return (
    <Section title="Linked correspondence" aside="Source context">
      <div className="flex items-start gap-3 rounded-xl border border-[var(--border)] bg-[var(--s2)] p-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[var(--accent-soft)] text-[var(--accent-ink)]">
          <Mail className="h-4 w-4" aria-hidden />
        </span>
        <span className="min-w-0 flex-1 text-[12.5px]">
          <span className="block truncate font-semibold text-[var(--ink)]">{email.subject || "(no subject)"}</span>
          <span className="block truncate text-[var(--ink3)]">
            {email.fromName || email.fromAddress || "Unknown sender"} · {stamp(email.sentAt)}
          </span>
          <Link href={emailHref(email)} className="mt-1 inline-flex items-center gap-1 font-medium text-[var(--accent-ink)] hover:underline">
            Open source email <ArrowUpRight className="h-3.5 w-3.5" aria-hidden />
          </Link>
        </span>
      </div>
    </Section>
  );
}

/**
 * The right-hand panel: what the task is, who has it, when it is due, its
 * checklist and the email it came from, with the actions along the bottom.
 */
export function TaskDetailPanel({
  taskId,
  meId,
  showNextStep,
  onClose,
}: {
  taskId: string;
  meId: string | undefined;
  /** Today's page shows where Alet's suggested next step will sit. */
  showNextStep?: boolean;
  /** Phones show the panel full screen, with a way back to the list. */
  onClose?: () => void;
}) {
  const detail = useTask(taskId);
  const complete = useCompleteTask();
  const update = useUpdateTask();
  const remove = useDeleteTask();
  const [dialog, setDialog] = useState<"edit" | "reschedule" | "reminder" | "reopen" | "delete" | null>(null);

  const shell = (body: ReactNode) => (
    <section aria-label="Task details" className="flex min-h-0 flex-col overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--surface)]">
      {body}
    </section>
  );

  if (detail.isLoading) {
    return shell(<BrandLoader variant="compact" label="Loading this task" onRetry={() => void detail.refetch()} />);
  }
  const task = detail.data;
  if (detail.isError || !task) {
    return shell(
      <p className="p-6 text-[13px] text-[var(--ink2)]" role="alert">
        This task is no longer available. It may have been deleted, or it is not shared with you.
      </p>
    );
  }

  const completed = task.status === "COMPLETED";
  const canEditStatus = !completed && (["OPEN", "PLANNED", "IN_PROGRESS"] as string[]).includes(task.status);
  const badge = completed ? (
    <span className="zoiko-pill ok">
      <Check className="h-3 w-3" aria-hidden /> Completed
    </span>
  ) : task.dueState === "overdue" ? (
    <span className="zoiko-pill crit">
      {task.daysOverdue} {task.daysOverdue === 1 ? "day" : "days"} overdue
    </span>
  ) : task.priority === "HIGH" || task.priority === "URGENT" ? (
    <span className={`zoiko-pill ${task.priority === "URGENT" ? "crit" : "warn"}`}>{task.priority === "URGENT" ? "Urgent" : "High priority"}</span>
  ) : null;

  return shell(
    <>
      <div className="flex items-center justify-between gap-2 border-b border-[var(--border)] px-5 py-4">
        <div className="flex items-center gap-2">
          {onClose && (
            <button type="button" onClick={onClose} aria-label="Back to the list" className="rounded-md p-1 text-[var(--ink2)] hover:bg-[var(--s2)] lg:hidden">
              <ArrowLeft className="h-4 w-4" aria-hidden />
            </button>
          )}
          <h2 className="text-[16px] font-semibold text-[var(--ink)]">{completed ? "Completion details" : "Task details"}</h2>
        </div>
        <div className="flex items-center gap-2">
          {badge}
          {task.owner.id !== meId && <FollowButton task={task} />}
        </div>
      </div>

      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4">
        <div>
          <h3 className="text-[20px] font-bold leading-snug tracking-tight text-[var(--ink)]" data-testid="task-detail-title">
            {task.title}
          </h3>
          {task.description ? (
            <p className="mt-2 whitespace-pre-wrap text-[13px] leading-relaxed text-[var(--ink2)]">{task.description}</p>
          ) : (
            <p className="mt-2 text-[12.5px] text-[var(--ink3)]">No description.</p>
          )}
        </div>

        {task.dueState === "overdue" && (
          <Callout tone="crit">The original deadline has passed. Confirm the owner and next action before changing the commitment.</Callout>
        )}

        <dl>
          <Row term="Status">
            {canEditStatus ? (
              <span className="flex items-center gap-2">
                <span className={`h-2 w-2 rounded-full ${STATUS_DOT[task.status]}`} aria-hidden />
                <select
                  aria-label="Status"
                  className="rounded-md border border-transparent bg-transparent py-0.5 pr-6 text-[13px] font-medium text-[var(--accent-ink)] hover:border-[var(--border)] focus:border-[var(--accent)] focus:outline-none"
                  value={task.status}
                  disabled={update.isPending}
                  onChange={(e) => update.mutate({ id: task.id, input: { status: e.target.value as EditableTaskStatus } })}
                >
                  <option value="OPEN">Open</option>
                  <option value="PLANNED">Planned</option>
                  <option value="IN_PROGRESS">In progress</option>
                </select>
              </span>
            ) : (
              <span className="flex items-center gap-2">
                <span className={`h-2 w-2 rounded-full ${STATUS_DOT[task.status]}`} aria-hidden />
                {STATUS_LABEL[task.status]}
              </span>
            )}
          </Row>
          {completed ? (
            <>
              {task.completedBy && (
                <Row term="Completed by">
                  <Person user={task.completedBy} meId={meId} />
                </Row>
              )}
              {task.completedAt && <Row term="Completed at">{stamp(task.completedAt)}</Row>}
              <Row term="Owner">
                <Person user={task.owner} meId={meId} />
              </Row>
              <Row term="Was due">{dueLong(task.dueAt)}</Row>
            </>
          ) : (
            <>
              <Row term={task.team ? "Accountable owner" : "Assigned to"}>
                <Person user={task.owner} meId={meId} />
              </Row>
              {task.isAssigned && (
                <Row term="Assigned by">
                  <Person user={task.createdBy} meId={meId} />
                </Row>
              )}
              <Row term="Due date">{dueLong(task.dueAt)}</Row>
              {task.originalDueAt && <Row term="Original due">{dueLong(task.originalDueAt)}</Row>}
              {task.reminderAt && (
                <Row term="Reminder">
                  <span className={task.reminderSentAt ? "text-[var(--ink3)]" : undefined}>
                    {dueLong(task.reminderAt)}
                    {task.reminderSentAt ? " · sent" : ""}
                  </span>
                </Row>
              )}
            </>
          )}
          <Row term="Priority">{PRIORITY_SHORT[task.priority]}</Row>
          <Row term="Workspace">
            {task.team ? (
              <Link href={teamHref(task.team.id)} className="text-[var(--accent-ink)] hover:underline" title={task.team.address}>
                {task.team.name}
              </Link>
            ) : (
              "Personal"
            )}
          </Row>
        </dl>

        <Checklist task={task} />

        {showNextStep && !completed && (
          <Section title="Recommended next step" aside="Human review">
            <div className="flex items-center gap-3 rounded-xl border border-dashed border-[var(--border)] p-3 text-[12.5px] text-[var(--ink3)]">
              <Sparkles className="h-4 w-4 shrink-0 text-[var(--ai)]" aria-hidden />
              <span className="flex-1">Alet will suggest a next step here. It never acts without your approval.</span>
              <Soon />
            </div>
          </Section>
        )}

        {task.linkedEmail && <Correspondence email={task.linkedEmail} />}

        <Activity taskId={task.id} />

        {completed && (
          <Callout tone="ok">Closing a task preserves its completion record. Reopening requires a reason, which is recorded.</Callout>
        )}

        {(complete.error || update.error) && (
          <p role="alert" className="text-[12px] text-[var(--crit)]">
            {((complete.error ?? update.error) as Error).message}
          </p>
        )}
      </div>

      <div className="flex items-center gap-2 border-t border-[var(--border)] px-5 py-3 [&_.zoiko-btn]:whitespace-nowrap">
        {completed ? (
          <>
            {task.linkedEmail?.accessible && (
              <Link href={emailHref(task.linkedEmail)} className="zoiko-btn pri">
                View source email <ArrowUpRight className="h-4 w-4" aria-hidden />
              </Link>
            )}
            <button type="button" className="zoiko-btn" onClick={() => setDialog("reopen")}>
              <RotateCcw className="h-4 w-4" aria-hidden /> Reopen
            </button>
          </>
        ) : (
          <>
            <button type="button" className="zoiko-btn pri" disabled={complete.isPending} onClick={() => complete.mutate(task.id)}>
              <Check className="h-4 w-4" aria-hidden /> {complete.isPending ? "Completing…" : "Mark complete"}
            </button>
            <button type="button" className="zoiko-btn" onClick={() => setDialog("reschedule")}>
              <CalendarClock className="h-4 w-4" aria-hidden /> Reschedule
            </button>
            <button type="button" className="zoiko-btn" onClick={() => setDialog("reminder")} aria-label="Reminder" title="Set a reminder">
              <BellRing className="h-4 w-4" aria-hidden />
              <span className="hidden xl:inline">Reminder</span>
            </button>
          </>
        )}
        <div className="ml-auto">
          <DropdownMenu trigger={<MoreHorizontal className="h-4 w-4" aria-label="More task actions" />}>
            {!completed && (
              <DropdownItem onClick={() => setDialog("edit")}>
                <span className="flex items-center gap-2">
                  <Pencil className="h-3.5 w-3.5" aria-hidden /> Edit task
                </span>
              </DropdownItem>
            )}
            <DropdownItem danger disabled={task.createdBy.id !== meId} onClick={() => setDialog("delete")}>
              <span className="flex items-center gap-2" title={task.createdBy.id !== meId ? "Only the person who created this task can delete it" : undefined}>
                <Trash2 className="h-3.5 w-3.5" aria-hidden /> Delete task
              </span>
            </DropdownItem>
          </DropdownMenu>
        </div>
      </div>

      {dialog === "edit" && <TaskDialog mode={{ kind: "edit", task }} onClose={() => setDialog(null)} />}
      {dialog === "reschedule" && <RescheduleDialog task={task} onClose={() => setDialog(null)} />}
      {dialog === "reminder" && <ReminderDialog task={task} onClose={() => setDialog(null)} />}
      {dialog === "reopen" && <ReopenDialog task={task} onClose={() => setDialog(null)} />}
      <ConfirmDialog
        open={dialog === "delete"}
        onClose={() => setDialog(null)}
        onConfirm={() => remove.mutate(task.id, { onSuccess: () => { setDialog(null); onClose?.(); } })}
        title="Delete this task?"
        message="It leaves every list. The record is kept for the workspace's audit trail."
        confirmLabel="Delete task"
        variant="danger"
        loading={remove.isPending}
      />
    </>
  );
}
