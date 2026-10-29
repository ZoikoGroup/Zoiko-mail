"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { ArrowDownUp, CalendarPlus, Check, ChevronRight, Clock, CornerDownRight, Filter, Plus, ShieldCheck, Sparkles, Target, Trash2, TriangleAlert, UserCheck, type LucideIcon } from "lucide-react";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { BrandLoader } from "@/components/ui/BrandLoader";
import { ErrorState } from "@/components/ui/ErrorState";
import { EventDialog } from "@/components/calendar/EventDialog";
import { useCalendars } from "@/lib/calendar-hooks";
import type { Commitment, Suggestion } from "@/lib/workgraph-api";
import {
  useAddEvidence,
  useCommitments,
  useConfirmSuggestion,
  useDeleteCommitment,
  useDismissSuggestion,
  useRemoveEvidence,
  useSuggestions,
  useUpdateCommitment,
} from "@/lib/workgraph-hooks";
import { formatLong } from "@/lib/workgraph-dates";
import { CommitmentDialog } from "./dialogs";
import { SourcePicker } from "./SourcePicker";
import { COLORS, COMMITMENT_PILL, DueCell, EvidenceList, OwnerLine, Pill, Stat, evidenceSummary, label } from "./shared";
import { LivePill, WorkGraphHeader, WorkGraphWorkspace, useWorkGraphActions } from "./WorkGraphWorkspace";

type Tab = "all" | "mine" | "awaiting" | "suggested";
const TABS: Tab[] = ["all", "mine", "awaiting", "suggested"];
const WINDOWS: Array<[number, string]> = [
  [7, "Last 7 days"],
  [30, "Last 30 days"],
  [90, "Last 90 days"],
  [365, "Last 12 months"],
  [0, "All time"],
];

const ROW_ICON: Record<Commitment["display"], { icon: LucideIcon; hex: string }> = {
  AWAITING: { icon: CornerDownRight, hex: COLORS.blue },
  PAST_DUE: { icon: TriangleAlert, hex: COLORS.amber },
  IN_PROGRESS: { icon: Check, hex: COLORS.green },
  RECORDED: { icon: Check, hex: COLORS.green },
  CANCELLED: { icon: Check, hex: COLORS.slate },
};

const gridCols = "md:grid-cols-[minmax(0,2.3fr)_minmax(0,1.2fr)_minmax(0,1.1fr)_minmax(0,1fr)_minmax(0,1fr)]";

function sourceLine(c: Commitment): string {
  const first = c.evidence[0];
  if (first) return `${first.kind === "EMAIL" ? "Email" : first.kind === "MEETING" ? "Meeting" : first.kind === "DOCUMENT" ? "Document" : "Note"} · ${first.label}`;
  if (c.stream) return `Workstream · ${c.stream.title}`;
  return "No source linked";
}

/** Commitments & Follow-ups: promises and expected replies, with owners, due dates and the evidence behind them. */
export function CommitmentsPage() {
  return (
    <WorkGraphWorkspace active="commitments">
      <Body />
    </WorkGraphWorkspace>
  );
}

function Body() {
  const router = useRouter();
  const params = useSearchParams();
  const actions = useWorkGraphActions();
  const raw = params.get("tab");
  const tab: Tab = TABS.includes(raw as Tab) ? (raw as Tab) : "all";
  const setTab = (next: Tab) => router.replace(next === "all" ? "/mail/work-graph/commitments" : `/mail/work-graph/commitments?tab=${next}`, { scroll: false });

  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  const [scope, setScope] = useState<"accessible" | "owned" | "created">("accessible");
  const [days, setDays] = useState(30);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [newestFirst, setNewestFirst] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(params.get("id"));
  const [editing, setEditing] = useState<Commitment | null>(null);
  const [deleting, setDeleting] = useState<Commitment | null>(null);
  const [planning, setPlanning] = useState<Commitment | null>(null);
  useEffect(() => {
    const t = window.setTimeout(() => setDebounced(query.trim()), 250);
    return () => window.clearTimeout(t);
  }, [query]);

  const data = useCommitments({ tab: tab === "suggested" ? "all" : tab, scope, q: debounced || undefined, days });
  const suggestions = useSuggestions("COMMITMENT");
  const summary = data.data?.summary;
  const items = useMemo(() => {
    const list = data.data?.items ?? [];
    return newestFirst ? [...list].reverse() : list;
  }, [data.data, newestFirst]);
  const selected = items.find((c) => c.id === selectedId) ?? items[0] ?? null;
  const suggestionCount = suggestions.data?.length ?? summary?.suggestions ?? 0;

  return (
    <>
      <WorkGraphHeader
        icon={Target}
        title="Sema — Commitments & Follow-ups"
        subtitle="Track promises and expected responses with accountable owners and source evidence."
        actions={
          <>
            <LivePill />
            <button type="button" className="zoiko-btn pri" onClick={() => actions.newCommitment()}>
              <Plus className="h-4 w-4" aria-hidden /> New commitment
            </button>
          </>
        }
      />

      <div className="mb-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4" data-testid="commitment-stats">
        <Stat icon={Target} hex={COLORS.blue} value={summary?.confirmed ?? 0} label="Confirmed commitments" hint="Evidence-linked, in your scope" />
        <Stat icon={CornerDownRight} hex={COLORS.green} value={summary?.awaiting ?? 0} label="Awaiting responses" hint="Owner remains accountable" />
        <Stat icon={Clock} hex={COLORS.amber} value={summary?.pastDue ?? 0} label="Past due" hint="Needs owner review" />
        <Stat icon={Sparkles} hex={COLORS.purple} value={suggestionCount} label="AI suggestions" hint="Unconfirmed · review first" />
      </div>

      <div className="relative mb-4 flex flex-wrap items-center gap-2 border-b border-[var(--border)]">
        <div role="tablist" aria-label="Commitments" className="flex min-w-0 flex-1 gap-1 overflow-x-auto overflow-y-hidden">
          {(
            [
              ["all", `All confirmed (${summary?.confirmed ?? 0})`],
              ["mine", "Owned by me"],
              ["awaiting", "Awaiting others"],
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
          <input className="zoiko-input !w-[230px]" placeholder="Search commitments or evidence…" aria-label="Search commitments" value={query} onChange={(e) => setQuery(e.target.value)} />
          <div className="relative">
            <button type="button" className="zoiko-btn" aria-expanded={filtersOpen} onClick={() => setFiltersOpen((o) => !o)}>
              <Filter className="h-3.5 w-3.5" aria-hidden /> Filters
            </button>
            {filtersOpen && (
              <div role="dialog" aria-label="Filters" className="absolute right-0 top-11 z-30 w-[260px] space-y-3 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3 shadow-[var(--sh3)]">
                <div>
                  <label htmlFor="cf-scope" className={label}>
                    Scope
                  </label>
                  <select id="cf-scope" className="zoiko-input w-full" value={scope} onChange={(e) => setScope(e.target.value as typeof scope)}>
                    <option value="accessible">My accessible work</option>
                    <option value="owned">Owned by me</option>
                    <option value="created">Created by me</option>
                  </select>
                </div>
                <div>
                  <label htmlFor="cf-days" className={label}>
                    Finished items
                  </label>
                  <select id="cf-days" className="zoiko-input w-full" value={days} onChange={(e) => setDays(Number(e.target.value))}>
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
        <SuggestionList
          suggestions={suggestions.data ?? []}
          loading={suggestions.isLoading}
          loadError={suggestions.data ? null : (suggestions.error as Error | null)}
          onRetry={() => void suggestions.refetch()}
        />
      ) : (
        <div className="grid min-h-[540px] gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
          <section aria-label="Commitment register" className="flex min-w-0 flex-col overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--surface)]">
            <div className="flex items-start justify-between gap-3 border-b border-[var(--border)] p-4">
              <div>
                <h2 className="text-[16px] font-semibold text-[var(--ink)]">Commitment register</h2>
                <p className="text-[12px] text-[var(--ink3)]">Evidence-linked obligations; not a duplicate of your task list.</p>
              </div>
              <button type="button" className="zoiko-btn" onClick={() => setNewestFirst((v) => !v)} aria-label={newestFirst ? "Sorted by due date, latest first" : "Sorted by due date, soonest first"}>
                Due date <ArrowDownUp className="h-3.5 w-3.5" aria-hidden />
              </button>
            </div>
            <div className={`hidden gap-3 border-b border-[var(--border)] px-4 py-2 text-[10.5px] font-semibold uppercase tracking-[0.12em] text-[var(--ink3)] md:grid ${gridCols}`}>
              <span>Commitment / source</span>
              <span>Owner</span>
              <span>Due</span>
              <span>Status</span>
              <span>Evidence</span>
            </div>
            <ul className="min-h-0 flex-1 overflow-y-auto" data-testid="commitment-list">
              {data.isLoading ? (
                <li>
                  <BrandLoader variant="compact" label="Loading commitments" onRetry={() => void data.refetch()} />
                </li>
              ) : data.isError ? (
                <li role="alert" className="p-4 text-[12.5px] text-[var(--crit)]">
                  {(data.error as Error).message}
                </li>
              ) : items.length === 0 ? (
                <li className="flex flex-col items-center gap-3 p-8 text-center text-[13px] text-[var(--ink3)]">
                  {debounced ? "No commitment matches your search." : tab === "awaiting" ? "Nothing is waiting on anyone else." : "No commitments yet. Record a promise or an expected reply, with its source."}
                  {!debounced && tab === "all" && (
                    <button type="button" className="zoiko-btn pri" onClick={() => actions.newCommitment()}>
                      <Plus className="h-4 w-4" aria-hidden /> New commitment
                    </button>
                  )}
                </li>
              ) : (
                items.map((c) => {
                  const active = selected?.id === c.id;
                  const pillInfo = COMMITMENT_PILL[c.display];
                  const icon = ROW_ICON[c.display];
                  return (
                    <li key={c.id}>
                      <button
                        type="button"
                        onClick={() => setSelectedId(c.id)}
                        aria-current={active ? "true" : undefined}
                        className={`grid w-full items-center gap-x-3 gap-y-1 border-b border-[var(--border)] px-4 py-3 text-left transition ${gridCols} ${active ? "bg-[var(--zm-selected)] shadow-[inset_3px_0_0_var(--accent)]" : "hover:bg-[var(--s2)]"}`}
                      >
                        <span className="flex min-w-0 items-center gap-3">
                          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border" style={{ color: icon.hex, borderColor: `color-mix(in srgb, ${icon.hex} 40%, transparent)`, backgroundColor: `color-mix(in srgb, ${icon.hex} 14%, transparent)` }} aria-hidden>
                            <icon.icon className="h-4 w-4" />
                          </span>
                          <span className="min-w-0">
                            <span className="block truncate text-[13.5px] font-semibold text-[var(--ink)]">{c.title}</span>
                            <span className="block truncate text-[11.5px] text-[var(--ink3)]">{sourceLine(c)}</span>
                          </span>
                        </span>
                        <OwnerLine owner={c.owner} />
                        <DueCell iso={c.dueAt} zone={c.timeZone} late={c.display === "PAST_DUE"} />
                        <span>
                          <Pill hex={pillInfo.hex}>{pillInfo.text}</Pill>
                        </span>
                        <span className="text-[12px] text-[var(--ink3)]">{evidenceSummary(c.evidence)}</span>
                      </button>
                    </li>
                  );
                })
              )}
            </ul>
            <p className="flex items-center justify-between border-t border-[var(--border)] px-4 py-2.5 text-[11.5px] text-[var(--ink3)]">
              <span>{data.data?.truncated ? `Showing the first ${items.length} — narrow the search to see the rest` : `${items.length} ${items.length === 1 ? "record" : "records"} · Evidence-linked`}</span>
              <span>Changes and decisions require source attribution</span>
            </p>
          </section>

          {selected ? (
            <Detail
              key={selected.id + selected.updatedAt}
              commitment={selected}
              onEdit={() => setEditing(selected)}
              onDelete={() => setDeleting(selected)}
              onPlan={() => setPlanning(selected)}
              onBlock={() => actions.addDependency({ blockerType: "COMMITMENT", blockerId: selected.id })}
            />
          ) : (
            <aside className="hidden items-center justify-center rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-6 text-center text-[13px] text-[var(--ink3)] xl:flex">
              Select a commitment to see its evidence.
            </aside>
          )}
        </div>
      )}

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <Card title="Needs attention" link={["Open queue", () => setTab("awaiting")]}>
          {(data.data?.items ?? []).filter((c) => c.display === "PAST_DUE" || c.display === "AWAITING").slice(0, 3).map((c) => (
            <Row key={c.id} icon={c.display === "PAST_DUE" ? Clock : CornerDownRight} text={c.title} meta={c.dueAt ? `${c.display === "PAST_DUE" ? "Past due · " : ""}${new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short", timeZone: c.timeZone }).format(new Date(c.dueAt))}` : "No date"} hot={c.display === "PAST_DUE"} onClick={() => setSelectedId(c.id)} />
          ))}
          {(data.data?.items ?? []).every((c) => c.display !== "PAST_DUE" && c.display !== "AWAITING") && <p className="text-[12.5px] text-[var(--ink3)]">Nothing needs attention.</p>}
        </Card>
        <Card title="Suggested follow-ups" link={[`Review ${suggestionCount}`, () => setTab("suggested")]}>
          {(suggestions.data ?? []).slice(0, 3).map((s) => (
            <Row key={s.id} icon={Sparkles} text={s.title} meta="Unconfirmed" onClick={() => setTab("suggested")} />
          ))}
          {(suggestions.data ?? []).length === 0 && <p className="text-[12.5px] text-[var(--ink3)]">No suggestions waiting. Alet only suggests — you confirm.</p>}
        </Card>
        <Card title="Enterprise safeguards">
          <Row icon={ShieldCheck} text="Original evidence and attribution" meta="Required" />
          <Row icon={UserCheck} text="AI never commits on your behalf" meta="Review gate" />
        </Card>
      </div>

      {editing && <CommitmentDialog commitment={editing} onClose={() => setEditing(null)} />}
      {planning && <FollowUp commitment={planning} onClose={() => setPlanning(null)} />}
      <DeleteConfirm commitment={deleting} onClose={() => setDeleting(null)} />
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

function Row({ icon: Icon, text, meta, hot, onClick }: { icon: LucideIcon; text: string; meta: string; hot?: boolean; onClick?: () => void }) {
  const inner = (
    <>
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[var(--s2)] text-[var(--ink3)]" aria-hidden>
        <Icon className="h-3.5 w-3.5" />
      </span>
      <span className="min-w-0 flex-1 truncate text-[12.5px] text-[var(--ink)]">{text}</span>
      <span className={`shrink-0 text-[11.5px] ${hot ? "text-[#E0A33A]" : "text-[var(--ink3)]"}`}>{meta}</span>
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

function Detail({ commitment: c, onEdit, onDelete, onPlan, onBlock }: { commitment: Commitment; onEdit: () => void; onDelete: () => void; onPlan: () => void; onBlock: () => void }) {
  const router = useRouter();
  const update = useUpdateCommitment();
  const remove = useRemoveEvidence();
  const add = useAddEvidence();
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pillInfo = COMMITMENT_PILL[c.display];
  const source = c.evidence.find((e) => e.openPath);
  const finished = c.status === "RECORDED" || c.status === "CANCELLED";

  return (
    <aside aria-label="Selected commitment" className="flex min-h-0 flex-col overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--surface)]" data-testid="commitment-detail">
      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        <p className="text-[10.5px] font-bold uppercase tracking-[0.14em] text-[var(--accent-ink)]">Selected commitment · {c.evidence.length ? "Evidence linked" : "No evidence linked"}</p>
        <h2 className="mt-2 text-[19px] font-bold leading-snug text-[var(--ink)]" data-testid="detail-title">
          {c.title}
        </h2>
        <div className="mt-2 flex flex-wrap gap-1.5">
          <Pill hex={pillInfo.hex}>{pillInfo.text}</Pill>
          {c.stream && <Pill hex={COLORS.blue}>{c.stream.title}</Pill>}
          {c.visibility === "WORKSPACE" && <Pill hex={COLORS.slate}>Shared</Pill>}
          {c.blocking.blocked > 0 && <Pill hex={COLORS.red}>{c.blocking.blocked} blocked</Pill>}
        </div>
        {c.description && <p className="mt-3 whitespace-pre-wrap text-[12.5px] leading-relaxed text-[var(--ink2)]">{c.description}</p>}
        <dl className="mt-3 divide-y divide-[var(--border)] text-[12.5px]">
          <KV term="Accountable owner" value={c.owner.isMe ? `${c.owner.name} (you)` : c.owner.name} />
          <KV term="Due / follow-up" value={formatLong(c.dueAt, c.timeZone)} />
          <KV term="Expected from" value={c.expectedFrom ?? "—"} />
          <KV term="Added by" value={c.createdBy.isMe ? "You" : c.createdBy.name} />
        </dl>

        <div className="mt-4 rounded-xl border border-[var(--border)] bg-[var(--s2)] p-3">
          <p className="mb-2 text-[10.5px] font-bold uppercase tracking-[0.12em] text-[var(--accent-ink)]">Source evidence</p>
          <EvidenceList
            items={c.evidence}
            onRemove={c.canEdit ? (item) => remove.mutate(item.id) : undefined}
            empty="No source is linked yet. Link the email or meeting this came from."
          />
          {c.canEdit && (
            <button type="button" className="mt-2 text-[12px] font-medium text-[var(--accent-ink)] hover:underline" onClick={() => setAdding((v) => !v)}>
              {adding ? "Done" : "+ Link a source"}
            </button>
          )}
          {adding && (
            <div className="mt-2">
              <SourcePicker
                onPick={(s) => {
                  setError(null);
                  add.mutate({ subjectType: "COMMITMENT", subjectId: c.id, evidence: s.input }, { onError: (e) => setError((e as Error).message) });
                }}
              />
              {error && <p role="alert" className="mt-1 text-[12px] text-[var(--crit)]">{error}</p>}
            </div>
          )}
        </div>

        {c.canEdit && (
          <div className="mt-3 flex flex-wrap gap-2">
            <button type="button" className="zoiko-btn sm" onClick={onEdit}>
              Edit
            </button>
            <button type="button" className="zoiko-btn sm" disabled={update.isPending} onClick={() => update.mutate({ id: c.id, input: { status: finished ? "IN_PROGRESS" : "RECORDED" } })}>
              {finished ? "Reopen" : "Mark recorded"}
            </button>
            {!finished && (
              <button type="button" className="zoiko-btn sm" onClick={onBlock}>
                Something waits on this
              </button>
            )}
            {c.isCreator && (
              <button type="button" className="zoiko-btn sm text-[var(--crit)]" onClick={onDelete}>
                <Trash2 className="h-3 w-3" aria-hidden /> Delete
              </button>
            )}
          </div>
        )}
        {update.error && <p role="alert" className="mt-2 text-[12px] text-[var(--crit)]">{(update.error as Error).message}</p>}
      </div>
      <div className="grid grid-cols-2 gap-2 border-t border-[var(--border)] p-3">
        <button type="button" className="zoiko-btn pri justify-center" onClick={onPlan}>
          <CalendarPlus className="h-4 w-4" aria-hidden /> Plan follow-up
        </button>
        <button type="button" className="zoiko-btn justify-center" disabled={!source} title={source ? undefined : "No source you can open is linked"} onClick={() => source?.openPath && router.push(source.openPath)}>
          View source
        </button>
      </div>
    </aside>
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

/** "Plan follow-up": a meeting on the calendar, at the due time, with the owner invited. */
function FollowUp({ commitment: c, onClose }: { commitment: Commitment; onClose: () => void }) {
  const calendars = useCalendars();
  if (!calendars.data) return null;
  const due = c.dueAt ? new Date(c.dueAt) : null;
  const start = due && due.getTime() > Date.now() ? due : (() => {
    const d = new Date();
    d.setSeconds(0, 0);
    d.setMinutes(d.getMinutes() < 30 ? 30 : 60);
    return d;
  })();
  return (
    <EventDialog
      calendars={calendars.data}
      seed={{ title: `Follow up: ${c.title}`.slice(0, 200), start, end: new Date(start.getTime() + 30 * 60_000), attendees: c.owner.email && !c.owner.isMe ? [c.owner.email] : undefined }}
      onClose={onClose}
    />
  );
}

function DeleteConfirm({ commitment, onClose }: { commitment: Commitment | null; onClose: () => void }) {
  const remove = useDeleteCommitment();
  return (
    <ConfirmDialog
      open={Boolean(commitment)}
      onClose={onClose}
      title="Delete commitment"
      message={commitment ? `Delete “${commitment.title}”? Its linked sources stay where they are; only this record goes. If you only want to stop tracking it, cancel it instead.` : ""}
      confirmLabel="Delete"
      loading={remove.isPending}
      onConfirm={() => commitment && remove.mutate(commitment.id, { onSuccess: onClose })}
    >
      {remove.error && <p role="alert" className="mt-2 text-[12.5px] text-[var(--crit)]">{(remove.error as Error).message}</p>}
    </ConfirmDialog>
  );
}

export function SuggestionList({
  suggestions,
  loading,
  loadError = null,
  onRetry,
  noun = "commitment",
}: {
  suggestions: Suggestion[];
  loading: boolean;
  /** The first load failed: there is nothing to show. */
  loadError?: Error | null;
  onRetry?: () => void;
  noun?: "commitment" | "decision";
}) {
  const confirm = useConfirmSuggestion();
  const dismiss = useDismissSuggestion();
  const error = (confirm.error ?? dismiss.error) as Error | null;
  return (
    <section aria-label={`Suggested ${noun}s`} className="rounded-2xl border border-[var(--border)] bg-[var(--surface)]" data-testid="suggestion-list">
      <div className="border-b border-[var(--border)] p-4">
        <h2 className="text-[16px] font-semibold text-[var(--ink)]">Suggested by Alet</h2>
        <p className="text-[12px] text-[var(--ink3)]">Found in your mail. Nothing becomes {noun === "decision" ? "a decision" : "a commitment"} until you confirm it, and the email becomes its evidence.{noun === "decision" ? " An approval it spotted is recorded as pending — only the authorized approver can grant it." : ""}</p>
      </div>
      {loadError ? (
        <ErrorState compact message={loadError.message || undefined} onRetry={onRetry} />
      ) : loading ? (
        <BrandLoader variant="compact" label="Loading suggestions" onRetry={onRetry} />
      ) : suggestions.length === 0 ? (
        <p className="p-8 text-center text-[13px] text-[var(--ink3)]">No suggestions waiting. When Alet finds {noun === "decision" ? "an approval needed" : "a promise or a reply owed"} in your mail, it will appear here for you to confirm or dismiss.</p>
      ) : (
        <ul className="divide-y divide-[var(--border)]">
          {suggestions.map((s) => (
            <li key={s.id} className="flex flex-wrap items-start gap-3 p-4">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[var(--accent-soft)] text-[var(--accent-ink)]" aria-hidden>
                <Sparkles className="h-4 w-4" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-[13.5px] font-semibold text-[var(--ink)]">{s.title}</p>
                {s.excerpt && <p className="mt-0.5 text-[12px] italic text-[var(--ink3)]">“{s.excerpt}”</p>}
                <p className="mt-1 text-[11.5px] text-[var(--ink3)]">
                  {s.dueAt ? `Due ${new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short" }).format(new Date(s.dueAt))} · ` : ""}
                  {s.source ? (
                    <Link href={s.source.openPath} className="text-[var(--accent-ink)] hover:underline">
                      Email · {s.source.subject}
                    </Link>
                  ) : (
                    "Source not available to you"
                  )}
                </p>
              </div>
              <div className="flex gap-2">
                <button type="button" className="zoiko-btn sm pri" disabled={confirm.isPending} onClick={() => confirm.mutate({ id: s.id })}>
                  Confirm
                </button>
                <button type="button" className="zoiko-btn sm" disabled={dismiss.isPending} onClick={() => dismiss.mutate(s.id)}>
                  Dismiss
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
      {error && <p role="alert" className="px-4 pb-3 text-[12px] text-[var(--crit)]">{error.message}</p>}
    </section>
  );
}
