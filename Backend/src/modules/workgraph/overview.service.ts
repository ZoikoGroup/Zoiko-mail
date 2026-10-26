import type { Prisma } from "@prisma/client";
import { prisma } from "../../config/prisma.js";
import { stateOf } from "./dependency.service.js";
import { displayStatus } from "./commitment.service.js";
import { pendingSuggestions } from "./suggestion.query.js";
import { streamService, streamViews } from "./stream.service.js";
import { evidenceViews, memberSelect, ownerView, visibleWhere, type EvidenceView, type WorkContext } from "./workgraph.shared.js";
import type { OverviewInput } from "./workgraph.schema.js";

/**
 * The connected-work map for one workstream: the stream in the middle, its
 * accountable owner, the commitments and decisions inside it, the
 * deliverables that are blocked, and the mail and meetings that evidence
 * them. Every line on it is a real record; suggestions Alet found are shown
 * only if asked for, drawn dashed, and are not links until confirmed.
 */

export type NodeType = "STREAM" | "OWNER" | "COMMITMENT" | "DECISION" | "DELIVERABLE" | "EMAIL" | "MEETING" | "DOCUMENT" | "NOTE" | "SUGGESTION";

export interface GraphNode {
  id: string;
  type: NodeType;
  title: string;
  subtitle: string;
  /** How it looks: ok (done/approved), warn (waiting), crit (late/blocked), info. */
  tone: "ok" | "warn" | "crit" | "info";
  detail: {
    eyebrow: string;
    description: string | null;
    pills: string[];
    rows: Array<[string, string]>;
    evidence: EvidenceView[];
    sourcePath: string | null;
    sourceLabel: string;
    reviewPath: string | null;
  };
}

export interface GraphEdge {
  from: string;
  to: string;
  kind: "CONFIRMED" | "SUGGESTED";
}

const MAX_ITEMS = 8;
const MAX_SOURCES = 4;

function day(date: Date | null, zone: string): string {
  if (!date) return "Not set";
  try {
    return new Intl.DateTimeFormat("en-GB", { timeZone: zone, day: "numeric", month: "short", year: "numeric" }).format(date);
  } catch {
    return date.toISOString().slice(0, 10);
  }
}
function short(date: Date | null, zone: string): string {
  if (!date) return "";
  try {
    return new Intl.DateTimeFormat("en-GB", { timeZone: zone, day: "numeric", month: "short" }).format(date);
  } catch {
    return date.toISOString().slice(5, 10);
  }
}

const SOURCE_TYPE = { EMAIL: "EMAIL", MEETING: "MEETING", DOCUMENT: "DOCUMENT", NOTE: "NOTE" } as const;
const SOURCE_LABEL = { EMAIL: "Email thread", MEETING: "Meeting", DOCUMENT: "Document", NOTE: "Note" } as const;

export class OverviewService {
  async build(input: OverviewInput, context: WorkContext) {
    const streams = await streamService.list(context);
    const suggestionsAll = await pendingSuggestions(context);
    const empty = { streams: streams.map((s) => ({ id: s.id, title: s.title })), stream: null, nodes: [] as GraphNode[], edges: [] as GraphEdge[], hidden: 0, attention: await this.attention(context), suggestions: suggestionsAll.length };
    if (streams.length === 0) return empty;

    const chosen = streams.find((s) => s.id === input.streamId) ?? streams[0]!;
    const row = await prisma.workStream.findFirst({ where: { id: chosen.id, ...visibleWhere(context) }, include: { owner: { select: memberSelect }, _count: { select: { commitments: true, decisions: true, dependencies: true } } } });
    if (!row) return empty;
    const [stream] = await streamViews([row], context);
    const zone = row.timeZone;

    const since = input.days > 0 ? new Date(Date.now() - input.days * 86_400_000) : null;
    const mineOnly = input.scope === "owned";
    const q = input.q ? { contains: input.q, mode: "insensitive" as const } : null;

    const [commitments, decisions, dependencies] = await Promise.all([
      prisma.workCommitment.findMany({
        where: {
          ...visibleWhere(context),
          streamId: row.id,
          status: { not: "CANCELLED" },
          ...(mineOnly ? { ownerMembershipId: context.membershipId } : {}),
          ...(q ? { title: q } : {}),
          ...(since ? { AND: [{ OR: [{ status: { in: ["AWAITING", "IN_PROGRESS"] } }, { recordedAt: { gte: since } }] }] } : {}),
        } as Prisma.WorkCommitmentWhereInput,
        include: { owner: { select: memberSelect } },
        take: 50,
      }),
      prisma.workDecision.findMany({
        where: {
          ...visibleWhere(context, [{ approverMembershipId: context.membershipId }]),
          streamId: row.id,
          ...(mineOnly ? { ownerMembershipId: context.membershipId } : {}),
          ...(q ? { title: q } : {}),
          ...(since ? { AND: [{ OR: [{ status: "PENDING" }, { decidedAt: { gte: since } }, { createdAt: { gte: since } }] }] } : {}),
        } as Prisma.WorkDecisionWhereInput,
        include: { owner: { select: memberSelect } },
        take: 50,
      }),
      prisma.workDependency.findMany({
        where: {
          ...visibleWhere(context),
          streamId: row.id,
          ...(q ? { deliverable: q } : {}),
          ...(since ? { OR: [{ resolvedAt: null }, { resolvedAt: { gte: since } }] } : {}),
        } as Prisma.WorkDependencyWhereInput,
        include: {
          owner: { select: memberSelect },
          blockerDecision: { select: { id: true, title: true, status: true } },
          blockerCommitment: { select: { id: true, title: true, status: true, dueAt: true } },
        },
        take: 50,
      }),
    ]);

    // What needs a look comes first, so the map keeps it when it has to leave things out.
    const rank = {
      commitment: (c: (typeof commitments)[number]) => ({ PAST_DUE: 0, AWAITING: 1, IN_PROGRESS: 2, RECORDED: 3, CANCELLED: 4 })[displayStatus(c)],
      decision: (d: (typeof decisions)[number]) => ({ PENDING: 0, DEFERRED: 1, APPROVED: 2, SUPERSEDED: 3 })[d.status],
      dependency: (d: (typeof dependencies)[number]) => ({ BLOCKED: 0, WAITING: 1, UNBLOCKED: 2 })[stateOf(d as never)],
    };
    commitments.sort((a, b) => rank.commitment(a) - rank.commitment(b));
    decisions.sort((a, b) => rank.decision(a) - rank.decision(b));
    dependencies.sort((a, b) => rank.dependency(a) - rank.dependency(b));

    const picks = [
      ...commitments.map((c) => ({ kind: "COMMITMENT" as const, order: rank.commitment(c), row: c })),
      ...decisions.map((d) => ({ kind: "DECISION" as const, order: rank.decision(d), row: d })),
      ...dependencies.map((d) => ({ kind: "DELIVERABLE" as const, order: rank.dependency(d), row: d })),
    ].sort((a, b) => a.order - b.order);
    const shown = picks.slice(0, MAX_ITEMS);
    const hidden = picks.length - shown.length;

    const shownIds = (kind: string) => shown.filter((p) => p.kind === kind).map((p) => p.row.id);
    const [streamEvidence, commitmentEvidence, decisionEvidence] = await Promise.all([
      evidenceViews("STREAM", [row.id], context),
      evidenceViews("COMMITMENT", shownIds("COMMITMENT"), context),
      evidenceViews("DECISION", shownIds("DECISION"), context),
    ]);

    const nodes: GraphNode[] = [];
    const edges: GraphEdge[] = [];
    const streamNodeId = `STREAM:${row.id}`;
    const connections = { n: 0 };

    // The stream itself.
    const streamSources = streamEvidence.get(row.id) ?? [];
    nodes.push({
      id: streamNodeId,
      type: "STREAM",
      title: row.title,
      subtitle: `Workstream · ${row.status === "ACTIVE" ? "Active" : "Archived"}`,
      tone: "info",
      detail: {
        eyebrow: "Selected object",
        description: row.description,
        pills: ["Scoped to your access", ...(streamSources.length ? ["Evidence linked"] : [])],
        rows: [
          ["Accountable owner", stream!.owner.name],
          ["Next checkpoint", day(row.nextCheckpointAt, zone)],
          ["Confirmed connections", ""], // filled in below
        ],
        evidence: streamSources,
        sourcePath: streamSources.find((s) => s.openPath)?.openPath ?? null,
        sourceLabel: "View source",
        reviewPath: "/mail/work-graph/commitments",
      },
    });

    // The accountable owner.
    if (stream!.owner.kind !== "NONE") {
      const ownerId = `OWNER:${row.ownerMembershipId ?? row.ownerLabel}`;
      nodes.push({
        id: ownerId,
        type: "OWNER",
        title: stream!.owner.name,
        subtitle: "Accountable owner",
        tone: "ok",
        detail: { eyebrow: "Selected object", description: null, pills: ["Scoped to your access"], rows: [["Role", "Accountable owner"], ["Workstream", row.title]], evidence: [], sourcePath: null, sourceLabel: "View source", reviewPath: null },
      });
      edges.push({ from: ownerId, to: streamNodeId, kind: "CONFIRMED" });
      connections.n += 1;
    }

    const sourceNodes: GraphNode[] = [];
    const addSources = (subjectNodeId: string, sources: EvidenceView[]) => {
      for (const s of sources) {
        const id = `${s.kind}:${s.id}`;
        if (sourceNodes.length < MAX_SOURCES) {
          sourceNodes.push({
            id,
            type: SOURCE_TYPE[s.kind],
            title: s.label,
            subtitle: `${SOURCE_LABEL[s.kind]}${s.occurredAt ? ` · ${short(s.occurredAt, zone)}` : ""}`,
            tone: "info",
            detail: {
              eyebrow: "Selected object",
              description: null,
              pills: ["Scoped to your access", s.canOpen ? "Evidence linked" : "Restricted source"],
              rows: [["Kind", SOURCE_LABEL[s.kind]], ["Date", day(s.occurredAt, zone)]],
              evidence: [],
              sourcePath: s.openPath,
              sourceLabel: "View source",
              reviewPath: null,
            },
          });
        }
        if (sourceNodes.some((n) => n.id === id)) {
          edges.push({ from: id, to: subjectNodeId, kind: "CONFIRMED" });
          connections.n += 1;
        }
      }
    };

    for (const pick of shown) {
      if (pick.kind === "COMMITMENT") {
        const c = pick.row as (typeof commitments)[number];
        const display = displayStatus(c);
        const owner = ownerView(c.owner, c.ownerLabel, context);
        const sources = commitmentEvidence.get(c.id) ?? [];
        const id = `COMMITMENT:${c.id}`;
        nodes.push({
          id,
          type: "COMMITMENT",
          title: c.title,
          subtitle: `Commitment · ${display === "PAST_DUE" ? "Past due" : display === "AWAITING" ? "Awaited" : display === "RECORDED" ? "Recorded" : "In progress"}`,
          tone: display === "PAST_DUE" ? "crit" : display === "RECORDED" ? "ok" : "warn",
          detail: {
            eyebrow: "Selected object",
            description: c.description,
            pills: ["Scoped to your access", ...(sources.length ? ["Evidence linked"] : [])],
            rows: [["Accountable owner", owner.name], ["Due", c.dueAt ? day(c.dueAt, c.timeZone) : "Not set"], ["Status", display === "PAST_DUE" ? "Past due" : display.charAt(0) + display.slice(1).toLowerCase().replace("_", " ")]],
            evidence: sources,
            sourcePath: sources.find((s) => s.openPath)?.openPath ?? null,
            sourceLabel: "View source",
            reviewPath: `/mail/work-graph/commitments?id=${c.id}`,
          },
        });
        edges.push({ from: streamNodeId, to: id, kind: "CONFIRMED" });
        connections.n += 1;
        addSources(id, sources);
      } else if (pick.kind === "DECISION") {
        const d = pick.row as (typeof decisions)[number];
        const owner = ownerView(d.owner, d.ownerLabel, context);
        const sources = decisionEvidence.get(d.id) ?? [];
        const id = `DECISION:${d.id}`;
        nodes.push({
          id,
          type: "DECISION",
          title: d.title,
          subtitle: `Decision · ${d.status === "PENDING" ? "Pending" : d.status === "APPROVED" ? "Recorded" : d.status === "DEFERRED" ? "Deferred" : "Superseded"}`,
          tone: d.status === "APPROVED" ? "ok" : d.status === "PENDING" ? "warn" : "info",
          detail: {
            eyebrow: "Selected object",
            description: d.rationale,
            pills: ["Scoped to your access", ...(sources.length ? ["Evidence linked"] : [])],
            rows: [["Decision owner", owner.name], ["Review", d.reviewAt ? day(d.reviewAt, d.timeZone) : "Not set"], ["Status", d.status.charAt(0) + d.status.slice(1).toLowerCase()]],
            evidence: sources,
            sourcePath: sources.find((s) => s.openPath)?.openPath ?? null,
            sourceLabel: "View source",
            reviewPath: `/mail/work-graph/decisions?id=${d.id}`,
          },
        });
        edges.push({ from: streamNodeId, to: id, kind: "CONFIRMED" });
        connections.n += 1;
        addSources(id, sources);
      } else {
        const dep = pick.row as (typeof dependencies)[number];
        const state = stateOf(dep as never);
        const owner = ownerView(dep.owner, dep.ownerLabel, context);
        const blocker = dep.blockerDecision ?? dep.blockerCommitment;
        const id = `DELIVERABLE:${dep.id}`;
        nodes.push({
          id,
          type: "DELIVERABLE",
          title: dep.deliverable,
          subtitle: `Deliverable · ${state === "UNBLOCKED" ? "Unblocked" : state === "WAITING" ? "Waiting" : "Blocked"}`,
          tone: state === "BLOCKED" ? "crit" : state === "UNBLOCKED" ? "ok" : "warn",
          detail: {
            eyebrow: "Selected object",
            description: dep.description,
            pills: ["Scoped to your access"],
            rows: [["Owner", owner.name], ["Waiting on", blocker?.title ?? "Removed item"], ["Status", state === "UNBLOCKED" ? "Unblocked" : state === "WAITING" ? "Waiting" : "Blocked"]],
            evidence: [],
            sourcePath: null,
            sourceLabel: "View source",
            reviewPath: `/mail/work-graph/dependencies?id=${dep.id}`,
          },
        });
        edges.push({ from: streamNodeId, to: id, kind: "CONFIRMED" });
        connections.n += 1;
        // The line to what it waits on, when that is on the map too.
        const blockerNode = blocker ? `${dep.blockerType === "DECISION" ? "DECISION" : "COMMITMENT"}:${blocker.id}` : null;
        if (blockerNode && nodes.some((n) => n.id === blockerNode)) edges.push({ from: id, to: blockerNode, kind: "CONFIRMED" });
      }
    }
    // Sources of the stream itself.
    addSources(streamNodeId, streamSources);
    nodes.push(...sourceNodes);

    // Alet's suggestions: drawn only when asked, and only against a stream they relate to.
    if (input.links === "all") {
      const evidenceMessages = new Set<string>([...streamSources, ...[...commitmentEvidence.values()].flat(), ...[...decisionEvidence.values()].flat()].map((e) => e.refId).filter((r): r is string => Boolean(r)));
      for (const s of suggestionsAll) {
        if (!s.messageId || !evidenceMessages.has(s.messageId)) continue;
        const out = s.output && typeof s.output === "object" && !Array.isArray(s.output) ? (s.output as Record<string, unknown>) : {};
        const id = `SUGGESTION:${s.id}`;
        nodes.push({
          id,
          type: "SUGGESTION",
          title: String(out.text).trim(),
          subtitle: "Suggested · review required",
          tone: "info",
          detail: {
            eyebrow: "Suggested by Alet",
            description: s.sourceExcerpt,
            pills: ["Unconfirmed", "Review required"],
            rows: [["Status", "Not a commitment until you confirm it"]],
            evidence: [],
            sourcePath: null,
            sourceLabel: "View source",
            reviewPath: "/mail/work-graph/commitments?tab=suggested",
          },
        });
        edges.push({ from: id, to: streamNodeId, kind: "SUGGESTED" });
      }
    }

    // Connections count: filled now that the lines are known.
    nodes[0]!.detail.rows[2] = ["Confirmed connections", `${connections.n} evidence-backed link${connections.n === 1 ? "" : "s"}`];

    return { streams: empty.streams, stream, nodes, edges, hidden, attention: await this.attention(context), suggestions: suggestionsAll.length };
  }

  /** What needs a look across everything the caller can see, for the cards under the map. */
  private async attention(context: WorkContext) {
    const now = new Date();
    const [commitments, pendingDecisions] = await Promise.all([
      prisma.workCommitment.findMany({
        where: { ...visibleWhere(context), status: { in: ["AWAITING", "IN_PROGRESS"] }, OR: [{ status: "AWAITING" }, { dueAt: { lt: now } }] } as Prisma.WorkCommitmentWhereInput,
        orderBy: [{ dueAt: { sort: "asc", nulls: "last" } }],
        take: 3,
        select: { id: true, title: true, dueAt: true, timeZone: true, status: true },
      }),
      prisma.workDecision.count({ where: { ...visibleWhere(context, [{ approverMembershipId: context.membershipId }]), status: "PENDING" } as Prisma.WorkDecisionWhereInput }),
    ]);
    const suggestions = await pendingSuggestions(context);
    return {
      commitments: commitments.map((c) => ({ id: c.id, title: c.title, due: c.dueAt ? short(c.dueAt, c.timeZone) : "", pastDue: Boolean(c.dueAt && c.dueAt < now) })),
      suggestions: suggestions.slice(0, 3).map((s) => ({
        id: s.id,
        title: String((s.output as Record<string, unknown>).text).trim(),
        kind: s.actionType === "APPROVAL" ? "DECISION" : "COMMITMENT",
      })),
      pendingDecisions,
    };
  }
}

export const overviewService = new OverviewService();
