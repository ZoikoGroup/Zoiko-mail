import type { Task, TaskPriority, TaskStatus } from "@/lib/tasks-api";

/**
 * How tasks read on screen: due labels, priority and status wording, and the
 * groups the queues are split into. Times are the device's, which is also the
 * zone the server cut the lists by (taskZone()).
 */

const time = new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit", hour12: false });
const dayMonth = new Intl.DateTimeFormat(undefined, { weekday: "short", day: "numeric", month: "short" });
const longDay = new Intl.DateTimeFormat(undefined, { weekday: "long", day: "numeric", month: "long" });
const longDayYear = new Intl.DateTimeFormat(undefined, { weekday: "long", day: "numeric", month: "long", year: "numeric" });
const fullStamp = new Intl.DateTimeFormat(undefined, { weekday: "short", day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false });
const groupDay = new Intl.DateTimeFormat(undefined, { weekday: "long", day: "numeric", month: "short" });

export function startOfLocalDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function daysFromToday(date: Date): number {
  return Math.round((startOfLocalDay(date).getTime() - startOfLocalDay(new Date()).getTime()) / 86_400_000);
}

/** A time of exactly midnight is treated as "no time given". */
function hasTime(date: Date): boolean {
  return date.getHours() !== 0 || date.getMinutes() !== 0;
}

/** "Today · 16:00", "Tomorrow", "Thu 22 Oct · 17:00". */
export function dueLabel(iso: string | null): string {
  if (!iso) return "No due date";
  const date = new Date(iso);
  const offset = daysFromToday(date);
  const day = offset === 0 ? "Today" : offset === 1 ? "Tomorrow" : offset === -1 ? "Yesterday" : dayMonth.format(date);
  return hasTime(date) ? `${day} · ${time.format(date)}` : day;
}

/** "Fri, 23 Oct · 16:00 BST" for the details panel. */
export function dueLong(iso: string | null): string {
  if (!iso) return "No due date";
  const date = new Date(iso);
  const zone = new Intl.DateTimeFormat("en-GB", { timeZoneName: "short" }).formatToParts(date).find((p) => p.type === "timeZoneName")?.value ?? "";
  return hasTime(date) ? `${dayMonth.format(date)} · ${time.format(date)} ${zone}`.trim() : dayMonth.format(date);
}

export function stamp(iso: string): string {
  return fullStamp.format(new Date(iso));
}

export function shortDay(iso: string): string {
  return dayMonth.format(new Date(iso));
}

export function clock(iso: string): string {
  return time.format(new Date(iso));
}

export function todayLong(withYear = false): string {
  return (withYear ? longDayYear : longDay).format(new Date());
}

/** "Saturday 24–Friday 30 October 2026". */
export function nextDaysLabel(days: number): string {
  const from = new Date();
  from.setDate(from.getDate() + 1);
  const to = new Date();
  to.setDate(to.getDate() + days);
  const f = new Intl.DateTimeFormat(undefined, { weekday: "long", day: "numeric" });
  const t = new Intl.DateTimeFormat(undefined, { weekday: "long", day: "numeric", month: "long", year: "numeric" });
  return `${f.format(from)}–${t.format(to)}`;
}

/** "Europe/London" → shown as the zone the person reads times in. */
export function zoneName(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
}

/** The short zone name in force on a date: "BST", "GMT", "GMT+5:30". */
export function zoneAbbrev(date: Date): string {
  return new Intl.DateTimeFormat("en-GB", { timeZoneName: "short" }).formatToParts(date).find((p) => p.type === "timeZoneName")?.value ?? "";
}

export const PRIORITY_LABEL: Record<TaskPriority, string> = {
  LOW: "Low",
  MEDIUM: "Normal",
  HIGH: "High priority",
  URGENT: "Urgent",
};

export const PRIORITY_SHORT: Record<TaskPriority, string> = { LOW: "Low", MEDIUM: "Medium", HIGH: "High", URGENT: "Urgent" };

/** Text colour for a priority: only the ones that need attention stand out. */
export const PRIORITY_CLASS: Record<TaskPriority, string> = {
  LOW: "text-[var(--ink3)]",
  MEDIUM: "text-[var(--ink2)]",
  HIGH: "text-[var(--warn)]",
  URGENT: "text-[var(--crit)]",
};

export const STATUS_LABEL: Record<TaskStatus, string> = {
  OPEN: "Open",
  PLANNED: "Planned",
  IN_PROGRESS: "In progress",
  SNOOZED: "Snoozed",
  COMPLETED: "Completed",
  DISMISSED: "Deleted",
};

export const STATUS_DOT: Record<TaskStatus, string> = {
  OPEN: "bg-[var(--accent)]",
  PLANNED: "bg-[var(--ink3)]",
  IN_PROGRESS: "bg-[var(--accent)]",
  SNOOZED: "bg-[var(--ink3)]",
  COMPLETED: "bg-[var(--ok)]",
  DISMISSED: "bg-[var(--ink3)]",
};

export function dueClass(task: Pick<Task, "dueState">): string {
  if (task.dueState === "overdue") return "text-[var(--crit)] font-semibold";
  if (task.dueState === "today") return "text-[var(--warn)] font-semibold";
  return "text-[var(--ink2)]";
}

export function initials(name: string): string {
  const parts = name.trim().split(/[\s@._-]+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "") + (parts.length > 1 ? parts[parts.length - 1]![0] : "")).toUpperCase() || "?";
}

export interface TaskGroup {
  key: string;
  label: string;
  note?: string;
  tone?: "crit" | "warn";
  tasks: Task[];
}

/** Overdue, due today, then what is coming, then undated — the order work is done in. */
export function groupByState(tasks: Task[]): TaskGroup[] {
  const groups: TaskGroup[] = [
    { key: "overdue", label: "Overdue", tone: "crit", tasks: [] },
    { key: "today", label: "Due today", note: todayLong(), tone: "warn", tasks: [] },
    { key: "upcoming", label: "Upcoming", tasks: [] },
    { key: "none", label: "No due date", tasks: [] },
  ];
  for (const task of tasks) groups.find((g) => g.key === task.dueState)!.tasks.push(task);
  for (const g of groups) {
    if (g.key === "overdue") g.note = `${g.tasks.length} ${g.tasks.length === 1 ? "item" : "items"} to resolve`;
    if (g.key === "upcoming" && g.tasks.length) g.note = `Next ${g.tasks.length === 1 ? "task" : `${g.tasks.length} tasks`}`;
  }
  return groups.filter((g) => g.tasks.length > 0);
}

/**
 * One group per calendar day. A day whose zone abbreviation differs from
 * today's says so — after the clocks change, "09:30" is a different instant.
 */
export function groupByDay(tasks: Task[]): TaskGroup[] {
  const todayZone = zoneAbbrev(new Date());
  const groups = new Map<string, TaskGroup>();
  for (const task of tasks) {
    if (!task.dueAt) continue;
    const date = new Date(task.dueAt);
    const key = startOfLocalDay(date).toISOString();
    let group = groups.get(key);
    if (!group) {
      const abbrev = zoneAbbrev(date);
      group = { key, label: groupDay.format(date), note: abbrev && abbrev !== todayZone ? `After the clock change · ${abbrev}` : undefined, tasks: [] };
      groups.set(key, group);
    }
    group.tasks.push(task);
  }
  const result = Array.from(groups.values());
  for (const group of result) {
    if (!group.note) group.note = `${group.tasks.length} ${group.tasks.length === 1 ? "task" : "tasks"}`;
  }
  return result;
}
