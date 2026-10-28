"use client";

import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import Image from "next/image";
import {
  Search, X, Settings, LogOut, ChevronDown, Bell, Sparkles, UserRound, Building2, MonitorSmartphone,
} from "lucide-react";
import { ThemeToggle } from "@/components/theme/ThemeToggle";
import { LayoutMenu } from "@/components/mail/LayoutMenu";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { initials } from "@/lib/useMemberShell";
import { useLogoutAll, useMe } from "@/lib/auth-hooks";
import { useMarkAllNotificationsRead, useMarkNotificationRead, useNotifications } from "@/lib/admin-hooks";
import { useTaskSearch } from "@/lib/tasks-hooks";
import type { Task } from "@/lib/tasks-api";

/** Where a found task opens: its team's page, the Completed history, or My Tasks. */
function taskHref(task: Task): string {
  if (task.status === "COMPLETED") return `/mail/tasks/completed?task=${task.id}`;
  if (task.team) return `/mail/tasks/team/${task.team.id}?task=${task.id}`;
  return `/mail/tasks?task=${task.id}`;
}

/** Closes a popover on an outside click or Escape. */
function useDismiss(open: boolean, close: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, close]);
  return ref;
}

/**
 * The webmail top bar: brand, the workspace this session is in, search
 * (Ctrl/⌘+K focuses it), Alet, notifications, settings and the account menu.
 *
 * Search text is lifted to the page, which hands it to MailClient's operator
 * parser — "from:hr has:attachment" works here as it always has. Outside Mail
 * there is no page to lift it to, so the bar keeps its own text. Either way,
 * matching tasks are offered beneath it: arrow down to one and press Enter,
 * or click it.
 */
export function TopBar({
  query: liftedQuery,
  onQueryChange: liftedChange,
  placeholder = "Search mail — try from:hr has:attachment",
  accountEmail,
  displayName,
  workspaceName,
  onSignOut,
  signingOut = false,
}: {
  query: string;
  /** Absent outside Mail: the bar then keeps its own text. */
  onQueryChange?: (value: string) => void;
  placeholder?: string;
  accountEmail?: string;
  displayName?: string;
  workspaceName?: string;
  onSignOut: () => void;
  signingOut?: boolean;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [bellOpen, setBellOpen] = useState(false);
  const menuRef = useDismiss(menuOpen, () => setMenuOpen(false));
  const bellRef = useDismiss(bellOpen, () => setBellOpen(false));
  const searchRef = useRef<HTMLInputElement>(null);
  const router = useRouter();
  const [ownQuery, setOwnQuery] = useState("");
  const query = liftedChange ? liftedQuery : ownQuery;
  const onQueryChange = liftedChange ?? setOwnQuery;

  // Tasks matching the words typed, without mail operators like from:hr.
  const taskTerm = query.replace(/\b\w+:\S*/g, "").trim();
  const [searchFocused, setSearchFocused] = useState(false);
  const [activeTask, setActiveTask] = useState(-1);
  const taskResults = useTaskSearch(searchFocused ? taskTerm : "");
  const tasksFound = taskTerm.length >= 2 ? taskResults.data ?? [] : [];
  const showTasks = searchFocused && taskTerm.length >= 2 && (tasksFound.length > 0 || !taskResults.isFetching);
  useEffect(() => setActiveTask(-1), [taskTerm]);
  const openTask = (task: Task) => {
    setSearchFocused(false);
    searchRef.current?.blur();
    router.push(taskHref(task));
  };
  const onSearchKey = (e: ReactKeyboardEvent<HTMLInputElement>) => {
    if (!showTasks) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveTask((i) => Math.min(i + 1, tasksFound.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveTask((i) => Math.max(i - 1, -1));
    } else if (e.key === "Enter" && (activeTask >= 0 || !liftedChange) && tasksFound.length > 0) {
      // In Mail, Enter keeps searching mail unless a task was chosen.
      e.preventDefault();
      openTask(tasksFound[Math.max(activeTask, 0)]!);
    } else if (e.key === "Escape") {
      setSearchFocused(false);
    }
  };

  const { data: me } = useMe();
  const logoutAll = useLogoutAll();
  const [confirmingEverywhere, setConfirmingEverywhere] = useState(false);
  // Switching is offered only when there is another workspace to switch to.
  const canSwitch = (me?.workspaceCount ?? 1) > 1;

  const { data: notifications } = useNotifications();
  const markRead = useMarkNotificationRead();
  const markAll = useMarkAllNotificationsRead();
  const unread = (notifications ?? []).filter((n) => !n.readAt);

  // Ctrl+K / ⌘+K focuses search, as the hint in the box says.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        searchRef.current?.focus();
        searchRef.current?.select();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  const iconButton =
    "relative inline-flex h-9 w-9 items-center justify-center rounded-lg text-[var(--ink2)] transition hover:bg-[var(--s2)] hover:text-[var(--ink)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]";

  return (
    <header className="flex h-[68px] items-center gap-4 border-b border-[var(--border)] bg-[var(--surface)] px-5">
      <Link
        href="/mail"
        aria-label="Zoiko Mail — Inbox"
        className="flex h-11 shrink-0 items-center rounded-xl bg-white px-4 shadow-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
      >
        <Image src="/zoiko-wordmark.png" width={2111} height={274} className="h-5 w-auto" alt="Zoiko Mail" priority />
      </Link>

      {workspaceName && (
        <WorkspaceCard name={workspaceName} canSwitch={canSwitch} />
      )}

      <div className="relative mx-auto w-full max-w-xl flex-1">
        <label htmlFor="mail-search" className="sr-only">
          {liftedChange ? "Search mail and tasks" : "Search tasks"}
        </label>
        <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--ink3)]" aria-hidden />
        <input
          id="mail-search"
          ref={searchRef}
          type="search"
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          onFocus={() => setSearchFocused(true)}
          onBlur={() => setSearchFocused(false)}
          onKeyDown={onSearchKey}
          role="combobox"
          aria-expanded={showTasks}
          aria-controls="task-search-results"
          aria-activedescendant={activeTask >= 0 ? `task-result-${activeTask}` : undefined}
          placeholder={placeholder}
          className="h-11 w-full rounded-xl border border-[var(--border)] bg-[var(--ground)] pl-10 pr-20 text-sm [&::-webkit-search-cancel-button]:appearance-none text-[var(--ink)] outline-none placeholder:text-[var(--ink3)] focus:border-[var(--accent)] focus:ring-1 focus:ring-[var(--accent)]"
        />
        {query ? (
          <button
            onClick={() => onQueryChange("")}
            className="absolute right-3 top-1/2 -translate-y-1/2 rounded p-1 text-[var(--ink3)] hover:text-[var(--ink)]"
            aria-label="Clear search"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        ) : (
          <kbd className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 rounded-md border border-[var(--border)] px-1.5 py-0.5 font-sans text-[11px] text-[var(--ink3)]">
            Ctrl K
          </kbd>
        )}
        {showTasks && (
          <div
            id="task-search-results"
            role="listbox"
            aria-label="Tasks"
            className="absolute left-0 right-0 top-[calc(100%+6px)] z-40 overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--surface)] shadow-[var(--sh3)]"
            // Keep focus in the box while choosing, so the click lands.
            onMouseDown={(e) => e.preventDefault()}
          >
            <div className="flex items-center justify-between px-3.5 pb-1 pt-2.5 text-[10.5px] font-semibold uppercase tracking-[0.12em] text-[var(--ink3)]">
              <span>Tasks</span>
              <span className="normal-case tracking-normal">↑↓ to choose · Enter to open</span>
            </div>
            {tasksFound.length === 0 ? (
              <p className="px-3.5 pb-3 pt-1 text-[12.5px] text-[var(--ink3)]">No tasks match “{taskTerm}”.</p>
            ) : (
              <ul className="pb-1.5">
                {tasksFound.map((task, i) => (
                  <li key={task.id} id={`task-result-${i}`} role="option" aria-selected={i === activeTask}>
                    <button
                      type="button"
                      tabIndex={-1}
                      onClick={() => openTask(task)}
                      onMouseEnter={() => setActiveTask(i)}
                      className={`flex w-full items-center gap-3 px-3.5 py-2 text-left ${i === activeTask ? "bg-[var(--s2)]" : ""}`}
                    >
                      <span
                        className={`h-2 w-2 shrink-0 rounded-full ${
                          task.status === "COMPLETED" ? "bg-[var(--ok)]" : task.dueState === "overdue" ? "bg-[var(--crit)]" : "bg-[var(--accent)]"
                        }`}
                        aria-hidden
                      />
                      <span className="min-w-0 flex-1">
                        <span
                          className={`block truncate text-[13px] font-medium ${
                            task.status === "COMPLETED" ? "text-[var(--ink3)] line-through" : "text-[var(--ink)]"
                          }`}
                        >
                          {task.title}
                        </span>
                        <span className="block truncate text-[11.5px] text-[var(--ink3)]">
                          {[
                            task.status === "COMPLETED" ? "Completed" : task.dueState === "overdue" ? "Overdue" : null,
                            task.team?.name ?? "Personal",
                            task.owner.displayName,
                          ]
                            .filter(Boolean)
                            .join(" · ")}
                        </span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>

      <div className="flex shrink-0 items-center gap-1.5">
        <Link
          href="/mail/alet"
          className="hidden h-10 items-center gap-2 rounded-xl border border-[var(--accent)]/50 bg-[var(--accent-soft)] px-3.5 text-[13px] font-semibold text-[var(--accent-ink)] transition hover:border-[var(--accent)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] xl:inline-flex"
        >
          <Sparkles className="h-4 w-4" aria-hidden /> Alet AI
        </Link>

        <LayoutMenu />
        <ThemeToggle />

        <div className="relative" ref={bellRef}>
          <button
            type="button"
            onClick={() => setBellOpen((v) => !v)}
            className={iconButton}
            aria-label={unread.length > 0 ? `Notifications, ${unread.length} unread` : "Notifications"}
            aria-expanded={bellOpen}
            aria-haspopup="dialog"
          >
            <Bell className="h-[18px] w-[18px]" aria-hidden />
            {unread.length > 0 && (
              <span
                className="absolute right-1 top-1 inline-flex min-w-[16px] items-center justify-center rounded-full bg-[var(--crit)] px-1 text-[10px] font-bold leading-4 text-white"
                data-testid="notification-count"
              >
                {unread.length > 9 ? "9+" : unread.length}
              </span>
            )}
          </button>
          {bellOpen && (
            <div
              role="dialog"
              aria-label="Notifications"
              className="absolute right-0 top-full z-30 mt-2 w-80 overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--surface)] shadow-[var(--sh3)]"
            >
              <div className="flex items-center justify-between border-b border-[var(--border)] px-4 py-2.5">
                <span className="text-sm font-semibold text-[var(--ink)]">Notifications</span>
                {unread.length > 0 && (
                  <button
                    type="button"
                    onClick={() => markAll.mutate(unread.map((n) => n.id))}
                    disabled={markAll.isPending}
                    className="text-xs font-medium text-[var(--accent)] hover:underline disabled:opacity-60"
                  >
                    Mark all read
                  </button>
                )}
              </div>
              <ul className="max-h-80 overflow-y-auto">
                {(notifications ?? []).length === 0 ? (
                  <li className="px-4 py-6 text-center text-sm text-[var(--ink3)]">You&rsquo;re all caught up.</li>
                ) : (
                  (notifications ?? []).slice(0, 20).map((n) => (
                    <li key={n.id} className="border-b border-[var(--border)] last:border-0">
                      <button
                        type="button"
                        onClick={() => {
                          if (!n.readAt) markRead.mutate(n.id);
                          if (n.linkPath) {
                            setBellOpen(false);
                            router.push(n.linkPath);
                          }
                        }}
                        className="flex w-full gap-2.5 px-4 py-3 text-left transition hover:bg-[var(--s2)]"
                      >
                        <span
                          className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${n.readAt ? "bg-transparent" : "bg-[var(--accent)]"}`}
                          aria-hidden
                        />
                        <span className="min-w-0 flex-1">
                          <span className={`block text-[13px] ${n.readAt ? "text-[var(--ink2)]" : "font-semibold text-[var(--ink)]"}`}>
                            {n.title}
                          </span>
                          {n.body && <span className="mt-0.5 block line-clamp-2 text-xs text-[var(--ink3)]">{n.body}</span>}
                          <span className="mt-1 block text-[11px] text-[var(--ink3)]">{n.ago}</span>
                        </span>
                      </button>
                    </li>
                  ))
                )}
              </ul>
            </div>
          )}
        </div>

        <Link href="/mail/settings" className={iconButton} aria-label="Settings" title="Settings">
          <Settings className="h-[18px] w-[18px]" aria-hidden />
        </Link>

        <div className="relative" ref={menuRef}>
          <button
            onClick={() => setMenuOpen((v) => !v)}
            className="flex items-center gap-1 rounded-xl px-1 py-1 transition hover:bg-[var(--s2)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
            aria-label="Account menu"
            aria-expanded={menuOpen}
            aria-haspopup="menu"
          >
            <span className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-[var(--accent)] text-xs font-semibold text-white">
              {initials(displayName, accountEmail)}
            </span>
            <ChevronDown className="h-3.5 w-3.5 text-[var(--ink3)]" aria-hidden />
          </button>

          {menuOpen && (
            <div
              role="menu"
              className="absolute right-0 top-full z-30 mt-2 w-64 overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--surface)] shadow-[var(--sh3)]"
            >
              <div className="flex items-start gap-3 border-b border-[var(--border)] px-4 py-3">
                <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[var(--accent)] text-[13px] font-semibold text-white">
                  {initials(displayName, accountEmail)}
                </span>
                <div className="min-w-0 flex-1">
                  {displayName && <div className="truncate text-sm font-semibold text-[var(--ink)]">{displayName}</div>}
                  <div className="truncate text-xs text-[var(--ink3)]">{accountEmail ?? "…"}</div>
                  {/* A session is bound to one workspace, so which one is worth saying. */}
                  {me && (
                    <span className="mt-1.5 inline-flex max-w-full items-center gap-1 rounded-full bg-[var(--accent-soft)] px-2 py-0.5 text-[11px] font-medium text-[var(--accent-ink)]">
                      <Building2 className="h-3 w-3 shrink-0" aria-hidden />
                      <span className="truncate">
                        {me.membership.role.charAt(0) + me.membership.role.slice(1).toLowerCase()} · {me.tenant.name}
                      </span>
                    </span>
                  )}
                </div>
              </div>
              <div className="border-b border-[var(--border)] py-1">
                <MenuLink href="/mail/settings/profile" icon={UserRound} onClick={() => setMenuOpen(false)}>
                  Profile
                </MenuLink>
                <MenuLink href="/mail/settings" icon={Settings} onClick={() => setMenuOpen(false)}>
                  Settings
                </MenuLink>
                {canSwitch && (
                  <MenuLink href="/select-workspace" icon={Building2} onClick={() => setMenuOpen(false)}>
                    Switch workspace
                  </MenuLink>
                )}
              </div>
              <div className="py-1">
                <button
                  role="menuitem"
                  onClick={onSignOut}
                  disabled={signingOut}
                  className="flex w-full items-center gap-2 px-4 py-2 text-left text-sm text-[var(--ink2)] hover:bg-[var(--s2)] disabled:opacity-60"
                >
                  <LogOut className="h-3.5 w-3.5" aria-hidden />
                  {signingOut ? "Signing out…" : "Sign out"}
                </button>
                {/* Ends this session too, so it is confirmed first. */}
                <button
                  role="menuitem"
                  onClick={() => {
                    setMenuOpen(false);
                    setConfirmingEverywhere(true);
                  }}
                  disabled={logoutAll.isPending}
                  className="flex w-full items-center gap-2 px-4 py-2 text-left text-sm text-[var(--ink2)] hover:bg-[var(--s2)] disabled:opacity-60"
                >
                  <MonitorSmartphone className="h-3.5 w-3.5" aria-hidden />
                  {logoutAll.isPending ? "Signing out…" : "Sign out everywhere"}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      <ConfirmDialog
        open={confirmingEverywhere}
        onClose={() => setConfirmingEverywhere(false)}
        onConfirm={() => {
          setConfirmingEverywhere(false);
          logoutAll.mutate();
        }}
        title="Sign out on every device?"
        message="Every session for this account ends, on every browser and device — including this one. Anyone signed in elsewhere will have to sign in again."
        confirmLabel="Sign out everywhere"
        loading={logoutAll.isPending}
      />
    </header>
  );
}

function MenuLink({
  href,
  icon: Icon,
  onClick,
  children,
}: {
  href: string;
  icon: typeof Settings;
  onClick: () => void;
  children: string;
}) {
  return (
    <Link
      role="menuitem"
      href={href}
      className="flex items-center gap-2 px-4 py-2 text-sm text-[var(--ink2)] hover:bg-[var(--s2)]"
      onClick={onClick}
    >
      <Icon className="h-3.5 w-3.5" aria-hidden /> {children}
    </Link>
  );
}

/**
 * The workspace this session is in. With another workspace to go to it opens
 * the workspace picker; otherwise it is a label, not a button that leads nowhere.
 */
function WorkspaceCard({ name, canSwitch }: { name: string; canSwitch: boolean }) {
  const body = (
    <>
      <span className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-[var(--accent)] text-sm font-bold text-white">
        {name.trim().charAt(0).toUpperCase()}
      </span>
      <span className="min-w-0 flex-1 leading-tight">
        <span className="block truncate text-[13px] font-semibold text-[var(--ink)]">{name}</span>
        <span className="block text-[11px] text-[var(--ink3)]">Business mail</span>
      </span>
      {canSwitch && <ChevronDown className="h-4 w-4 shrink-0 text-[var(--ink3)]" aria-hidden />}
    </>
  );
  const box =
    "hidden h-11 min-w-0 max-w-[230px] shrink-0 items-center gap-2.5 rounded-xl border border-[var(--border)] bg-[var(--s2)] px-3 xl:flex";
  return canSwitch ? (
    <Link
      href="/select-workspace"
      className={`${box} transition hover:border-[var(--accent)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]`}
      title={`Workspace: ${name} — switch workspace`}
      aria-label={`Workspace: ${name}. Switch workspace`}
    >
      {body}
    </Link>
  ) : (
    <div className={box} title={`Workspace: ${name}`}>
      {body}
    </div>
  );
}
