"use client";

import { useState, type FormEvent, type ReactNode } from "react";
import { Mail, Plus, X } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { useCreateTask, useCreateTaskFromMessage, useReopenTask, useRescheduleTask, useUpdateTask } from "@/lib/tasks-hooks";
import type { EditableTaskStatus, Task, TaskDetail, TaskPriority } from "@/lib/tasks-api";
import { dueLong } from "./format";

const PRIORITIES: { value: TaskPriority; label: string }[] = [
  { value: "LOW", label: "Low" },
  { value: "MEDIUM", label: "Normal" },
  { value: "HIGH", label: "High" },
  { value: "URGENT", label: "Urgent" },
];

const STATUSES: { value: EditableTaskStatus; label: string }[] = [
  { value: "OPEN", label: "Open" },
  { value: "PLANNED", label: "Planned" },
  { value: "IN_PROGRESS", label: "In progress" },
];

const pad = (n: number) => String(n).padStart(2, "0");
const dateInput = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const timeInput = (d: Date) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;

/** Local date and optional time → ISO. A date alone means that day, with no time. */
function toIso(date: string, time: string): string | null {
  if (!date) return null;
  const [y, m, d] = date.split("-").map(Number);
  const [hh, mm] = (time || "00:00").split(":").map(Number);
  return new Date(y!, (m ?? 1) - 1, d ?? 1, hh ?? 0, mm ?? 0).toISOString();
}

function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-[12px] font-semibold text-[var(--ink2)]">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-[11.5px] text-[var(--ink3)]">{hint}</span>}
    </label>
  );
}

function ErrorLine({ error }: { error: unknown }) {
  if (!error) return null;
  return (
    <p role="alert" className="mt-3 text-[12.5px] text-[var(--crit)]">
      {error instanceof Error ? error.message : "Something went wrong. Please try again."}
    </p>
  );
}

export type TaskDialogMode =
  | { kind: "create" }
  | { kind: "edit"; task: Task }
  | { kind: "from-message"; messageId: string; subject: string };

/** New task, edit task, and "create task from this email" — one form. */
export function TaskDialog({ mode, onClose, onSaved }: { mode: TaskDialogMode; onClose: () => void; onSaved?: (task: TaskDetail) => void }) {
  const editing = mode.kind === "edit" ? mode.task : null;
  const initialDue = editing?.dueAt ? new Date(editing.dueAt) : null;
  const [title, setTitle] = useState(
    editing?.title ?? (mode.kind === "from-message" ? (mode.subject.trim() ? `Follow up: ${mode.subject.trim()}` : "Follow up on email") : "")
  );
  const [description, setDescription] = useState(editing?.description ?? "");
  const [date, setDate] = useState(initialDue ? dateInput(initialDue) : "");
  const [time, setTime] = useState(initialDue && (initialDue.getHours() || initialDue.getMinutes()) ? timeInput(initialDue) : "");
  const [priority, setPriority] = useState<TaskPriority>(editing?.priority ?? "MEDIUM");
  const editableStatus = !editing || STATUSES.some((s) => s.value === editing.status);
  const [status, setStatus] = useState<EditableTaskStatus>(editing && editableStatus ? (editing.status as EditableTaskStatus) : "OPEN");
  const [checklist, setChecklist] = useState<string[]>([]);
  const [step, setStep] = useState("");

  const create = useCreateTask();
  const fromMessage = useCreateTaskFromMessage();
  const update = useUpdateTask();
  const pending = create.isPending || fromMessage.isPending || update.isPending;
  const error = create.error ?? fromMessage.error ?? update.error;

  const addStep = () => {
    const text = step.trim();
    if (!text) return;
    setChecklist((items) => [...items, text]);
    setStep("");
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!title.trim() || pending) return;
    const dueAt = toIso(date, time);
    const pendingStep = step.trim();
    const steps = pendingStep ? [...checklist, pendingStep] : checklist;
    const done = (task: TaskDetail) => {
      onSaved?.(task);
      onClose();
    };
    if (mode.kind === "edit") {
      update.mutate(
        {
          id: mode.task.id,
          input: {
            title: title.trim(),
            description: description.trim() || null,
            dueAt,
            priority,
            ...(editableStatus ? { status } : {}),
          },
        },
        { onSuccess: done }
      );
    } else if (mode.kind === "from-message") {
      fromMessage.mutate(
        { messageId: mode.messageId, input: { title: title.trim(), description: description.trim() || null, dueAt, priority, status, checklist: steps } },
        { onSuccess: done }
      );
    } else {
      create.mutate({ title: title.trim(), description: description.trim() || null, dueAt, priority, status, checklist: steps }, { onSuccess: done });
    }
  };

  const heading = mode.kind === "edit" ? "Edit task" : mode.kind === "from-message" ? "Create task from email" : "New task";

  return (
    <Modal
      open
      onClose={onClose}
      title={heading}
      footer={
        <>
          <button type="button" className="zoiko-btn" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" form="task-form" className="zoiko-btn pri" disabled={!title.trim() || pending}>
            {pending ? "Saving…" : mode.kind === "edit" ? "Save changes" : "Create task"}
          </button>
        </>
      }
    >
      <form id="task-form" onSubmit={submit} className="space-y-4">
        {mode.kind === "from-message" && (
          <div className="flex items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--s2)] px-3 py-2 text-[12.5px] text-[var(--ink2)]">
            <Mail className="h-4 w-4 shrink-0 text-[var(--accent-ink)]" aria-hidden />
            <span className="truncate">Linked to “{mode.subject || "(no subject)"}”</span>
          </div>
        )}
        <Field label="Title">
          <input className="zoiko-input w-full" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={500} autoFocus required placeholder="What needs doing?" />
        </Field>
        <Field label="Description">
          <textarea
            className="zoiko-input min-h-[84px] w-full resize-y"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            maxLength={10_000}
            placeholder="Add the context someone would need"
          />
        </Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Due date">
            <input type="date" className="zoiko-input w-full" value={date} onChange={(e) => setDate(e.target.value)} />
          </Field>
          <Field label="Time" hint="Optional">
            <input type="time" className="zoiko-input w-full" value={time} onChange={(e) => setTime(e.target.value)} disabled={!date} />
          </Field>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Priority">
            <select className="zoiko-input w-full" value={priority} onChange={(e) => setPriority(e.target.value as TaskPriority)}>
              {PRIORITIES.map((p) => (
                <option key={p.value} value={p.value}>
                  {p.label}
                </option>
              ))}
            </select>
          </Field>
          {editableStatus && (
            <Field label="Status">
              <select className="zoiko-input w-full" value={status} onChange={(e) => setStatus(e.target.value as EditableTaskStatus)}>
                {STATUSES.map((s) => (
                  <option key={s.value} value={s.value}>
                    {s.label}
                  </option>
                ))}
              </select>
            </Field>
          )}
        </div>
        {mode.kind !== "edit" && (
          <div>
            <span className="mb-1.5 block text-[12px] font-semibold text-[var(--ink2)]">Checklist</span>
            {checklist.length > 0 && (
              <ul className="mb-2 space-y-1">
                {checklist.map((item, i) => (
                  <li key={`${item}-${i}`} className="flex items-center gap-2 rounded-lg bg-[var(--s2)] px-3 py-1.5 text-[13px] text-[var(--ink)]">
                    <span className="flex-1 truncate">{item}</span>
                    <button
                      type="button"
                      aria-label={`Remove ${item}`}
                      onClick={() => setChecklist((items) => items.filter((_, j) => j !== i))}
                      className="rounded p-0.5 text-[var(--ink3)] hover:text-[var(--ink)]"
                    >
                      <X className="h-3.5 w-3.5" aria-hidden />
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <div className="flex gap-2">
              <input
                className="zoiko-input flex-1"
                value={step}
                onChange={(e) => setStep(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    addStep();
                  }
                }}
                maxLength={500}
                placeholder="Add a step"
                aria-label="New checklist step"
              />
              <button type="button" className="zoiko-btn" onClick={addStep} disabled={!step.trim()}>
                <Plus className="h-4 w-4" aria-hidden /> Add
              </button>
            </div>
          </div>
        )}
        <ErrorLine error={error} />
      </form>
    </Modal>
  );
}

function nextMonday(from: Date): Date {
  const d = new Date(from.getFullYear(), from.getMonth(), from.getDate(), 9, 0);
  const add = ((8 - d.getDay()) % 7) || 7;
  d.setDate(d.getDate() + add);
  return d;
}

/** Move a task's due date. The first due date is kept by the server. */
export function RescheduleDialog({ task, onClose }: { task: Task; onClose: () => void }) {
  const reschedule = useRescheduleTask();
  const now = new Date();
  const base = task.dueAt ? new Date(task.dueAt) : now;
  const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 9, 0);
  const laterToday = new Date(now.getTime() + 3 * 3_600_000);
  laterToday.setMinutes(0, 0, 0);
  const inAWeek = new Date(Math.max(base.getTime(), now.getTime()));
  inAWeek.setDate(inAWeek.getDate() + 7);
  const options = [
    ...(laterToday.getDate() === now.getDate() ? [{ label: "Later today", date: laterToday }] : []),
    { label: "Tomorrow", date: tomorrow },
    { label: "Next Monday", date: nextMonday(now) },
    { label: "In one week", date: inAWeek },
  ];
  const [date, setDate] = useState(dateInput(tomorrow));
  const [time, setTime] = useState("09:00");

  const go = (iso: string) => reschedule.mutate({ id: task.id, dueAt: iso }, { onSuccess: onClose });

  return (
    <Modal
      open
      onClose={onClose}
      title="Reschedule task"
      size="sm"
      footer={
        <>
          <button type="button" className="zoiko-btn" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="zoiko-btn pri" disabled={!date || reschedule.isPending} onClick={() => go(toIso(date, time)!)}>
            {reschedule.isPending ? "Saving…" : "Reschedule"}
          </button>
        </>
      }
    >
      <p className="text-[13px] text-[var(--ink2)]">
        <b className="text-[var(--ink)]">{task.title}</b>
        <br />
        Currently due {dueLong(task.dueAt)}
        {task.originalDueAt && <> · originally {dueLong(task.originalDueAt)}</>}
      </p>
      <div className="mt-4 grid grid-cols-2 gap-2">
        {options.map((option) => (
          <button
            key={option.label}
            type="button"
            disabled={reschedule.isPending}
            onClick={() => go(option.date.toISOString())}
            className="rounded-lg border border-[var(--border)] px-3 py-2 text-left transition hover:border-[var(--accent)] hover:bg-[var(--s2)] disabled:opacity-50"
          >
            <span className="block text-[13px] font-semibold text-[var(--ink)]">{option.label}</span>
            <span className="block text-[11.5px] text-[var(--ink3)]">{dueLong(option.date.toISOString())}</span>
          </button>
        ))}
      </div>
      <div className="mt-4 grid grid-cols-2 gap-3">
        <Field label="Pick a date">
          <input type="date" className="zoiko-input w-full" value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>
        <Field label="Time">
          <input type="time" className="zoiko-input w-full" value={time} onChange={(e) => setTime(e.target.value)} />
        </Field>
      </div>
      <ErrorLine error={reschedule.error} />
    </Modal>
  );
}

/** Reopening a completed task needs a reason, which is kept with the record. */
export function ReopenDialog({ task, onClose }: { task: Task; onClose: () => void }) {
  const reopen = useReopenTask();
  const [reason, setReason] = useState("");
  const valid = reason.trim().length >= 3;
  return (
    <Modal
      open
      onClose={onClose}
      title="Reopen task"
      size="sm"
      footer={
        <>
          <button type="button" className="zoiko-btn" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="zoiko-btn pri"
            disabled={!valid || reopen.isPending}
            onClick={() => reopen.mutate({ id: task.id, reason: reason.trim() }, { onSuccess: onClose })}
          >
            {reopen.isPending ? "Reopening…" : "Reopen task"}
          </button>
        </>
      }
    >
      <p className="mb-3 text-[13px] text-[var(--ink2)]">
        <b className="text-[var(--ink)]">{task.title}</b> goes back on the open list. The reason is recorded with its completion history.
      </p>
      <Field label="Reason for reopening">
        <textarea
          className="zoiko-input min-h-[80px] w-full resize-y"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          maxLength={500}
          autoFocus
          placeholder="e.g. The client asked for one more change"
        />
      </Field>
      <ErrorLine error={reopen.error} />
    </Modal>
  );
}
