"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  AtSign,
  CalendarDays,
  CheckCheck,
  CheckSquare,
  Clock,
  Crosshair,
  Diamond,
  Download,
  Eye,
  Flag,
  Hourglass,
  Mail,
  Plus,
  Search,
  Users,
  type LucideIcon,
} from "lucide-react";
import { useMe } from "@/lib/auth-hooks";
import { useTaskSummary, useTaskTeams, useTasks } from "@/lib/tasks-hooks";
import { exportCompletedTasks, type ListTasksParams, type Task, type TaskSort, type TaskSummary, type TaskTeam } from "@/lib/tasks-api";
import { SummaryCards, TasksPageHeader, TasksWorkspace, type SummaryCard } from "./TasksWorkspace";
import type { TasksPageKey } from "./TasksSidebar";
import { CompletedTable, GroupedTaskList, OverdueTable, TeamTable } from "./TaskList";
import { TaskDetailPanel } from "./TaskDetailPanel";
import { ReopenDialog, TaskDialog } from "./TaskDialogs";
import { groupByDay, groupByState, nextDaysLabel, todayLong, zoneName, type TaskGroup } from "./format";

type Grouping = "state" | "day" | "flat";

interface TabDef {
  key: string;
  label: string;
  params: Omit<ListTasksParams, "q" | "sort">;
  /** Narrows the server's list further, for tabs that are a slice of a view. */
  filter?: (task: Task, meId: string | undefined) => boolean;
  count?: (summary: TaskSummary) => number;
  grouping: Grouping;
  /** In the design, arriving in a later phase. */
  soon?: boolean;
}

interface PageDef {
  icon: LucideIcon;
  tone?: "accent" | "crit" | "ok";
  title: string;
  subtitle: () => string;
  panelTitle: string;
  panelSubtitle: () => string;
  layout: "grouped" | "overdue" | "completed" | "team";
  tabs: TabDef[];
  sorts: { value: TaskSort; label: string }[];
  search?: boolean;
  focusView?: boolean;
  nextStep?: boolean;
  empty: string;
  cards: (summary: TaskSummary | undefined, base: Task[] | undefined, extra: Task[] | undefined) => SummaryCard[];
  /** A second list a card needs (e.g. "completed in 30 days"). */
  extra?: ListTasksParams;
}

const DUE_SORTS: PageDef["sorts"] = [
  { value: "due_asc", label: "Due date ↑" },
  { value: "due_desc", label: "Due date ↓" },
  { value: "priority", label: "Priority first" },
  { value: "created_desc", label: "Recently added" },
];

const count = (tasks: Task[] | undefined, test: (t: Task) => boolean) => (tasks ? tasks.filter(test).length : null);
const highPriority = (t: Task) => t.priority === "HIGH" || t.priority === "URGENT";

/** One team's page (screen 5): its open work, who has it, and when it is due. */
function teamPage(teamId: string, team: TaskTeam | undefined): PageDef {
  const name = team?.name ?? "Team";
  return {
    icon: Users,
    title: name,
    subtitle: () => `Coordinate ownership, priorities and deadlines across the team. ${team ? `${team.address} · ${team.memberCount} ${team.memberCount === 1 ? "member" : "members"}` : ""}`,
    panelTitle: "Team queue",
    panelSubtitle: () => `One accountable owner per task · Times in ${zoneName()}`,
    layout: "team",
    search: true,
    tabs: [
      { key: "all", label: "All team tasks", params: { view: "team", teamId }, grouping: "flat" },
      { key: "mine", label: "Assigned to me", params: { view: "team", teamId }, filter: (t, me) => t.owner.id === me, grouping: "flat" },
      { key: "blocked", label: "Blocked", params: { view: "team", teamId }, grouping: "flat", soon: true },
    ],
    sorts: [
      { value: "due_asc", label: "Due date (earliest)" },
      { value: "priority", label: "Priority first" },
      { value: "created_desc", label: "Recently added" },
    ],
    empty: `Nothing open for ${name}. Create a team task, or turn an email in ${team?.address ?? "the team's inbox"} into one.`,
    cards: () => [
      { icon: CheckSquare, tone: "accent", value: team?.counts.open ?? null, label: "Open team tasks", hint: "Across this team" },
      { icon: Clock, tone: "warn", value: team?.counts.dueNext3Days ?? null, label: "Due in the next 3 days", hint: "Review approaching commitments" },
      { icon: Flag, tone: "crit", value: null, label: "Blocked tasks", hint: "Waiting on a dependency", soon: true },
    ],
  };
}

const PAGES: Record<Exclude<TasksPageKey, "team">, PageDef> = {
  my: {
    icon: CheckSquare,
    title: "My Tasks",
    subtitle: () => "Stay on top of commitments, email follow-ups and the work assigned to you.",
    panelTitle: "My work queue",
    panelSubtitle: () => `Organised by due date · Times shown in ${zoneName()}`,
    layout: "grouped",
    focusView: true,
    tabs: [
      { key: "all", label: "All tasks", params: { view: "all" }, grouping: "state" },
      { key: "today", label: "Today", params: { view: "today" }, grouping: "state" },
      { key: "upcoming", label: "Upcoming", params: { view: "upcoming", days: 7 }, grouping: "day" },
      { key: "completed", label: "Completed", params: { view: "completed", days: 7 }, grouping: "flat" },
    ],
    sorts: DUE_SORTS,
    empty: "Nothing on your list. Create a task, or turn an email into one from the reading pane.",
    cards: (s) => [
      { icon: Clock, tone: "warn", value: s?.counts.dueToday ?? null, label: "Due today", hint: todayLong() },
      { icon: CalendarDays, tone: "accent", value: s?.counts.next7Days ?? null, label: "Upcoming", hint: "Next 7 days" },
      { icon: CheckCheck, tone: "ok", value: s?.counts.completedThisWeek ?? null, label: "Completed", hint: "This week" },
    ],
  },
  today: {
    icon: Clock,
    title: "Today",
    subtitle: () => `${todayLong(true)} · A clear plan for what needs your attention`,
    panelTitle: "Today's action queue",
    panelSubtitle: () => `Prioritised by deadline · Times in ${zoneName()}`,
    layout: "grouped",
    focusView: true,
    nextStep: true,
    tabs: [
      { key: "all", label: "All", params: { view: "today" }, grouping: "state", count: (s) => s.counts.overdue + s.counts.dueToday },
      { key: "overdue", label: "Overdue", params: { view: "overdue" }, grouping: "flat", count: (s) => s.counts.overdue },
      { key: "due", label: "Due today", params: { view: "today" }, filter: (t) => t.dueState === "today", grouping: "flat", count: (s) => s.counts.dueToday },
      { key: "waiting", label: "Waiting", params: { view: "today" }, grouping: "flat", soon: true },
    ],
    sorts: [
      { value: "due_asc", label: "Deadline first" },
      { value: "priority", label: "Priority first" },
    ],
    empty: "Nothing is due today and nothing is overdue. Enjoy the clear desk.",
    cards: (s) => [
      { icon: Flag, tone: "crit", value: s?.counts.overdue ?? null, label: "Overdue", hint: "Needs attention" },
      { icon: Clock, tone: "warn", value: s?.counts.dueToday ?? null, label: "Due today", hint: todayLong() },
      { icon: Mail, tone: "accent", value: null, label: "Waiting on reply", hint: "Follow-up tracking", soon: true },
    ],
  },
  upcoming: {
    icon: CalendarDays,
    title: "Upcoming Tasks",
    subtitle: () => `Plan what comes next · ${nextDaysLabel(7)} · ${zoneName()}`,
    panelTitle: "Future work queue",
    panelSubtitle: () => `Grouped by due date · Upcoming work only · All dates in ${zoneName()}`,
    layout: "grouped",
    focusView: true,
    search: true,
    tabs: [
      { key: "7", label: "Next 7 days", params: { view: "upcoming", days: 7 }, grouping: "day" },
      { key: "30", label: "Next 30 days", params: { view: "upcoming", days: 30 }, grouping: "day" },
      { key: "input", label: "Needs input", params: { view: "upcoming", days: 30 }, grouping: "day", soon: true },
    ],
    sorts: DUE_SORTS.slice(0, 3),
    empty: "Nothing is planned for this period.",
    cards: (s) => [
      { icon: CalendarDays, tone: "accent", value: s?.counts.upcoming ?? null, label: "Upcoming", hint: "Not yet due" },
      { icon: Clock, tone: "warn", value: s?.counts.next7Days ?? null, label: "Next 7 days", hint: nextDaysLabel(7).replace(/\s\d{4}$/, "") },
      { icon: Diamond, tone: "ai", value: null, label: "Need a dependency", hint: "Awaiting input or approval", soon: true },
    ],
  },
  overdue: {
    icon: Flag,
    tone: "crit",
    title: "Overdue Tasks",
    subtitle: () => `Review outstanding commitments and take the next appropriate action. ${todayLong(true)} · ${zoneName()}`,
    panelTitle: "Outstanding work",
    panelSubtitle: () => "Tasks shown by original due date; no automatic changes",
    layout: "overdue",
    search: true,
    tabs: [
      { key: "all", label: "All", params: { view: "overdue" }, grouping: "flat", count: (s) => s.counts.overdue },
      { key: "assigned", label: "Assigned to me", params: { view: "overdue" }, filter: (t) => t.isAssigned, grouping: "flat" },
      { key: "input", label: "Needs input", params: { view: "overdue" }, grouping: "flat", soon: true },
    ],
    sorts: [
      { value: "due_asc", label: "Most overdue first" },
      { value: "due_desc", label: "Least overdue first" },
      { value: "priority", label: "Priority first" },
    ],
    empty: "Nothing is overdue. Everything is on track.",
    cards: (s, base) => [
      { icon: Clock, tone: "crit", value: s?.counts.overdue ?? null, label: "Overdue tasks", hint: "Across your work" },
      { icon: Flag, tone: "warn", value: count(base, highPriority), label: "High priority", hint: "Require timely review" },
      { icon: Hourglass, tone: "accent", value: null, label: "Waiting on input", hint: "Dependency to unblock", soon: true },
    ],
  },
  completed: {
    icon: CheckCheck,
    tone: "ok",
    title: "Completed Tasks",
    subtitle: () => `Find finished work, review outcomes and retain a clear completion history. ${todayLong(true)} · ${zoneName()}`,
    panelTitle: "Completion history",
    panelSubtitle: () => "Read-only history · Select a task to inspect its outcome",
    layout: "completed",
    search: true,
    tabs: [
      { key: "all", label: "All completed", params: { view: "completed" }, grouping: "flat" },
      { key: "mine", label: "Completed by me", params: { view: "completed" }, filter: (t, me) => t.completedBy?.id === me, grouping: "flat" },
      { key: "team", label: "By my team", params: { view: "completed", scope: "team" }, grouping: "flat" },
    ],
    sorts: [{ value: "completed_desc", label: "Recently completed" }],
    empty: "Nothing completed in this period.",
    extra: { view: "completed", days: 30, limit: 200 },
    cards: (s, _base, extra) => [
      { icon: CheckCheck, tone: "ok", value: s?.counts.completedThisWeek ?? null, label: "Completed this week", hint: "Across tasks you can access" },
      { icon: CalendarDays, tone: "accent", value: extra?.length ?? null, label: "Completed in 30 days", hint: "Historical records available" },
      { icon: Users, tone: "ai", value: s?.counts.teamCompletionsThisWeek ?? null, label: "Team completions this week", hint: "Within your teams" },
    ],
  },
  "from-email": {
    icon: Mail,
    title: "From Emails",
    subtitle: () => "Tasks created from your mail, each linked to the message it came from.",
    panelTitle: "Email follow-ups",
    panelSubtitle: () => `Organised by due date · Times shown in ${zoneName()}`,
    layout: "grouped",
    search: true,
    tabs: [{ key: "all", label: "All from email", params: { view: "from_email" }, grouping: "state", count: (s) => s.counts.fromEmail }],
    sorts: DUE_SORTS,
    empty: "No tasks from email yet. Open a message and choose Create task.",
    cards: (s, base) => [
      { icon: Mail, tone: "accent", value: s?.counts.fromEmail ?? null, label: "Open from email", hint: "Linked to a message" },
      { icon: Clock, tone: "warn", value: count(base, (t) => t.dueState === "today"), label: "Due today", hint: todayLong() },
      { icon: Flag, tone: "crit", value: count(base, (t) => t.dueState === "overdue"), label: "Overdue", hint: "Needs attention" },
    ],
  },
  following: {
    icon: Eye,
    title: "Following",
    subtitle: () => "Work you keep an eye on without owning it. You hear when it is completed, handed over or reopened.",
    panelTitle: "Followed work",
    panelSubtitle: () => `Organised by due date · Times shown in ${zoneName()}`,
    layout: "grouped",
    search: true,
    tabs: [{ key: "all", label: "All followed", params: { view: "following" }, grouping: "state", count: (s) => s.counts.following }],
    sorts: DUE_SORTS,
    empty: "You are not following anything. Open a task and choose Follow to keep up with it.",
    cards: (s, base) => [
      { icon: Eye, tone: "accent", value: s?.counts.following ?? null, label: "Following", hint: "Open work you watch" },
      { icon: Clock, tone: "warn", value: count(base, (t) => t.dueState === "today"), label: "Due today", hint: todayLong() },
      { icon: Flag, tone: "crit", value: count(base, (t) => t.dueState === "overdue"), label: "Overdue", hint: "Needs attention" },
    ],
  },
  assigned: {
    icon: AtSign,
    title: "Assigned to Me",
    subtitle: () => "Work other people put on your list.",
    panelTitle: "Assigned work",
    panelSubtitle: () => `Organised by due date · Times shown in ${zoneName()}`,
    layout: "grouped",
    search: true,
    tabs: [{ key: "all", label: "All assigned", params: { view: "assigned" }, grouping: "state", count: (s) => s.counts.assigned }],
    sorts: DUE_SORTS,
    empty: "Nobody has assigned you anything right now.",
    cards: (s, base) => [
      { icon: AtSign, tone: "accent", value: s?.counts.assigned ?? null, label: "Assigned to me", hint: "Open work from others" },
      { icon: Clock, tone: "warn", value: count(base, (t) => t.dueState === "today"), label: "Due today", hint: todayLong() },
      { icon: Flag, tone: "crit", value: count(base, (t) => t.dueState === "overdue"), label: "Overdue", hint: "Needs attention" },
    ],
  },
};

const COMPLETED_RANGES = [
  { days: 7, label: "Last 7 days" },
  { days: 30, label: "Last 30 days" },
  { days: 90, label: "Last 90 days" },
  { days: 365, label: "Last 12 months" },
];

function SoonButton({ icon: Icon, label }: { icon: LucideIcon; label: string }) {
  return (
    <button type="button" aria-disabled="true" title={`${label} arrives in a later update`} onClick={(e) => e.preventDefault()} className="zoiko-btn cursor-not-allowed opacity-70">
      <Icon className="h-4 w-4" aria-hidden /> {label}
      <span className="rounded-full border border-[var(--border)] px-1.5 text-[9.5px] font-semibold uppercase tracking-wide text-[var(--ink3)]">Soon</span>
    </button>
  );
}

/** Wide enough to show the list and the details side by side. */
function useWide() {
  const [wide, setWide] = useState(true);
  useEffect(() => {
    const query = window.matchMedia("(min-width: 1024px)");
    const update = () => setWide(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  return wide;
}

/** Every Tasks view: header, figures, the queue and the selected task's details. */
export function TasksPage({ page, teamId }: { page: TasksPageKey; teamId?: string }) {
  const teams = useTaskTeams();
  const team = teamId ? teams.data?.find((t) => t.id === teamId) : undefined;
  const def = page === "team" ? teamPage(teamId!, team) : PAGES[page];
  const router = useRouter();
  const params = useSearchParams();
  const wide = useWide();
  const { data: me } = useMe();
  const meId = me?.id;

  const [tabKey, setTabKey] = useState(def.tabs[0]!.key);
  const tab = def.tabs.find((t) => t.key === tabKey) ?? def.tabs[0]!;
  const [sort, setSort] = useState<TaskSort>(def.sorts[0]!.value);
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  const [range, setRange] = useState(30);
  const [selectedId, setSelectedId] = useState<string | null>(() => params.get("task"));
  const [creating, setCreating] = useState(false);
  const [reopening, setReopening] = useState<Task | null>(null);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const exportHistory = () => {
    setExporting(true);
    setExportError(null);
    exportCompletedTasks(tab.params.scope ?? "mine", range)
      .catch((error: unknown) => setExportError(error instanceof Error ? error.message : "Could not export"))
      .finally(() => setExporting(false));
  };

  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(query.trim()), 250);
    return () => window.clearTimeout(timer);
  }, [query]);

  const summary = useTaskSummary();
  const listParams: ListTasksParams = {
    ...tab.params,
    ...(def.layout === "completed" ? { days: range } : {}),
    q: debounced || undefined,
    sort,
  };
  const list = useTasks(listParams, !tab.soon);
  const base = useTasks({ ...def.tabs[0]!.params, sort: def.sorts[0]!.value });
  const extra = useTasks(def.extra ?? { view: "completed" }, Boolean(def.extra));

  const tasks = useMemo(() => {
    if (tab.soon) return [];
    const items = list.data?.items ?? [];
    return tab.filter ? items.filter((t) => tab.filter!(t, meId)) : items;
  }, [list.data, tab, meId]);

  const groups: TaskGroup[] = useMemo(() => {
    if (tab.grouping === "state") return groupByState(tasks);
    if (tab.grouping === "day") return groupByDay(tasks);
    return tasks.length ? [{ key: "all", label: "", tasks }] : [];
  }, [tasks, tab.grouping]);

  // Keep a selection on wide screens: the one chosen or linked, else the first
  // task. A chosen task may not be in this view (a new one, still loading).
  const chosen = useRef<string | null>(params.get("task"));
  useEffect(() => {
    if (!list.data || !wide) return;
    if (selectedId && (selectedId === chosen.current || tasks.some((t) => t.id === selectedId))) return;
    setSelectedId(tasks[0]?.id ?? null);
  }, [list.data, tasks, selectedId, wide]);

  const select = (id: string | null) => {
    chosen.current = id;
    setSelectedId(id);
    const href = window.location.pathname + (id ? `?task=${id}` : "");
    router.replace(href, { scroll: false });
  };

  const totalHint = tab.count && summary.data ? tab.count(summary.data) : null;
  const zone = zoneName();

  return (
    <TasksWorkspace active={page} activeTeamId={teamId} onNewTask={() => setCreating(true)}>
      <TasksPageHeader
        icon={def.icon}
        tone={def.tone}
        title={def.title}
        subtitle={def.subtitle()}
        actions={
          <>
            {def.focusView && <SoonButton icon={Crosshair} label="Focus view" />}
            {page === "team" && <SoonButton icon={Users} label="Review workload" />}
            {page === "completed" ? (
              <button type="button" className="zoiko-btn" onClick={exportHistory} disabled={exporting || tasks.length === 0} title={`Download the ${tab.params.scope === "team" ? "team's" : "your"} completed tasks as CSV`}>
                <Download className="h-4 w-4" aria-hidden /> {exporting ? "Exporting…" : "Export history"}
              </button>
            ) : (
              <button type="button" className="zoiko-btn pri" onClick={() => setCreating(true)}>
                <Plus className="h-4 w-4" aria-hidden /> {page === "team" ? "New team task" : "New task"}
              </button>
            )}
          </>
        }
      />

      {exportError && (
        <p role="alert" className="mb-3 text-[12.5px] text-[var(--crit)]">
          Could not export the history. {exportError}
        </p>
      )}

      {page === "team" && teams.data && !team ? (
        <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-8 text-center text-[13px] text-[var(--ink2)]" role="alert">
          This team workspace is not available. You may have been removed from its shared mailbox.
        </div>
      ) : (
      <>
      <SummaryCards cards={def.cards(summary.data, base.data?.items, extra.data?.items)} />

      <div className="grid min-h-[560px] flex-1 gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(340px,420px)]">
        <section aria-label={def.panelTitle} className="flex min-h-0 flex-col overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--surface)]">
          <div className="border-b border-[var(--border)] px-5 pb-3 pt-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-[17px] font-semibold text-[var(--ink)]">{def.panelTitle}</h2>
                <p className="mt-0.5 text-[12px] text-[var(--ink3)]">{def.panelSubtitle()}</p>
              </div>
              {(def.layout === "overdue" || def.layout === "completed") && list.data && (
                <span
                  className={`shrink-0 rounded-lg px-2.5 py-1 text-[12px] font-semibold ${
                    def.layout === "overdue" ? "bg-[var(--crit-soft)] text-[var(--crit)]" : "bg-[var(--accent-soft)] text-[var(--accent-ink)]"
                  }`}
                >
                  {def.layout === "overdue" ? `${tasks.length} open` : `${tasks.length} in range`}
                </span>
              )}
            </div>

            <div className="mt-3 flex flex-wrap items-center gap-2">
              <div role="tablist" aria-label={def.panelTitle} className="flex flex-wrap gap-1">
                {def.tabs.map((t) => {
                  const current = t.key === tab.key;
                  const n = t.count && summary.data ? t.count(summary.data) : null;
                  return (
                    <button
                      key={t.key}
                      type="button"
                      role="tab"
                      aria-selected={current}
                      aria-disabled={t.soon || undefined}
                      title={t.soon ? `${t.label} arrives in a later update` : undefined}
                      onClick={() => {
                        if (t.soon) return;
                        setTabKey(t.key);
                        select(null);
                      }}
                      className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[13px] transition ${
                        current
                          ? "border border-[var(--accent)]/50 bg-[var(--accent-soft)] font-semibold text-[var(--accent-ink)]"
                          : t.soon
                            ? "cursor-not-allowed border border-transparent text-[var(--ink3)]"
                            : "border border-transparent font-medium text-[var(--ink2)] hover:bg-[var(--s2)] hover:text-[var(--ink)]"
                      }`}
                    >
                      {t.label}
                      {n !== null && <span className="font-mono-num text-[11.5px] opacity-80">({n})</span>}
                      {t.soon && <span className="rounded-full border border-[var(--border)] px-1.5 text-[9px] font-semibold uppercase tracking-wide">Soon</span>}
                    </button>
                  );
                })}
              </div>
              <div className="ml-auto flex flex-wrap items-center gap-2">
                {def.search && (
                  <label className="relative">
                    <span className="sr-only">Find tasks</span>
                    <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--ink3)]" aria-hidden />
                    <input
                      className="zoiko-input !w-[170px]"
                      style={{ paddingLeft: 30 }}
                      placeholder="Find tasks"
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                    />
                  </label>
                )}
                {def.layout === "completed" ? (
                  <select className="zoiko-input !w-auto" aria-label="Completed within" value={range} onChange={(e) => setRange(Number(e.target.value))}>
                    {COMPLETED_RANGES.map((r) => (
                      <option key={r.days} value={r.days}>
                        {r.label}
                      </option>
                    ))}
                  </select>
                ) : (
                  def.sorts.length > 1 && (
                    <select className="zoiko-input !w-auto" aria-label="Sort tasks" value={sort} onChange={(e) => setSort(e.target.value as TaskSort)}>
                      {def.sorts.map((s) => (
                        <option key={s.value} value={s.value}>
                          {s.label}
                        </option>
                      ))}
                    </select>
                  )
                )}
              </div>
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto pb-3">
            {list.isError ? (
              <p role="alert" className="p-5 text-[13px] text-[var(--crit)]">
                Could not load tasks. {(list.error as Error).message}
              </p>
            ) : list.isLoading && !tab.soon ? (
              <p className="p-5 text-[13px] text-[var(--ink3)]">Loading…</p>
            ) : tasks.length === 0 ? (
              <div className="flex flex-col items-center px-6 py-14 text-center">
                <CheckSquare className="h-10 w-10 text-[var(--ink3)]" aria-hidden />
                <p className="mt-3 max-w-sm text-[13px] text-[var(--ink2)]">{debounced ? `No tasks match “${debounced}”.` : def.empty}</p>
              </div>
            ) : def.layout === "overdue" ? (
              <OverdueTable tasks={tasks} selectedId={selectedId} onSelect={select} />
            ) : def.layout === "completed" ? (
              <CompletedTable tasks={tasks} selectedId={selectedId} onSelect={select} />
            ) : def.layout === "team" ? (
              <TeamTable tasks={tasks} selectedId={selectedId} onSelect={select} />
            ) : (
              <GroupedTaskList groups={groups} selectedId={selectedId} onSelect={select} onReopen={setReopening} showHeaders={tab.grouping !== "flat"} />
            )}
          </div>

          <div className="flex flex-wrap justify-between gap-2 border-t border-[var(--border)] px-5 py-2.5 text-[11.5px] text-[var(--ink3)]">
            <span>
              Showing {tasks.length}
              {totalHint !== null && totalHint > tasks.length ? ` of ${totalHint}` : ""} {tasks.length === 1 ? "task" : "tasks"}
              {list.data?.nextCursor ? " · narrow the search to see more" : ""}
            </span>
            <span>{page === "completed" ? "Read-only history" : `Times in ${zone}`}</span>
          </div>
        </section>

        {selectedId ? (
          <div className={wide ? "min-h-0" : "fixed inset-0 z-40 flex flex-col bg-[var(--ground)] p-3 pb-20"}>
            <TaskDetailPanel key={selectedId} taskId={selectedId} meId={meId} showNextStep={def.nextStep} onClose={() => select(null)} />
          </div>
        ) : (
          <div className="hidden items-center justify-center rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-8 text-center text-[13px] text-[var(--ink3)] lg:flex">
            {list.isLoading ? "Loading…" : "Select a task to see its details."}
          </div>
        )}
      </div>
      </>
      )}

      {creating && <TaskDialog mode={{ kind: "create", teamId }} onClose={() => setCreating(false)} onSaved={(task) => select(task.id)} />}
      {reopening && <ReopenDialog task={reopening} onClose={() => setReopening(null)} />}
    </TasksWorkspace>
  );
}
