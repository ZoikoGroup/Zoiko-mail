"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { CalendarDays, ChevronRight, Clock, FileText, Filter, Flag, Mail, Network, Pencil, Plus, Repeat, ShieldCheck, Sparkles, StickyNote, Target, Trash2, UserRound, Waypoints, type LucideIcon } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { BrandLoader } from "@/components/ui/BrandLoader";
import type { GraphEdge, GraphNode, NodeType, Overview, Stream } from "@/lib/workgraph-api";
import { useOverview, useRemoveEvidence, useUpdateCommitment, useUpdateDecision, useUpdateDependency } from "@/lib/workgraph-hooks";
import { StreamDialog } from "./dialogs";
import { COLORS, EvidenceList, Pill, label, pill } from "./shared";
import { LivePill, WorkGraphHeader, WorkGraphWorkspace, useWorkGraphActions } from "./WorkGraphWorkspace";

const WINDOWS: Array<[number, string]> = [
  [7, "Last 7 days"],
  [30, "Last 30 days"],
  [90, "Last 90 days"],
  [365, "Last 12 months"],
  [0, "All time"],
];

const ICON: Record<NodeType, LucideIcon> = {
  STREAM: Network,
  OWNER: UserRound,
  COMMITMENT: Target,
  DECISION: Flag,
  DELIVERABLE: Repeat,
  EMAIL: Mail,
  MEETING: CalendarDays,
  DOCUMENT: FileText,
  NOTE: StickyNote,
  SUGGESTION: Sparkles,
};
const TONE_HEX = { ok: COLORS.green, warn: COLORS.amber, crit: COLORS.red, info: COLORS.blue } as const;
/** The colour of the line into a node, so the map reads at a glance. */
const EDGE_HEX: Record<NodeType, string> = {
  STREAM: COLORS.blue,
  OWNER: COLORS.green,
  COMMITMENT: COLORS.green,
  DECISION: COLORS.amber,
  DELIVERABLE: COLORS.purple,
  EMAIL: COLORS.blue,
  MEETING: COLORS.purple,
  DOCUMENT: COLORS.slate,
  NOTE: COLORS.slate,
  SUGGESTION: COLORS.amber,
};
const GROUP: NodeType[] = ["OWNER", "COMMITMENT", "DECISION", "DELIVERABLE", "EMAIL", "MEETING", "DOCUMENT", "NOTE", "SUGGESTION"];
const KINDS: Array<[string, string, NodeType[]]> = [
  ["commitments", "Commitments", ["COMMITMENT"]],
  ["decisions", "Decisions", ["DECISION"]],
  ["deliverables", "Deliverables", ["DELIVERABLE"]],
  ["sources", "Sources", ["EMAIL", "MEETING", "DOCUMENT", "NOTE"]],
];

/** Work Graph overview: one workstream, the people, promises, decisions and sources around it. */
export function OverviewPage() {
  return (
    <WorkGraphWorkspace active="overview">
      <Body />
    </WorkGraphWorkspace>
  );
}

/** Centre-out layout: the stream in the middle, everything else evenly around it. */
function layout(nodes: GraphNode[]): Map<string, { x: number; y: number }> {
  const out = new Map<string, { x: number; y: number }>();
  const center = nodes.find((n) => n.type === "STREAM");
  if (center) out.set(center.id, { x: 50, y: 50 });
  const rest = nodes.filter((n) => n.type !== "STREAM").sort((a, b) => GROUP.indexOf(a.type) - GROUP.indexOf(b.type));
  rest.forEach((node, i) => {
    // A crowded map alternates between an inner and an outer ring so cards do not pile up.
    const inner = rest.length > 7 && i % 2 === 1;
    const angle = (-90 + (360 * i) / rest.length) * (Math.PI / 180);
    const rx = inner ? 27 : 40;
    const ry = inner ? 25 : 38;
    out.set(node.id, { x: 50 + rx * Math.cos(angle), y: 50 + ry * Math.sin(angle) });
  });
  return out;
}

function Body() {
  const router = useRouter();
  const params = useSearchParams();
  const actions = useWorkGraphActions();
  const [streamId, setStreamId] = useState<string | undefined>(params.get("stream") ?? undefined);
  const [scope, setScope] = useState<"accessible" | "owned">("accessible");
  const [links, setLinks] = useState<"confirmed" | "all">("confirmed");
  const [days, setDays] = useState(30);
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  const [view, setView] = useState<"graph" | "list">("graph");
  const [hiddenKinds, setHiddenKinds] = useState<Set<string>>(new Set());
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editingStream, setEditingStream] = useState<Stream | null>(null);
  const [reviewing, setReviewing] = useState<GraphNode | null>(null);
  useEffect(() => {
    const t = window.setTimeout(() => setDebounced(query.trim()), 250);
    return () => window.clearTimeout(t);
  }, [query]);

  const overview = useOverview({ streamId, scope, links, days, q: debounced || undefined });
  const data = overview.data;
  const hiddenTypes = useMemo(() => new Set(KINDS.filter(([key]) => hiddenKinds.has(key)).flatMap(([, , types]) => types)), [hiddenKinds]);
  const nodes = useMemo(() => (data?.nodes ?? []).filter((n) => !hiddenTypes.has(n.type)), [data, hiddenTypes]);
  const nodeIds = useMemo(() => new Set(nodes.map((n) => n.id)), [nodes]);
  const edges = useMemo(() => (data?.edges ?? []).filter((e) => nodeIds.has(e.from) && nodeIds.has(e.to)), [data, nodeIds]);
  const positions = useMemo(() => layout(nodes), [nodes]);
  const selected = nodes.find((n) => n.id === selectedId) ?? nodes.find((n) => n.type === "STREAM") ?? null;

  const pickStream = (id: string) => {
    setStreamId(id || undefined);
    setSelectedId(null);
    router.replace(id ? `/mail/work-graph?stream=${id}` : "/mail/work-graph", { scroll: false });
  };

  return (
    <>
      <WorkGraphHeader
        icon={Network}
        title="Sema Work Graph"
        subtitle="Understand the relationships behind work—without losing the original evidence."
        actions={
          <>
            <LivePill />
            <button type="button" className="zoiko-btn" onClick={() => actions.addRelationship(data?.stream?.id)}>
              <Plus className="h-4 w-4" aria-hidden /> Add relationship
            </button>
          </>
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <span className="mr-2 text-[14px] font-bold text-[var(--ink)]">Overview</span>
        <Chip label="Workstream">
          <select aria-label="Workstream" value={data?.stream?.id ?? ""} onChange={(e) => pickStream(e.target.value)} disabled={!data || data.streams.length === 0}>
            {(data?.streams ?? []).map((s) => (
              <option key={s.id} value={s.id}>
                {s.title}
              </option>
            ))}
            {(data?.streams ?? []).length === 0 && <option value="">None yet</option>}
          </select>
        </Chip>
        <Chip label="Scope">
          <select aria-label="Scope" value={scope} onChange={(e) => setScope(e.target.value as typeof scope)}>
            <option value="accessible">My accessible work</option>
            <option value="owned">Owned by me</option>
          </select>
        </Chip>
        <Chip label="Links">
          <select aria-label="Links" value={links} onChange={(e) => setLinks(e.target.value as typeof links)}>
            <option value="confirmed">Confirmed only</option>
            <option value="all">Include suggested</option>
          </select>
        </Chip>
        <Chip label="">
          <select aria-label="Time window" value={days} onChange={(e) => setDays(Number(e.target.value))}>
            {WINDOWS.map(([n, text]) => (
              <option key={n} value={n}>
                {text}
              </option>
            ))}
          </select>
        </Chip>
        <div className="ml-auto flex items-center gap-2">
          <input className="zoiko-input !w-[240px]" placeholder="Search connected work…" aria-label="Search connected work" value={query} onChange={(e) => setQuery(e.target.value)} />
          <div className="relative">
            <button type="button" className="zoiko-btn" aria-expanded={filtersOpen} onClick={() => setFiltersOpen((o) => !o)}>
              <Filter className="h-3.5 w-3.5" aria-hidden /> Filters
            </button>
            {filtersOpen && (
              <div role="dialog" aria-label="Filters" className="absolute right-0 top-11 z-30 w-[240px] rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3 shadow-[var(--sh3)]">
                <p className={label}>Show on the map</p>
                <ul className="space-y-1.5">
                  {KINDS.map(([key, text]) => (
                    <li key={key}>
                      <label className="flex cursor-pointer items-center gap-2 text-[13px] text-[var(--ink)]">
                        <input
                          type="checkbox"
                          checked={!hiddenKinds.has(key)}
                          onChange={() =>
                            setHiddenKinds((current) => {
                              const next = new Set(current);
                              if (next.has(key)) next.delete(key);
                              else next.add(key);
                              return next;
                            })
                          }
                        />
                        {text}
                      </label>
                    </li>
                  ))}
                </ul>
                <div className="mt-3 flex gap-2 border-t border-[var(--border)] pt-3">
                  <button type="button" className="zoiko-btn sm" disabled={!data?.stream?.canEdit} onClick={() => { setEditingStream(data!.stream); setFiltersOpen(false); }}>
                    <Pencil className="h-3 w-3" aria-hidden /> Edit workstream
                  </button>
                  <button type="button" className="zoiko-btn sm" onClick={() => { actions.newStream(); setFiltersOpen(false); }}>
                    <Plus className="h-3 w-3" aria-hidden /> New
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {overview.isError && !data ? (
        <p role="alert" className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-6 text-[13px] text-[var(--crit)]">
          Could not load the Work Graph. {(overview.error as Error).message}
        </p>
      ) : overview.isLoading ? (
        <BrandLoader variant="panel" label="Loading the Work Graph" onRetry={() => void overview.refetch()} />
      ) : !data?.stream ? (
        <div className="flex flex-col items-center gap-3 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-10 text-center" data-testid="graph-empty">
          <Waypoints className="h-9 w-9 text-[var(--accent-ink)]" aria-hidden />
          <h2 className="text-[17px] font-semibold text-[var(--ink)]">Start with a workstream</h2>
          <p className="max-w-md text-[13px] text-[var(--ink2)]">
            A workstream is what connected work is organised around — a launch, a migration, a customer. Add one, then put the commitments and decisions in it and link the emails and meetings that evidence them.
          </p>
          <button type="button" className="zoiko-btn pri" onClick={() => actions.newStream()}>
            <Plus className="h-4 w-4" aria-hidden /> New workstream
          </button>
        </div>
      ) : (
        <div className="grid min-h-[440px] gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
          <section aria-label="Connected work map" className="flex min-w-0 flex-col overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--surface)]">
            <div className="flex items-start justify-between gap-3 border-b border-[var(--border)] p-4">
              <div>
                <h2 className="text-[16px] font-semibold text-[var(--ink)]">Connected work map</h2>
                <p className="text-[12px] text-[var(--ink3)]">
                  {nodes.length - 1 > 0 ? `${edges.filter((e) => e.kind === "CONFIRMED").length} evidence-backed relationships around one workstream.` : "Nothing is linked to this workstream yet."}
                </p>
              </div>
              <div role="tablist" aria-label="View" className="inline-flex rounded-lg border border-[var(--border)] bg-[var(--s2)] p-0.5">
                {(["graph", "list"] as const).map((v) => (
                  <button key={v} type="button" role="tab" aria-selected={view === v} onClick={() => setView(v)} className={`rounded-md px-3 py-1.5 text-[12.5px] ${view === v ? "bg-[var(--accent)] font-semibold text-white" : "text-[var(--ink2)]"}`}>
                    {v === "graph" ? "Graph" : "List"}
                  </button>
                ))}
              </div>
            </div>

            {view === "graph" ? (
              <GraphCanvas nodes={nodes} edges={edges} positions={positions} selectedId={selected?.id ?? null} onSelect={setSelectedId} />
            ) : (
              <ul className="min-h-[360px] flex-1 divide-y divide-[var(--border)] overflow-y-auto" data-testid="graph-list">
                {nodes.map((n) => {
                  const Icon = ICON[n.type];
                  return (
                    <li key={n.id}>
                      <button type="button" onClick={() => setSelectedId(n.id)} aria-current={selected?.id === n.id ? "true" : undefined} className={`flex w-full items-center gap-3 px-4 py-3 text-left ${selected?.id === n.id ? "bg-[var(--zm-selected)]" : "hover:bg-[var(--s2)]"}`}>
                        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border" style={pill(TONE_HEX[n.tone])} aria-hidden>
                          <Icon className="h-4 w-4" />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[13.5px] font-semibold text-[var(--ink)]">{n.title}</span>
                          <span className="block truncate text-[11.5px] text-[var(--ink3)]">{n.subtitle}</span>
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}

            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[var(--border)] px-4 py-2.5 text-[11.5px] text-[var(--ink3)]">
              <span className="flex flex-wrap items-center gap-4">
                <span className="flex items-center gap-1.5">
                  <span className="h-0.5 w-5 bg-[#3B7BF6]" aria-hidden /> Confirmed relationship
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="w-5 border-t-2 border-dashed border-[#E0A33A]" aria-hidden /> Suggested (review required)
                </span>
                <span>Select a node to inspect its source</span>
              </span>
              <span>
                {nodes.length} {nodes.length === 1 ? "object" : "objects"}
                {data.hidden > 0 ? ` · ${data.hidden} more not shown` : ""}
              </span>
            </div>
          </section>

          {selected && <NodePanel node={selected} onReview={() => setReviewing(selected)} />}
        </div>
      )}

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <Card title="Attention needed" link={["View commitments", () => router.push("/mail/work-graph/commitments")]}>
          {(data?.attention.commitments ?? []).map((c) => (
            <Line key={c.id} icon={Clock} text={c.title} meta={c.due ? `${c.pastDue ? "Past due · " : "Due "}${c.due}` : "No date"} hot={c.pastDue} onClick={() => router.push(`/mail/work-graph/commitments?id=${c.id}`)} />
          ))}
          {(data?.attention.pendingDecisions ?? 0) > 0 && <Line icon={Flag} text={`${data!.attention.pendingDecisions} decision${data!.attention.pendingDecisions === 1 ? "" : "s"} awaiting approval`} meta="Review" onClick={() => router.push("/mail/work-graph/decisions?tab=awaiting")} />}
          {(data?.attention.commitments ?? []).length === 0 && (data?.attention.pendingDecisions ?? 0) === 0 && <p className="text-[12.5px] text-[var(--ink3)]">Nothing needs attention.</p>}
        </Card>
        <Card title="Suggested links" link={["Review", () => router.push("/mail/work-graph/commitments?tab=suggested")]}>
          {(data?.attention.suggestions ?? []).map((s) => (
            <Line key={s.id} icon={Sparkles} text={s.title} meta="Unconfirmed" onClick={() => router.push(s.kind === "DECISION" ? "/mail/work-graph/decisions?tab=suggested" : "/mail/work-graph/commitments?tab=suggested")} />
          ))}
          <Line icon={ShieldCheck} text="No suggestion applied automatically" meta="Human review" />
        </Card>
        <Card title="Graph integrity">
          <Line icon={ShieldCheck} text="Source permissions checked" meta="Design rule" />
          <Line icon={Pencil} text="Changes require attribution" meta="Audit required" />
        </Card>
      </div>

      {editingStream && <StreamDialog stream={editingStream} onClose={() => setEditingStream(null)} />}
      {reviewing && data?.stream && <ReviewLinksDialog node={reviewing} stream={data.stream} onClose={() => setReviewing(null)} onEditStream={() => { setReviewing(null); setEditingStream(data.stream); }} />}
    </>
  );
}

function Chip({ label: text, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-1.5 text-[12.5px] text-[var(--ink3)] [&_select]:max-w-[190px] [&_select]:cursor-pointer [&_select]:bg-transparent [&_select]:text-[var(--accent-ink)] [&_select]:outline-none">
      {text && <span>{text}</span>}
      {children}
    </label>
  );
}

function GraphCanvas({ nodes, edges, positions, selectedId, onSelect }: { nodes: GraphNode[]; edges: GraphEdge[]; positions: Map<string, { x: number; y: number }>; selectedId: string | null; onSelect: (id: string) => void }) {
  const byId = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes]);
  return (
    <div className="relative min-h-[420px] flex-1 overflow-hidden bg-[radial-gradient(circle_at_center,color-mix(in_srgb,var(--accent)_8%,transparent),transparent_65%)]" data-testid="graph-canvas">
      <svg className="absolute inset-0 h-full w-full" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden>
        {edges.map((e, i) => {
          const a = positions.get(e.from);
          const b = positions.get(e.to);
          if (!a || !b) return null;
          const colour = e.kind === "SUGGESTED" ? COLORS.amber : EDGE_HEX[byId.get(e.from)?.type === "STREAM" ? (byId.get(e.to)?.type ?? "STREAM") : (byId.get(e.from)?.type ?? "STREAM")];
          return <line key={i} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={colour} strokeOpacity={e.kind === "SUGGESTED" ? 0.9 : 0.55} strokeWidth={1.5} strokeDasharray={e.kind === "SUGGESTED" ? "6 5" : undefined} vectorEffect="non-scaling-stroke" data-edge={e.kind} />;
        })}
      </svg>
      {nodes.map((n) => {
        const at = positions.get(n.id);
        if (!at) return null;
        const Icon = ICON[n.type];
        const hex = TONE_HEX[n.tone];
        const active = selectedId === n.id;
        const center = n.type === "STREAM";
        return (
          <button
            key={n.id}
            type="button"
            onClick={() => onSelect(n.id)}
            aria-pressed={active}
            aria-label={`${n.title}, ${n.subtitle}`}
            data-node={n.type}
            className={`absolute flex -translate-x-1/2 -translate-y-1/2 items-center gap-2.5 rounded-xl border bg-[var(--surface)] px-2.5 py-2 text-left shadow-[var(--sh2)] transition ${center ? "w-[210px] border-[var(--accent)] ring-2 ring-[var(--accent)]/50" : "w-[172px]"} ${active && !center ? "border-[var(--accent)] ring-2 ring-[var(--accent)]/40" : center ? "" : "border-[var(--border)] hover:border-[var(--accent)]"}`}
            style={{ left: `${at.x}%`, top: `${at.y}%`, zIndex: active || center ? 3 : 2 }}
          >
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border" style={pill(hex)} aria-hidden>
              <Icon className="h-4 w-4" />
            </span>
            <span className="min-w-0">
              <span className="block truncate text-[12.5px] font-semibold text-[var(--ink)]">{n.title}</span>
              <span className="block truncate text-[10.5px] text-[var(--ink3)]">{n.subtitle}</span>
            </span>
          </button>
        );
      })}
    </div>
  );
}

function NodePanel({ node, onReview }: { node: GraphNode; onReview: () => void }) {
  const router = useRouter();
  const Icon = ICON[node.type];
  const d = node.detail;
  const sourceKind = node.type === "EMAIL" || node.type === "MEETING" || node.type === "DOCUMENT" || node.type === "NOTE";
  return (
    <aside aria-label="Selected object" className="flex min-h-0 flex-col overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--surface)]" data-testid="node-panel">
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="p-4">
          <p className="text-[10.5px] font-bold uppercase tracking-[0.14em] text-[var(--ink3)]">{d.eyebrow}</p>
          <div className="mt-3 flex items-center gap-3">
            <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border" style={pill(TONE_HEX[node.tone])} aria-hidden>
              <Icon className="h-5 w-5" />
            </span>
            <div className="min-w-0">
              <h2 className="text-[17px] font-bold leading-snug text-[var(--ink)]" data-testid="node-title">
                {node.title}
              </h2>
              <p className="text-[12px] text-[var(--ink3)]">{node.subtitle}</p>
            </div>
          </div>
          <div className="mt-3 flex flex-wrap gap-1.5">
            {d.pills.map((p) => (
              <Pill key={p} hex={p === "Evidence linked" ? COLORS.green : p === "Restricted source" || p === "Unconfirmed" ? COLORS.amber : COLORS.blue}>
                {p}
              </Pill>
            ))}
          </div>
        </div>
        <div className="border-t border-[var(--border)] p-4">
          {d.description && <p className="mb-3 whitespace-pre-wrap text-[12.5px] leading-relaxed text-[var(--ink2)]">{d.description}</p>}
          <dl className="divide-y divide-[var(--border)] text-[12.5px]">
            {d.rows.map(([term, value]) => (
              <div key={term} className="flex items-start justify-between gap-3 py-2">
                <dt className="text-[var(--ink3)]">{term}</dt>
                <dd className="text-right text-[var(--ink)]">{value || "—"}</dd>
              </div>
            ))}
          </dl>
          {!sourceKind && (
            <div className="mt-3">
              <p className="mb-2 text-[12px] font-semibold text-[var(--ink)]">Evidence and provenance</p>
              <EvidenceList items={d.evidence} empty="No source is linked to this yet." />
            </div>
          )}
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2 border-t border-[var(--border)] p-3">
        <button type="button" className="zoiko-btn pri justify-center" disabled={!d.sourcePath} title={d.sourcePath ? undefined : "No source you can open is linked"} onClick={() => d.sourcePath && router.push(d.sourcePath)}>
          {d.sourceLabel}
        </button>
        <button type="button" className="zoiko-btn justify-center" onClick={onReview}>
          Review links
        </button>
      </div>
    </aside>
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

function Line({ icon: Icon, text, meta, hot, onClick }: { icon: LucideIcon; text: string; meta: string; hot?: boolean; onClick?: () => void }) {
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

/** What this object is connected to, and how to cut a link — with the original source left untouched. */
function ReviewLinksDialog({ node, stream, onClose, onEditStream }: { node: GraphNode; stream: Stream; onClose: () => void; onEditStream: () => void }) {
  const router = useRouter();
  const removeEvidence = useRemoveEvidence();
  const updateCommitment = useUpdateCommitment();
  const updateDecision = useUpdateDecision();
  const updateDependency = useUpdateDependency();
  const [done, setDone] = useState<string | null>(null);
  const [kind, id] = node.id.split(":") as [string, string];
  const failure = (removeEvidence.error ?? updateCommitment.error ?? updateDecision.error ?? updateDependency.error) as Error | null;
  const detach = (message: string) => ({ onSuccess: () => setDone(message) });
  const itemInStream = kind === "COMMITMENT" || kind === "DECISION" || kind === "DELIVERABLE";
  const sourceKind = kind === "EMAIL" || kind === "MEETING" || kind === "DOCUMENT" || kind === "NOTE";

  return (
    <Modal open size="md" onClose={onClose} title="Review links" footer={<button type="button" className="zoiko-btn pri" onClick={onClose}>Done</button>}>
      <div className="flex flex-col gap-4">
        <div>
          <p className="text-[14px] font-semibold text-[var(--ink)]">{node.title}</p>
          <p className="text-[12px] text-[var(--ink3)]">{node.subtitle} · in {stream.title}</p>
        </div>

        {itemInStream && (
          <div className="space-y-2">
            <button
              type="button"
              className="zoiko-btn"
              disabled={updateCommitment.isPending || updateDecision.isPending || updateDependency.isPending}
              onClick={() => {
                if (kind === "COMMITMENT") updateCommitment.mutate({ id, input: { streamId: null } }, detach("Removed from the workstream."));
                else if (kind === "DECISION") updateDecision.mutate({ id, input: { streamId: null } }, detach("Removed from the workstream."));
                else updateDependency.mutate({ id, input: { streamId: null } }, detach("Removed from the workstream."));
              }}
            >
              <Trash2 className="h-4 w-4" aria-hidden /> Remove from this workstream
            </button>
            <p className="text-[11.5px] text-[var(--ink3)]">The record itself, and its sources, are kept — it just stops appearing on this map.</p>
            <button type="button" className="text-[12.5px] font-medium text-[var(--accent-ink)] hover:underline" onClick={() => router.push(node.detail.reviewPath ?? "/mail/work-graph")}>
              Open it to edit →
            </button>
          </div>
        )}

        {sourceKind && (
          <div className="space-y-2">
            <button type="button" className="zoiko-btn" disabled={removeEvidence.isPending} onClick={() => removeEvidence.mutate(id, detach("Link removed. The original source is untouched."))}>
              <Trash2 className="h-4 w-4" aria-hidden /> Remove this link
            </button>
            <p className="text-[11.5px] text-[var(--ink3)]">Only the link goes. The email, meeting or document is not changed.</p>
          </div>
        )}

        {kind === "OWNER" && (
          <button type="button" className="zoiko-btn" disabled={!stream.canEdit} onClick={onEditStream}>
            <Pencil className="h-4 w-4" aria-hidden /> Change the accountable owner
          </button>
        )}

        {kind === "SUGGESTION" && (
          <button type="button" className="zoiko-btn pri" onClick={() => router.push("/mail/work-graph/commitments?tab=suggested")}>
            Review the suggestion
          </button>
        )}

        {(kind === "STREAM" || itemInStream) && node.detail.evidence.length > 0 && (
          <div>
            <p className="mb-2 text-[12px] font-semibold text-[var(--ink)]">Sources linked to it</p>
            <EvidenceList items={node.detail.evidence} onRemove={(item) => removeEvidence.mutate(item.id, detach("Link removed. The original source is untouched."))} />
          </div>
        )}
        {kind === "STREAM" && (
          <button type="button" className="zoiko-btn" disabled={!stream.canEdit} onClick={onEditStream}>
            <Pencil className="h-4 w-4" aria-hidden /> Edit workstream
          </button>
        )}
        {done && <p role="status" className="text-[12.5px] text-[#22B07D]">{done}</p>}
        {failure && <p role="alert" className="text-[12.5px] text-[var(--crit)]">{failure.message}</p>}
      </div>
    </Modal>
  );
}
