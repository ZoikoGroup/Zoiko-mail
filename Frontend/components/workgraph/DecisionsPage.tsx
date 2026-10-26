"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowDownUp, Check, ChevronRight, Clock, Filter, Flag, Plus, Repeat, ShieldCheck, Sparkles, Trash2, UserCheck, type LucideIcon } from "lucide-react";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import type { Decision, Dependency } from "@/lib/workgraph-api";
import {
  useDecisions,
  useDeleteDecision,
  useDeleteDependency,
  useDependencies,
  useRemoveEvidence,
  useSuggestions,
  useUpdateDependency,
  useAddEvidence,
} from "@/lib/workgraph-hooks";
import { formatLong } from "@/lib/workgraph-dates";
import { DecideDialog, DecisionDialog } from "./dialogs";
import { SuggestionList } from "./CommitmentsPage";
import { SourcePicker } from "./SourcePicker";
import { COLORS, DECISION_PILL, DEPENDENCY_PILL, DueCell, EvidenceList, OwnerLine, Pill, Stat, evidenceSummary, label } from "./shared";
import { LivePill, WorkGraphHeader, WorkGraphWorkspace, useWorkGraphActions } from "./WorkGraphWorkspace";

type Tab = "all" | "awaiting" | "approved" | "dependencies" | "suggested";
const TABS: Tab[] = ["all", "awaiting", "approved", "dependencies", "suggested"];
const WINDOWS: Array<[number, string]> = [
  [7, "Last 7 days"],
  [30, "Last 30 days"],
  [90, "Last 90 days"],
  [365, "Last 12 months"],
  [0, "All time"],
];
const ROW_ICON: Record<Decision["status"], { icon: LucideIcon; hex: string }> = {
  PENDING: { icon: Clock, hex: COLORS.amber },
  APPROVED: { icon: Check, hex: COLORS.green },
  DEFERRED: { icon: Flag, hex: COLORS.purple },
  SUPERSEDED: { icon: Flag, hex: COLORS.blue },
};
const gridCols = "md:grid-cols-[minmax(0,2.3fr)_minmax(0,1.2fr)_minmax(0,1.1fr)_minmax(0,1fr)_minmax(0,0.9fr)]";

function sourceLine(d: Decision): string {
  const first = d.evidence[0];
  if (first) return `${first.kind === "EMAIL" ? "Email" : first.kind === "MEETING" ? "Meeting" : first.kind === "DOCUMENT" ? "Document" : "Note"} · ${first.label}`;
  if (d.stream) return `Workstream · ${d.stream.title}`;
  return "No source linked";
}

/** Decisions & Dependencies: outcomes with their approvers and sources, and the work that waits on them. */
export function DecisionsPage({ initialTab = "all" }: { initialTab?: Tab }) {
  return (
    <WorkGraphWorkspace active={initialTab === "dependencies" ? "dependencies" : "decisions"}>
      <Body initialTab={initialTab} />
    </WorkGraphWorkspace>
  );
}

function Body({ initialTab }: { initialTab: Tab }) {
  const router = useRouter();
  const params = useSearchParams();
  const actions = useWorkGraphActions();
  const raw = params.get("tab");
  const tab: Tab = TABS.includes(raw as Tab) ? (raw as Tab) : initialTab;
  const setTab = (next: Tab) => {
    const base = initialTab === "dependencies" ? "/mail/work-graph/dependencies" : "/mail/work-graph/decisions";
    router.replace(next === (initialTab === "dependencies" ? "dependencies" : "all") ? base : `/mail/work-graph/decisions?tab=${next}`, { scroll: false });
  };

  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  const [scope, setScope] = useState<"accessible" | "owned" | "created">("accessible");
  const [days, setDays] = useState(30);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [oldestFirst, setOldestFirst] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(params.get("id"));
  const [editing, setEditing] = useState<Decision | null>(null);
  const [deciding, setDeciding] = useState<Decision | null>(null);
  const [deleting, setDeleting] = useState<Decision | null>(null);
  useEffect(() => {
    const t = window.setTimeout(() => setDebounced(query.trim()), 250);
    return () => window.clearTimeout(t);
  }, [query]);

  const listTab = tab === "awaiting" || tab === "approved" ? tab : "all";
  const data = useDecisions({ tab: listTab, scope, q: debounced || undefined, days });
  const allDecisions = useDecisions({ scope, days });
  const dependencies = useDependencies("all", debounced);
  const openDeps = useDependencies("open");
  const suggestions = useSuggestions("DECISION");
  const summary = allDecisions.data?.summary ?? data.data?.summary;
  const items = useMemo(() => {
    const list = data.data?.items ?? [];
    return oldestFirst ? [...list].reverse() : list;
  }, [data.data, oldestFirst]);
  const selected = items.find((d) => d.id === selectedId) ?? items[0] ?? null;
  const depCount = (dependencies.data ?? []).length;
  const suggestionCount = suggestions.data?.length ?? summary?.suggestions ?? 0;

  return (
    <>
      <WorkGraphHeader
        icon={Flag}
        title="Sema — Decisions & Dependencies"
        subtitle="Trace decisions, approvals and blocked work to the evidence that supports them."
        actions={
          <>
            <LivePill />
            <button type="button" className="zoiko-btn pri" onClick={() => actions.recordDecision()}>
              <Plus className="h-4 w-4" aria-hidden /> Record decision
            </button>
          </>
        }
      />

      <div className="mb-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4" data-testid="decision-stats">
        <Stat icon={Flag} hex={COLORS.blue} value={summary?.recorded ?? 0} label="Recorded decisions" hint="In your scope" />
        <Stat icon={Clock} hex={COLORS.amber} value={summary?.awaiting ?? 0} label="Awaiting approval" hint="Authorized approver required" />
        <Stat icon={Repeat} hex={COLORS.purple} value={summary?.blocked ?? 0} label="Blocked deliverables" hint="Linked dependency records" />
        <Stat icon={Sparkles} hex={COLORS.green} value={suggestionCount} label="Alet suggestion" hint="Unconfirmed · Review first" />
      </div>

      <div className="relative mb-4 flex flex-wrap items-center gap-2 border-b border-[var(--border)]">
        <div role="tablist" aria-label="Decisions" className="flex min-w-0 flex-1 gap-1 overflow-x-auto">
          {(
            [
              ["all", `All decisions (${summary?.recorded ?? 0})`],
              ["awaiting", `Awaiting approval (${summary?.awaiting ?? 0})`],
              ["approved", "Approved"],
              ["dependencies", `Dependencies (${depCount})`],
              ["suggested", `Suggested (${suggestionCount})`],
            ] as const
          ).map(([key, text]) => (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={tab === key}
              onClick={() => setTab(key)}
              className={`-mb-px shrink-0 border-b-2 px-3 pb-3 pt-1 text-[13.5px] ${tab === key ? "border-[var(--accent)] font-semibold text-[var(--ink)]" : "border-transparent text-[var(--ink2)] hover:text-[var(--ink)]"}`}
            >
              {text}
            </button>
          ))}
        </div>
        <div className="mb-2 flex items-center gap-2">
          <input className="zoiko-input !w-[230px]" placeholder="Search decisions or evidence…" aria-label="Search decisions" value={query} onChange={(e) => setQuery(e.target.value)} />
          <div className="relative">
            <button type="button" className="zoiko-btn" aria-expanded={filtersOpen} onClick={() => setFiltersOpen((o) => !o)}>
              <Filter className="h-3.5 w-3.5" aria-hidden /> Filters
            </button>
            {filtersOpen && (
              <div role="dialog" aria-label="Filters" className="absolute right-0 top-11 z-30 w-[260px] space-y-3 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3 shadow-[var(--sh3)]">
                <div>
                  <label htmlFor="df-scope" className={label}>
                    Scope
                  </label>
                  <select id="df-scope" className="zoiko-input w-full" value={scope} onChange={(e) => setScope(e.target.value as typeof scope)}>
                    <option value="accessible">My accessible work</option>
                    <option value="owned">Owned by me</option>
                    <option value="created">Created by me</option>
                  </select>
                </div>
                <div>
                  <label htmlFor="df-days" className={label}>
                    Settled decisions
                  </label>
                  <select id="df-days" className="zoiko-input w-full" value={days} onChange={(e) => setDays(Number(e.target.value))}>
                    {WINDOWS.map(([n, text]) => (
                      <option key={n} value={n}>
                        {text}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {tab === "suggested" ? (
        <SuggestionList suggestions={suggestions.data ?? []} loading={suggestions.isLoading} noun="decision" />
      ) : tab === "dependencies" ? (
        <DependencyTable dependencies={dependencies.data ?? []} loading={dependencies.isLoading} error={dependencies.error as Error | null} onAdd={() => actions.addDependency()} />
      ) : (
        <div className="grid min-h-[540px] gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
          <section aria-label="Decision register" className="flex min-w-0 flex-col overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--surface)]">
            <div className="flex items-start justify-between gap-3 border-b border-[var(--border)] p-4">
              <div>
                <h2 className="text-[16px] font-semibold text-[var(--ink)]">Decision register</h2>
                <p className="text-[12px] text-[var(--ink3)]">Human-recorded outcomes and pending decisions, with provenance.</p>
              </div>
              <button type="button" className="zoiko-btn" onClick={() => setOldestFirst((v) => !v)} aria-label={oldestFirst ? "Settled, oldest first" : "Settled, newest first"}>
                Date <ArrowDownUp className="h-3.5 w-3.5" aria-hidden />
              </button>
            </div>
            <div className={`hidden gap-3 border-b border-[var(--border)] px-4 py-2 text-[10.5px] font-semibold uppercase tracking-[0.12em] text-[var(--ink3)] md:grid ${gridCols}`}>
              <span>Decision / source</span>
              <span>Owner</span>
              <span>Review date</span>
              <span>Status</span>
              <span>Impact</span>
            </div>
            <ul className="min-h-0 flex-1 overflow-y-auto" data-testid="decision-list">
              {data.isLoading ? (
                <li className="p-4 text-[12.5px] text-[var(--ink3)]">Loading…</li>
              ) : data.isError ? (
                <li role="alert" className="p-4 text-[12.5px] text-[var(--crit)]">
                  {(data.error as Error).message}
                </li>
              ) : items.length === 0 ? (
                <li className="flex flex-col items-center gap-3 p-8 text-center text-[13px] text-[var(--ink3)]">
                  {debounced ? "No decision matches your search." : tab === "awaiting" ? "Nothing is waiting for approval." : "No decisions recorded yet. Record what was decided — or what still needs approving — with its source."}
                  {!debounced && tab === "all" && (
                    <button type="button" className="zoiko-btn pri" onClick={() => actions.recordDecision()}>
                      <Plus className="h-4 w-4" aria-hidden /> Record decision
                    </button>
                  )}
                </li>
              ) : (
                items.map((d) => {
                  const active = selected?.id === d.id;
                  const pillInfo = DECISION_PILL[d.status];
                  const icon = ROW_ICON[d.status];
                  return (
                    <li key={d.id}>
                      <button
                        type="button"
                        onClick={() => setSelectedId(d.id)}
                        aria-current={active ? "true" : undefined}
                        className={`grid w-full items-center gap-x-3 gap-y-1 border-b border-[var(--border)] px-4 py-3 text-left transition ${gridCols} ${active ? "bg-[var(--zm-selected)] shadow-[inset_3px_0_0_var(--accent)]" : "hover:bg-[var(--s2)]"}`}
                      >
                        <span className="flex min-w-0 items-center gap-3">
                          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border" style={{ color: icon.hex, borderColor: `color-mix(in srgb, ${icon.hex} 40%, transparent)`, backgroundColor: `color-mix(in srgb, ${icon.hex} 14%, transparent)` }} aria-hidden>
                            <icon.icon className="h-4 w-4" />
                          </span>
                          <span className="min-w-0">
                            <span className="block truncate text-[13.5px] font-semibold text-[var(--ink)]">{d.title}</span>
                            <span className="block truncate text-[11.5px] text-[var(--ink3)]">{sourceLine(d)}</span>
                          </span>
                        </span>
                        <OwnerLine owner={d.owner} sub={d.owner.isMe ? "My decision" : "Decision record"} />
                        <DueCell iso={d.reviewAt ?? d.decidedAt} zone={d.timeZone} />
                        <span>
                          <Pill hex={pillInfo.hex}>{pillInfo.text}</Pill>
                        </span>
                        <span>
                          <Pill hex={d.impact.blocked > 0 ? COLORS.red : COLORS.green}>{d.impact.blocked} blocked</Pill>
                        </span>
                      </button>
                    </li>
                  );
                })
              )}
            </ul>
            <p className="flex items-center justify-between border-t border-[var(--border)] px-4 py-2.5 text-[11.5px] text-[var(--ink3)]">
              <span>{data.data?.truncated ? `Showing the first ${items.length} — narrow the search to see the rest` : `${items.length} ${items.length === 1 ? "decision" : "decisions"}`}</span>
              <span>Approvals only by authorized decision-makers</span>
            </p>
          </section>

          {selected ? (
            <Detail key={selected.id + selected.updatedAt} decision={selected} onEdit={() => setEditing(selected)} onDecide={() => setDeciding(selected)} onDelete={() => setDeleting(selected)} onBlock={() => actions.addDependency({ blockerType: "DECISION", blockerId: selected.id })} />
          ) : (
            <aside className="hidden items-center justify-center rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-6 text-center text-[13px] text-[var(--ink3)] xl:flex">Select a decision to see its evidence.</aside>
          )}
        </div>
      )}

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <Card title="Blocking work" link={["Inspect dependencies", () => setTab("dependencies")]}>
          {(openDeps.data ?? []).filter((d) => d.state !== "UNBLOCKED").slice(0, 3).map((d) => (
            <MiniRow key={d.id} icon={Repeat} text={d.deliverable} meta={d.stateLabel} hot={d.state === "BLOCKED"} />
          ))}
          {(openDeps.data ?? []).filter((d) => d.state !== "UNBLOCKED").length === 0 && <p className="text-[12.5px] text-[var(--ink3)]">Nothing is blocked.</p>}
        </Card>
        <Card title="Decision attention" link={["Review queue", () => setTab("awaiting")]}>
          {(allDecisions.data?.items ?? []).filter((d) => d.status === "PENDING").slice(0, 3).map((d) => (
            <MiniRow key={d.id} icon={Clock} text={d.title} meta={d.reviewAt ? new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short", timeZone: d.timeZone }).format(new Date(d.reviewAt)) : "No date"} onClick={() => { setTab("awaiting"); setSelectedId(d.id); }} />
          ))}
          {(allDecisions.data?.items ?? []).every((d) => d.status !== "PENDING") && <p className="text-[12.5px] text-[var(--ink3)]">No decision is waiting.</p>}
        </Card>
        <Card title="Enterprise safeguards">
          <MiniRow icon={ShieldCheck} text="Authorized approver and source trail" meta="Required" />
          <MiniRow icon={UserCheck} text="AI never grants approval" meta="Review gate" />
        </Card>
      </div>

      {editing && <DecisionDialog decision={editing} onClose={() => setEditing(null)} />}
      {deciding && <DecideDialog decision={deciding} onClose={() => setDeciding(null)} />}
      <DeleteConfirm decision={deleting} onClose={() => setDeleting(null)} />
    </>
  );
}

function Card({ title, link, children }: { title: string; link?: [string, () => void]; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-[14px] font-semibold text-[var(--ink)]">{title}</h3>
        {link && (
          <button type="button" onClick={link[1]} className="flex items-center gap-0.5 text-[10.5px] font-bold uppercase tracking-wider text-[var(--accent-ink)] hover:underline">
            {link[0]} <ChevronRight className="h-3 w-3" aria-hidden />
          </button>
        )}
      </div>
      <div className="space-y-2.5">{children}</div>
    </section>
  );
}

function MiniRow({ icon: Icon, text, meta, hot, onClick }: { icon: LucideIcon; text: string; meta: string; hot?: boolean; onClick?: () => void }) {
  const inner = (
    <>
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[var(--s2)] text-[var(--ink3)]" aria-hidden>
        <Icon className="h-3.5 w-3.5" />
      </span>
      <span className="min-w-0 flex-1 truncate text-[12.5px] text-[var(--ink)]">{text}</span>
      <span className={`shrink-0 text-[11.5px] ${hot ? "text-[#E5484D]" : "text-[var(--ink3)]"}`}>{meta}</span>
    </>
  );
  return onClick ? (
    <button type="button" onClick={onClick} className="flex w-full items-center gap-3 rounded-lg text-left hover:bg-[var(--s2)]">
      {inner}
    </button>
  ) : (
    <div className="flex items-center gap-3">{inner}</div>
  );
}

function KV({ term, value }: { term: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-3 py-2">
      <dt className="text-[var(--ink3)]">{term}</dt>
      <dd className="text-right text-[var(--ink)]">{value}</dd>
    </div>
  );
}

function Detail({ decision: d, onEdit, onDecide, onDelete, onBlock }: { decision: Decision; onEdit: () => void; onDecide: () => void; onDelete: () => void; onBlock: () => void }) {
  const router = useRouter();
  const remove = useRemoveEvidence();
  const add = useAddEvidence();
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pillInfo = DECISION_PILL[d.status];
  const source = d.evidence.find((e) => e.openPath);
  const affected = d.impact.blocked > 0 ? `${d.impact.blocked} deliverable${d.impact.blocked === 1 ? "" : "s"} blocked: ${d.impact.deliverables.join(", ")}` : "No deliverables blocked";

  return (
    <aside aria-label="Selected decision" className="flex min-h-0 flex-col overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--surface)]" data-testid="decision-detail">
      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        <p className="text-[10.5px] font-bold uppercase tracking-[0.14em] text-[var(--accent-ink)]">Decision · {d.evidence.length ? "Source linked" : "No source linked"}</p>
        <h2 className="mt-2 text-[19px] font-bold leading-snug text-[var(--ink)]" data-testid="detail-title">
          {d.title}
        </h2>
        <div className="mt-2 flex flex-wrap gap-1.5">
          <Pill hex={pillInfo.hex}>{pillInfo.text}</Pill>
          {d.stream && <Pill hex={COLORS.blue}>{d.stream.title}</Pill>}
          {d.visibility === "WORKSPACE" && <Pill hex={COLORS.slate}>Shared</Pill>}
        </div>
        {d.rationale && <p className="mt-3 whitespace-pre-wrap text-[12.5px] leading-relaxed text-[var(--ink2)]">{d.rationale}</p>}
        <dl className="mt-3 divide-y divide-[var(--border)] text-[12.5px]">
          <KV term="Decision owner" value={d.owner.isMe ? `${d.owner.name} (you)` : d.owner.name} />
          <KV term="Decision / review" value={formatLong(d.reviewAt, d.timeZone)} />
          <KV term="Authorized approver" value={d.approver ? (d.approver.isMe ? `${d.approver.name} (you)` : d.approver.name) : "Workspace Owner or Admin"} />
          <KV term="Affected work" value={affected} />
          {d.decidedAt && <KV term={d.status === "APPROVED" ? "Approved by" : d.status === "DEFERRED" ? "Deferred by" : "Replaced by"} value={`${d.decidedBy ?? "—"} · ${formatLong(d.decidedAt, d.timeZone)}`} />}
          {d.supersededBy && <KV term="Replaced with" value={d.supersededBy.title} />}
        </dl>
        {d.decisionNote && <p className="mt-2 rounded-lg bg-[var(--s2)] px-3 py-2 text-[12px] italic text-[var(--ink2)]">“{d.decisionNote}”</p>}

        <div className="mt-4 rounded-xl border border-[var(--border)] bg-[var(--s2)] p-3" data-testid="decision-evidence">
          <p className="mb-2 text-[10.5px] font-bold uppercase tracking-[0.12em] text-[var(--accent-ink)]">Source evidence · Permission scoped</p>
          <EvidenceList items={d.evidence} onRemove={d.canEdit ? (item) => remove.mutate(item.id) : undefined} empty="No source is linked yet." />
          <p className="mt-2 text-[11px] text-[var(--ink3)]">Private source content remains restricted to authorized users.</p>
          {d.canEdit && (
            <button type="button" className="mt-2 text-[12px] font-medium text-[var(--accent-ink)] hover:underline" onClick={() => setAdding((v) => !v)}>
              {adding ? "Done" : "+ Link a source"}
            </button>
          )}
          {adding && (
            <div className="mt-2">
              <SourcePicker onPick={(s) => { setError(null); add.mutate({ subjectType: "DECISION", subjectId: d.id, evidence: s.input }, { onError: (e) => setError((e as Error).message) }); }} />
              {error && <p role="alert" className="mt-1 text-[12px] text-[var(--crit)]">{error}</p>}
            </div>
          )}
        </div>

        {d.canEdit && (
          <div className="mt-3 flex flex-wrap gap-2">
            <button type="button" className="zoiko-btn sm" onClick={onEdit}>
              Edit
            </button>
            {(d.status === "PENDING" || d.status === "DEFERRED") && (
              <button type="button" className="zoiko-btn sm" onClick={onBlock}>
                Something waits on this
              </button>
            )}
            {d.isCreator && (
              <button type="button" className="zoiko-btn sm text-[var(--crit)]" onClick={onDelete}>
                <Trash2 className="h-3 w-3" aria-hidden /> Delete
              </button>
            )}
          </div>
        )}
        {!d.canDecide && d.status !== "SUPERSEDED" && <p className="mt-3 text-[11.5px] text-[var(--ink3)]">{d.authority}</p>}
      </div>
      <div className="grid grid-cols-2 gap-2 border-t border-[var(--border)] p-3">
        <button type="button" className="zoiko-btn pri justify-center" disabled={!d.canDecide} title={d.canDecide ? undefined : d.status === "SUPERSEDED" ? "This decision has been replaced" : d.authority} onClick={onDecide}>
          Review approval
        </button>
        <button type="button" className="zoiko-btn justify-center" disabled={!source} title={source ? undefined : "No source you can open is linked"} onClick={() => source?.openPath && router.push(source.openPath)}>
          View evidence
        </button>
      </div>
    </aside>
  );
}

function DeleteConfirm({ decision, onClose }: { decision: Decision | null; onClose: () => void }) {
  const remove = useDeleteDecision();
  return (
    <ConfirmDialog
      open={Boolean(decision)}
      onClose={onClose}
      title="Delete decision"
      message={decision ? `Delete “${decision.title}”? Its linked sources stay where they are; only this record goes.` : ""}
      confirmLabel="Delete"
      loading={remove.isPending}
      onConfirm={() => decision && remove.mutate(decision.id, { onSuccess: onClose })}
    >
      {remove.error && <p role="alert" className="mt-2 text-[12.5px] text-[var(--crit)]">{(remove.error as Error).message}</p>}
    </ConfirmDialog>
  );
}

function DependencyTable({ dependencies, loading, error, onAdd }: { dependencies: Dependency[]; loading: boolean; error: Error | null; onAdd: () => void }) {
  const update = useUpdateDependency();
  const remove = useDeleteDependency();
  const failure = (update.error ?? remove.error) as Error | null;
  const cols = "md:grid-cols-[minmax(0,2fr)_minmax(0,1.2fr)_minmax(0,1.6fr)_minmax(0,1.3fr)_auto]";
  return (
    <section aria-label="Dependencies" className="overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--surface)]" data-testid="dependency-table">
      <div className="flex items-start justify-between gap-3 border-b border-[var(--border)] p-4">
        <div>
          <h2 className="text-[16px] font-semibold text-[var(--ink)]">Dependencies</h2>
          <p className="text-[12px] text-[var(--ink3)]">Deliverables waiting on a decision or a commitment. They unblock themselves, and tell their owner, when it is settled.</p>
        </div>
        <button type="button" className="zoiko-btn pri" onClick={onAdd}>
          <Plus className="h-4 w-4" aria-hidden /> Add dependency
        </button>
      </div>
      <div className={`hidden gap-3 border-b border-[var(--border)] px-4 py-2 text-[10.5px] font-semibold uppercase tracking-[0.12em] text-[var(--ink3)] md:grid ${cols}`}>
        <span>Deliverable</span>
        <span>Owner</span>
        <span>Waiting on</span>
        <span>Status</span>
        <span className="w-[150px]">Actions</span>
      </div>
      {loading ? (
        <p className="p-4 text-[12.5px] text-[var(--ink3)]">Loading…</p>
      ) : error ? (
        <p role="alert" className="p-4 text-[12.5px] text-[var(--crit)]">{error.message}</p>
      ) : dependencies.length === 0 ? (
        <p className="p-8 text-center text-[13px] text-[var(--ink3)]">Nothing is blocked. When a deliverable has to wait for a decision or a commitment, add it here.</p>
      ) : (
        <ul>
          {dependencies.map((d) => (
            <li key={d.id} className={`grid items-center gap-x-3 gap-y-1 border-b border-[var(--border)] px-4 py-3 ${cols}`} data-testid="dependency-row">
              <span className="min-w-0">
                <span className="block truncate text-[13.5px] font-semibold text-[var(--ink)]">{d.deliverable}</span>
                {d.stream && <span className="block truncate text-[11.5px] text-[var(--ink3)]">Workstream · {d.stream.title}</span>}
              </span>
              <OwnerLine owner={d.owner} sub={d.owner.isMe ? "My deliverable" : "Deliverable owner"} />
              <span className="min-w-0 text-[12.5px] text-[var(--ink)]">
                <span className="text-[11px] uppercase tracking-wide text-[var(--ink3)]">{d.blocker.type === "DECISION" ? "Decision" : "Commitment"}</span>
                <span className="block truncate">{d.blocker.title}</span>
              </span>
              <span>
                <Pill hex={DEPENDENCY_PILL[d.state].hex}>{d.stateLabel}</Pill>
              </span>
              <span className="flex w-[150px] gap-1.5">
                {d.canEdit && (
                  <>
                    <button type="button" className="zoiko-btn sm" disabled={update.isPending} onClick={() => update.mutate({ id: d.id, input: { resolved: !d.resolvedAt } })}>
                      {d.resolvedAt ? "Reopen" : "Resolve"}
                    </button>
                    <button type="button" className="zoiko-btn sm" aria-label={`Remove ${d.deliverable}`} disabled={remove.isPending} onClick={() => remove.mutate(d.id)}>
                      <Trash2 className="h-3 w-3" aria-hidden />
                    </button>
                  </>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
      {failure && <p role="alert" className="px-4 pb-3 text-[12px] text-[var(--crit)]">{failure.message}</p>}
    </section>
  );
}
