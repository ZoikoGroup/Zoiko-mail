"use client";

import Link from "next/link";
import { createContext, useContext, useMemo, useState, type ReactNode } from "react";
import { ChevronDown, Flag, Network, Plus, Repeat, Target, type LucideIcon } from "lucide-react";
import { WebmailShell } from "@/components/mail/WebmailShell";
import { DropdownItem, DropdownMenu } from "@/components/ui/DropdownMenu";
import { useMyMailbox } from "@/lib/mail-hooks";
import { useCommitments, useDecisions, useDependencies } from "@/lib/workgraph-hooks";
import { CommitmentDialog, DecisionDialog, DependencyDialog, RelationshipDialog, StreamDialog } from "./dialogs";
import type { PickedSource } from "./SourcePicker";

export type WorkGraphPage = "overview" | "commitments" | "decisions" | "dependencies";

export const WORKGRAPH_PAGES: { key: WorkGraphPage; label: string; href: string; icon: LucideIcon }[] = [
  { key: "overview", label: "Overview", href: "/mail/work-graph", icon: Network },
  { key: "commitments", label: "Commitments", href: "/mail/work-graph/commitments", icon: Target },
  { key: "decisions", label: "Decisions", href: "/mail/work-graph/decisions", icon: Flag },
  { key: "dependencies", label: "Dependencies", href: "/mail/work-graph/dependencies", icon: Repeat },
];

interface Actions {
  newCommitment: (seed?: { title?: string; streamId?: string; sources?: PickedSource[] }) => void;
  recordDecision: (seed?: { title?: string; streamId?: string; sources?: PickedSource[] }) => void;
  newStream: () => void;
  addDependency: (seed?: { blockerType?: "DECISION" | "COMMITMENT"; blockerId?: string }) => void;
  addRelationship: (streamId?: string) => void;
}

const ActionsContext = createContext<Actions | null>(null);

/** The create dialogs, reachable from every Work Graph page (header buttons, sidebar, cards). */
export function useWorkGraphActions(): Actions {
  const actions = useContext(ActionsContext);
  if (!actions) throw new Error("useWorkGraphActions must be used inside WorkGraphWorkspace");
  return actions;
}

type Dialog =
  | { kind: "commitment"; seed?: Parameters<Actions["newCommitment"]>[0] }
  | { kind: "decision"; seed?: Parameters<Actions["recordDecision"]>[0] }
  | { kind: "stream" }
  | { kind: "dependency"; seed?: Parameters<Actions["addDependency"]>[0] }
  | { kind: "relationship"; streamId?: string }
  | null;

const rowClass = (active: boolean) =>
  `group relative flex w-full items-center gap-3 rounded-lg px-3 py-2 text-[13.5px] transition focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] ${
    active
      ? "bg-[var(--zm-selected)] font-semibold text-[var(--ink)] before:absolute before:inset-y-1.5 before:left-0 before:w-[3px] before:rounded-full before:bg-[var(--accent)]"
      : "text-[var(--ink2)] hover:bg-[var(--s2)] hover:text-[var(--ink)]"
  }`;

function gb(bytes: number): string {
  const value = bytes / 1024 ** 3;
  return value >= 10 ? value.toFixed(0) : value.toFixed(1);
}

function Badge({ value, hex, label }: { value: number; hex?: string; label: string }) {
  if (value <= 0) return null;
  return (
    <span
      className="ml-auto inline-flex min-w-[22px] items-center justify-center rounded-md px-1.5 py-0.5 text-[11px] font-semibold text-white"
      style={{ backgroundColor: hex ?? "var(--accent)" }}
      aria-label={label}
    >
      {value}
    </span>
  );
}

function Sidebar({ active, actions }: { active: WorkGraphPage; actions: Actions }) {
  const { data: mailbox, isLoading: mailboxLoading } = useMyMailbox();
  const commitments = useCommitments({});
  const decisions = useDecisions({});
  const open = useDependencies("open");
  const storageUsed = mailbox?.storageUsed ?? 0;
  const storageLimit = mailbox?.storageLimit ?? 0;
  const pct = storageLimit > 0 ? Math.min(100, (storageUsed / storageLimit) * 100) : 0;
  const badges: Partial<Record<WorkGraphPage, { value: number; hex: string; label: string }>> = {
    commitments: { value: commitments.data?.summary.pastDue ?? 0, hex: "#E0A33A", label: `${commitments.data?.summary.pastDue ?? 0} past due` },
    decisions: { value: decisions.data?.summary.awaiting ?? 0, hex: "#E0A33A", label: `${decisions.data?.summary.awaiting ?? 0} awaiting approval` },
    dependencies: { value: (open.data ?? []).filter((d) => d.state !== "UNBLOCKED").length, hex: "#E5484D", label: "blocked deliverables" },
  };

  return (
    <aside aria-label="Work Graph" className="flex h-full w-[240px] shrink-0 flex-col border-r border-[var(--border)] bg-[var(--surface)]">
      <div className="p-3 pb-1">
        <div className="flex h-11 w-full overflow-hidden rounded-xl bg-gradient-to-r from-[var(--zm-compose-from)] to-[var(--zm-compose-to)] text-[14px] font-semibold text-white shadow-[0_6px_18px_-6px_rgba(47,111,237,0.7)]">
          <button type="button" onClick={() => actions.newCommitment()} className="flex flex-1 items-center justify-center gap-2 transition hover:brightness-110 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-white">
            <Plus className="h-4 w-4" aria-hidden /> New commitment
          </button>
          <div className="flex w-10 items-center justify-center border-l border-white/25 text-white">
            <DropdownMenu align="left" trigger={<ChevronDown className="h-4 w-4" aria-label="More to create" />}>
              <DropdownItem onClick={() => actions.newCommitment()}>New commitment</DropdownItem>
              <DropdownItem onClick={() => actions.recordDecision()}>Record decision</DropdownItem>
              <DropdownItem onClick={() => actions.addDependency()}>Add dependency</DropdownItem>
              <DropdownItem onClick={() => actions.newStream()}>New workstream</DropdownItem>
            </DropdownMenu>
          </div>
        </div>
      </div>

      <nav className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
        <h2 className="px-3 pb-1.5 pt-4 text-[10.5px] font-semibold uppercase tracking-[0.14em] text-[var(--ink3)]">Work Graph</h2>
        <ul className="space-y-0.5">
          {WORKGRAPH_PAGES.map((page) => {
            const Icon = page.icon;
            const current = page.key === active;
            const badge = badges[page.key];
            return (
              <li key={page.key}>
                <Link href={page.href} className={rowClass(current)} aria-current={current ? "page" : undefined}>
                  <Icon className="h-4 w-4 shrink-0" aria-hidden />
                  <span className="truncate">{page.label}</span>
                  {badge && <Badge {...badge} />}
                </Link>
              </li>
            );
          })}
        </ul>
        <p className="mx-3 mt-5 text-[11.5px] leading-relaxed text-[var(--ink3)]">
          Every item here comes from evidence in your mail and calendar. What you share stays under your control, and Alet only suggests — you confirm.
        </p>
      </nav>

      <div className="m-3 rounded-xl border border-[var(--border)] bg-[var(--s2)] p-3">
        <div className="flex items-center justify-between text-[12px]">
          <span className="font-semibold text-[var(--ink)]">Mailbox storage</span>
          <span className="font-mono-num text-[var(--ink2)]">{mailboxLoading ? "…" : `${gb(storageUsed)} / ${gb(storageLimit)} GB`}</span>
        </div>
        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-[var(--s3,var(--border))]">
          <div className="h-full rounded-full bg-[var(--accent)]" style={{ width: `${pct}%` }} />
        </div>
      </div>
    </aside>
  );
}

/**
 * Every Work Graph page: the Member shell with the Work Graph sidebar beside
 * the page (and a strip of the same pages on a phone, where the sidebar is
 * hidden). The create dialogs live here so any page, card or sidebar button
 * can open them.
 */
export function WorkGraphWorkspace({ active, children }: { active: WorkGraphPage; children: ReactNode }) {
  const [dialog, setDialog] = useState<Dialog>(null);
  const actions = useMemo<Actions>(
    () => ({
      newCommitment: (seed) => setDialog({ kind: "commitment", seed }),
      recordDecision: (seed) => setDialog({ kind: "decision", seed }),
      newStream: () => setDialog({ kind: "stream" }),
      addDependency: (seed) => setDialog({ kind: "dependency", seed }),
      addRelationship: (streamId) => setDialog({ kind: "relationship", streamId }),
    }),
    []
  );
  const close = () => setDialog(null);

  return (
    <ActionsContext.Provider value={actions}>
      <WebmailShell section="work-graph">
        <div className="flex h-full min-h-0">
          <div className="hidden lg:block">
            <Sidebar active={active} actions={actions} />
          </div>
          <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto px-4 pb-4 pt-4 lg:px-6 lg:pt-5 [&>*]:shrink-0">
            <nav aria-label="Work Graph pages" className="-mx-1 mb-3 flex gap-1 overflow-x-auto pb-1 lg:hidden">
              {WORKGRAPH_PAGES.map((page) => (
                <Link
                  key={page.key}
                  href={page.href}
                  aria-current={page.key === active ? "page" : undefined}
                  className={`flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12.5px] ${page.key === active ? "bg-[var(--accent)] font-semibold text-white" : "border border-[var(--border)] text-[var(--ink2)]"}`}
                >
                  <page.icon className="h-3.5 w-3.5" aria-hidden /> {page.label}
                </Link>
              ))}
            </nav>
            {children}
          </div>
        </div>
      </WebmailShell>
      {dialog?.kind === "commitment" && <CommitmentDialog seed={dialog.seed} onClose={close} />}
      {dialog?.kind === "decision" && <DecisionDialog seed={dialog.seed} onClose={close} />}
      {dialog?.kind === "stream" && <StreamDialog onClose={close} />}
      {dialog?.kind === "dependency" && <DependencyDialog seed={dialog.seed} onClose={close} />}
      {dialog?.kind === "relationship" && <RelationshipDialog streamId={dialog.streamId} onClose={close} />}
    </ActionsContext.Provider>
  );
}

/** "ZOIKO MAIL / CONNECTED WORK", the icon tile, title, subtitle and the page's actions. */
export function WorkGraphHeader({ icon: Icon, title, subtitle, actions }: { icon: LucideIcon; title: string; subtitle: string; actions?: ReactNode }) {
  return (
    <header className="mb-4 flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--accent-ink)]">Zoiko Mail / Connected work</p>
        <div className="flex items-center gap-3">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-[var(--border)] bg-[var(--s2)] text-[var(--accent-ink)]">
            <Icon className="h-5 w-5" aria-hidden />
          </span>
          <h1 className="text-[22px] font-bold leading-tight tracking-tight text-[var(--ink)] sm:text-[26px]">{title}</h1>
        </div>
        <p className="mt-2 text-[13.5px] text-[var(--ink2)]">{subtitle}</p>
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}

/** Where the data comes from — shown where the designs say "Illustrative data": this is live. */
export function LivePill() {
  return (
    <span className="flex items-center gap-1.5 rounded-lg border border-[var(--border)] px-3 py-1.5 text-[11.5px] text-[var(--ink2)]">
      <span className="h-1.5 w-1.5 rounded-full bg-[#22B07D]" aria-hidden /> Live data · scoped to your access
    </span>
  );
}
