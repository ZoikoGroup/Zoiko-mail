"use client";

import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import { Mail, Plus, X } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { useMe } from "@/lib/auth-hooks";
import {
  useAssignees,
  useCreateTask,
  useCreateTaskFromMessage,
  useReopenTask,
  useRescheduleTask,
  useTaskTeams,
  useUpdateTask,
} from "@/lib/tasks-hooks";
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
  | { kind: "create"; teamId?: string }
  | { kind: "edit"; task: Task }
  /** `mailboxId`: the shared inbox the email was read in, whose team it then belongs to. */
  | { kind: "from-message"; messageId: string; subject: string; mailboxId?: string };

type ReminderChoice = "none" | "due" | "1h" | "1d" | "custom";

/** When the reminder fires, from the choice and the due date it is relative to. */
function reminderIso(choice: ReminderChoice, dueAt: string | null, date: string, time: string): string | null {
  if (choice === "none") return null;
  if (choice === "custom") return toIso(date, time || "09:00");
  if (!dueAt) return null;
  const due = new Date(dueAt).getTime();
  return new Date(choice === "due" ? due : choice === "1h" ? due - 3_600_000 : due - 86_400_000).toISOString();
}

/** New task, edit task, and "create task from this email" — one form. */
export function TaskDialog({ mode, onClose, onSaved }: { mode: TaskDialogMode; onClose: () => void; onSaved?: (task: TaskDetail) => void }) {
  const editing = mode.kind === "edit" ? mode.task : null;
  const { data: me } = useMe();
  const { data: teams = [] } = useTaskTeams();
  const [teamId, setTeamId] = useState<string>(
    editing?.team?.id ?? (mode.kind === "create" ? mode.teamId ?? "" : mode.kind === "from-message" ? mode.mailboxId ?? "" : "")
  );
  // A shared inbox that is not a team of mine (a delegated mailbox) is no team.
  const team = teams.find((t) => t.id === teamId) ?? null;
  const [ownerId, setOwnerId] = useState<string>(editing?.owner.id ?? "");
  const [personSearch, setPersonSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedSearch(personSearch.trim()), 250);
    return () => window.clearTimeout(timer);
  }, [personSearch]);
  const assignees = useAssignees(team?.id ?? null, team ? "" : debouncedSearch);
  const initialReminder = editing?.reminderAt ? new Date(editing.reminderAt) : null;
  const [reminder, setReminder] = useState<ReminderChoice>(initialReminder ? "custom" : "none");
  const [reminderDate, setReminderDate] = useState(initialReminder ? dateInput(initialReminder) : "");
  const [reminderTime, setReminderTime] = useState(initialReminder ? timeInput(initialReminder) : "09:00");
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

  // The people offered: the team's members, or workspace matches — always
  // including the current owner and me, so the choice on screen is never blank.
  const people = useMemo(() => {
    const list = [...(assignees.data ?? [])];
    if (me && !list.some((p) => p.id === me.id)) list.unshift({ id: me.id, displayName: me.displayName, email: me.email, avatarUrl: null, isMe: true });
    if (editing && !list.some((p) => p.id === editing.owner.id)) list.push({ ...editing.owner, isMe: editing.owner.id === me?.id });
    return list;
  }, [assignees.data, me, editing]);
  const owner = ownerId || me?.id || "";
  // Moving to a team whose members do not include the chosen owner: back to me.
  useEffect(() => {
    if (team && assignees.data && ownerId && !assignees.data.some((p) => p.id === ownerId)) setOwnerId(me?.id ?? "");
  }, [team, assignees.data, ownerId, me]);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!title.trim() || pending) return;
    const dueAt = toIso(date, time);
    const reminderAt = reminderIso(reminder, dueAt, reminderDate, reminderTime);
    const pendingStep = step.trim();
    const steps = pendingStep ? [...checklist, pendingStep] : checklist;
    const done = (task: TaskDetail) => {
      onSaved?.(task);
      onClose();
    };
    const common = {
      title: title.trim(),
      description: description.trim() || null,
      dueAt,
      priority,
      ...(owner && owner !== me?.id ? { ownerUserId: owner } : {}),
      teamId: team?.id ?? null,
      reminderAt,
    };
    if (mode.kind === "edit") {
      const t = mode.task;
      update.mutate(
        {
          id: t.id,
          input: {
            title: common.title,
            description: common.description,
            dueAt,
            priority,
            ...(editableStatus ? { status } : {}),
            ...(owner && owner !== t.owner.id ? { ownerUserId: owner } : {}),
            ...(common.teamId !== (t.team?.id ?? null) ? { teamId: common.teamId } : {}),
            ...(reminderAt !== (t.reminderAt ? new Date(t.reminderAt).toISOString() : null) ? { reminderAt } : {}),
          },
        },
        { onSuccess: done }
      );
    } else if (mode.kind === "from-message") {
      fromMessage.mutate(
        { messageId: mode.messageId, input: { ...common, status, checklist: steps, ...(mode.mailboxId ? { mailboxId: mode.mailboxId } : {}) } },
        { onSuccess: done }
      );
    } else {
      create.mutate({ ...common, status, checklist: steps }, { onSuccess: done });
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
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Team workspace" hint={teams.length === 0 ? "You are not on any team yet" : undefined}>
            <select className="zoiko-input w-full" aria-label="Team workspace" value={team?.id ?? ""} onChange={(e) => setTeamId(e.target.value)} disabled={teams.length === 0}>
              <option value="">Personal (no team)</option>
              {teams.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </Field>
          <div>
            <Field label={team ? "Accountable owner" : "Assigned to"}>
              <select className="zoiko-input w-full" aria-label="Assigned to" value={owner} onChange={(e) => setOwnerId(e.target.value)}>
                {people.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.displayName || p.email}
                    {p.isMe ? " (you)" : ""}
                  </option>
                ))}
              </select>
            </Field>
            {!team && (
              <input
                className="zoiko-input mt-1.5 w-full"
                value={personSearch}
                onChange={(e) => setPersonSearch(e.target.value)}
                placeholder="Find someone in the workspace"
                aria-label="Find someone to assign"
              />
            )}
          </div>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Reminder" hint={!date && reminder !== "custom" && reminder !== "none" ? "Set a due date for this reminder" : undefined}>
            <select className="zoiko-input w-full" aria-label="Reminder" value={reminder} onChange={(e) => setReminder(e.target.value as ReminderChoice)}>
              <option value="none">No reminder</option>
              <option value="due" disabled={!date}>
                At the due time
              </option>
              <option value="1h" disabled={!date || !time}>
                1 hour before
              </option>
              <option value="1d" disabled={!date}>
                1 day before
              </option>
              <option value="custom">Pick a time…</option>
            </select>
          </Field>
          {reminder === "custom" && (
            <div className="grid grid-cols-2 gap-2">
              <Field label="Remind on">
                <input type="date" className="zoiko-input w-full" aria-label="Reminder date" value={reminderDate} onChange={(e) => setReminderDate(e.target.value)} />
              </Field>
              <Field label="At">
                <input type="time" className="zoiko-input w-full" aria-label="Reminder time" value={reminderTime} onChange={(e) => setReminderTime(e.target.value)} />
              </Field>
            </div>
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

/** Set or clear when the owner is reminded. The server sends it once, when it comes due. */
export function ReminderDialog({ task, onClose }: { task: Task; onClose: () => void }) {
  const update = useUpdateTask();
  const now = new Date();
  const inAnHour = new Date(now.getTime() + 3_600_000);
  inAnHour.setSeconds(0, 0);
  const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 9, 0);
  const due = task.dueAt ? new Date(task.dueAt) : null;
  const options = [
    { label: "In 1 hour", date: inAnHour },
    { label: "Tomorrow morning", date: tomorrow },
    ...(due && due.getTime() - 86_400_000 > now.getTime() ? [{ label: "1 day before due", date: new Date(due.getTime() - 86_400_000) }] : []),
    ...(due && due > now ? [{ label: "At the due time", date: due }] : []),
  ];
  const [date, setDate] = useState(dateInput(tomorrow));
  const [time, setTime] = useState("09:00");
  const set = (iso: string | null) => update.mutate({ id: task.id, input: { reminderAt: iso } }, { onSuccess: onClose });

  return (
    <Modal
      open
      onClose={onClose}
      title="Set a reminder"
      size="sm"
      footer={
        <>
          {task.reminderAt && (
            <button type="button" className="zoiko-btn mr-auto" disabled={update.isPending} onClick={() => set(null)}>
              Remove reminder
            </button>
          )}
          <button type="button" className="zoiko-btn" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="zoiko-btn pri" disabled={!date || update.isPending} onClick={() => set(toIso(date, time))}>
            {update.isPending ? "Saving…" : "Set reminder"}
          </button>
        </>
      }
    >
      <p className="text-[13px] text-[var(--ink2)]">
        <b className="text-[var(--ink)]">{task.title}</b>
        <br />
        {task.reminderAt ? <>Currently reminding {dueLong(task.reminderAt)}{task.reminderSentAt ? " (sent)" : ""}</> : "No reminder set."}
        <br />
        {task.owner.displayName} gets a notification at the time you choose.
      </p>
      <div className="mt-4 grid grid-cols-2 gap-2">
        {options.map((option) => (
          <button
            key={option.label}
            type="button"
            disabled={update.isPending}
            onClick={() => set(option.date.toISOString())}
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
      <ErrorLine error={update.error} />
    </Modal>
  );
}
