import { apiRequest } from "./api-client";

/**
 * The Work Graph: commitments, decisions, dependencies and the sources that
 * evidence them. Dates arrive as ISO strings; each item carries its own time
 * zone so a due time reads the way whoever set it meant it.
 */

export type WorkVisibility = "PRIVATE" | "WORKSPACE";

export interface OwnerView {
  kind: "MEMBER" | "TEAM" | "NONE";
  name: string;
  email: string | null;
  isMe: boolean;
}

export interface EvidenceView {
  id: string;
  kind: "EMAIL" | "MEETING" | "DOCUMENT" | "NOTE";
  label: string;
  occurredAt: string | null;
  refId: string | null;
  /** False when the viewer cannot open the source; its name is then withheld. */
  canOpen: boolean;
  openPath: string | null;
  addedByMe: boolean;
}

export type EvidenceInput = { kind: EvidenceView["kind"]; refId?: string; label?: string; occurredAt?: string };

// ── Commitments ─────────────────────────────────────────────────────────────

export type CommitmentStatus = "AWAITING" | "IN_PROGRESS" | "RECORDED" | "CANCELLED";
export type CommitmentDisplay = "AWAITING" | "PAST_DUE" | "IN_PROGRESS" | "RECORDED" | "CANCELLED";

export interface Commitment {
  id: string;
  title: string;
  description: string | null;
  stream: { id: string; title: string } | null;
  owner: OwnerView;
  expectedFrom: string | null;
  dueAt: string | null;
  timeZone: string;
  status: CommitmentStatus;
  display: CommitmentDisplay;
  visibility: WorkVisibility;
  recordedAt: string | null;
  fromSuggestion: boolean;
  createdBy: { name: string; email: string; isMe: boolean };
  isMine: boolean;
  canEdit: boolean;
  isCreator: boolean;
  blocking: { blocked: number; deliverables: string[] };
  evidence: EvidenceView[];
  createdAt: string;
  updatedAt: string;
}

export interface CommitmentSummary {
  confirmed: number;
  awaiting: number;
  pastDue: number;
  suggestions: number;
}

export interface CommitmentFilters {
  tab?: "all" | "mine" | "awaiting";
  scope?: "accessible" | "owned" | "created";
  q?: string;
  days?: number;
}

export interface CommitmentInput {
  title?: string;
  description?: string | null;
  streamId?: string | null;
  ownerEmail?: string;
  ownerLabel?: string | null;
  expectedFrom?: string | null;
  dueAt?: string | null;
  timeZone?: string;
  status?: CommitmentStatus;
  visibility?: WorkVisibility;
  evidence?: EvidenceInput[];
}

function query(params: Record<string, string | number | undefined>): string {
  const q = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) if (value !== undefined && value !== "") q.set(key, String(value));
  const text = q.toString();
  return text ? `?${text}` : "";
}

export function listCommitments(filters: CommitmentFilters = {}): Promise<{ items: Commitment[]; truncated?: boolean; summary: CommitmentSummary }> {
  return apiRequest(`/workgraph/commitments${query({ ...filters })}`);
}
export function createCommitment(input: CommitmentInput & { title: string }): Promise<Commitment> {
  return apiRequest("/workgraph/commitments", { method: "POST", body: input });
}
export function updateCommitment(id: string, input: Omit<CommitmentInput, "evidence">): Promise<Commitment> {
  return apiRequest(`/workgraph/commitments/${encodeURIComponent(id)}`, { method: "PATCH", body: input });
}
export async function deleteCommitment(id: string): Promise<void> {
  await apiRequest(`/workgraph/commitments/${encodeURIComponent(id)}`, { method: "DELETE" });
}

// ── Decisions ───────────────────────────────────────────────────────────────

export type DecisionStatus = "PENDING" | "APPROVED" | "DEFERRED" | "SUPERSEDED";

export interface Decision {
  id: string;
  title: string;
  rationale: string | null;
  stream: { id: string; title: string } | null;
  owner: OwnerView;
  approver: { name: string; email: string; isMe: boolean } | null;
  reviewAt: string | null;
  timeZone: string;
  status: DecisionStatus;
  decidedAt: string | null;
  decidedBy: string | null;
  decisionNote: string | null;
  supersededBy: { id: string; title: string } | null;
  visibility: WorkVisibility;
  fromSuggestion: boolean;
  createdBy: { name: string; email: string; isMe: boolean };
  /** Whether this person may give an outcome right now. */
  canDecide: boolean;
  /** Who can, in words. */
  authority: string;
  canEdit: boolean;
  isCreator: boolean;
  impact: { blocked: number; deliverables: string[] };
  evidence: EvidenceView[];
  createdAt: string;
  updatedAt: string;
}

export interface DecisionSummary {
  recorded: number;
  awaiting: number;
  blocked: number;
  suggestions: number;
}

export interface DecisionFilters {
  tab?: "all" | "awaiting" | "approved";
  scope?: "accessible" | "owned" | "created";
  q?: string;
  days?: number;
}

export interface DecisionInput {
  title?: string;
  rationale?: string | null;
  streamId?: string | null;
  ownerEmail?: string;
  ownerLabel?: string | null;
  approverEmail?: string | null;
  reviewAt?: string | null;
  timeZone?: string;
  visibility?: WorkVisibility;
  evidence?: EvidenceInput[];
}

export function listDecisions(filters: DecisionFilters = {}): Promise<{ items: Decision[]; truncated?: boolean; summary: DecisionSummary }> {
  return apiRequest(`/workgraph/decisions${query({ ...filters })}`);
}
export function createDecision(input: DecisionInput & { title: string }): Promise<Decision> {
  return apiRequest("/workgraph/decisions", { method: "POST", body: input });
}
export function updateDecision(id: string, input: Omit<DecisionInput, "evidence">): Promise<Decision> {
  return apiRequest(`/workgraph/decisions/${encodeURIComponent(id)}`, { method: "PATCH", body: input });
}
export function decide(id: string, input: { outcome: "APPROVED" | "DEFERRED" | "SUPERSEDED"; note?: string; supersededById?: string }): Promise<Decision> {
  return apiRequest(`/workgraph/decisions/${encodeURIComponent(id)}/decision`, { method: "POST", body: input });
}
export async function deleteDecision(id: string): Promise<void> {
  await apiRequest(`/workgraph/decisions/${encodeURIComponent(id)}`, { method: "DELETE" });
}

// ── Dependencies ────────────────────────────────────────────────────────────

export type DependencyState = "WAITING" | "BLOCKED" | "UNBLOCKED";

export interface Dependency {
  id: string;
  deliverable: string;
  description: string | null;
  owner: OwnerView;
  blocker: { type: "DECISION" | "COMMITMENT"; id: string | null; title: string; status: string | null };
  state: DependencyState;
  stateLabel: string;
  notified: boolean;
  resolvedAt: string | null;
  stream: { id: string; title: string } | null;
  visibility: WorkVisibility;
  isMine: boolean;
  canEdit: boolean;
  createdAt: string;
}

export interface DependencyInput {
  deliverable?: string;
  description?: string | null;
  ownerEmail?: string;
  ownerLabel?: string | null;
  streamId?: string | null;
  visibility?: WorkVisibility;
}

export function listDependencies(state: "open" | "all" = "all", q = ""): Promise<Dependency[]> {
  return apiRequest(`/workgraph/dependencies${query({ state, q })}`);
}
export function createDependency(input: DependencyInput & { deliverable: string; blockerType: "DECISION" | "COMMITMENT"; blockerId: string }): Promise<Dependency> {
  return apiRequest("/workgraph/dependencies", { method: "POST", body: input });
}
export function updateDependency(id: string, input: DependencyInput & { resolved?: boolean }): Promise<Dependency> {
  return apiRequest(`/workgraph/dependencies/${encodeURIComponent(id)}`, { method: "PATCH", body: input });
}
export async function deleteDependency(id: string): Promise<void> {
  await apiRequest(`/workgraph/dependencies/${encodeURIComponent(id)}`, { method: "DELETE" });
}

// ── Workstreams and the overview ────────────────────────────────────────────

export interface Stream {
  id: string;
  title: string;
  description: string | null;
  owner: OwnerView;
  nextCheckpointAt: string | null;
  timeZone: string;
  status: "ACTIVE" | "ARCHIVED";
  visibility: WorkVisibility;
  counts: { commitments: number; decisions: number; dependencies: number };
  canEdit: boolean;
  isCreator: boolean;
  evidence: EvidenceView[];
}

export interface StreamInput {
  title?: string;
  description?: string | null;
  ownerEmail?: string;
  ownerLabel?: string | null;
  nextCheckpointAt?: string | null;
  timeZone?: string;
  visibility?: WorkVisibility;
  status?: "ACTIVE" | "ARCHIVED";
}

export function listStreams(): Promise<Stream[]> {
  return apiRequest("/workgraph/streams");
}
export function createStream(input: StreamInput & { title: string }): Promise<Stream> {
  return apiRequest("/workgraph/streams", { method: "POST", body: input });
}
export function updateStream(id: string, input: StreamInput): Promise<Stream> {
  return apiRequest(`/workgraph/streams/${encodeURIComponent(id)}`, { method: "PATCH", body: input });
}
export async function deleteStream(id: string): Promise<void> {
  await apiRequest(`/workgraph/streams/${encodeURIComponent(id)}`, { method: "DELETE" });
}

export type NodeType = "STREAM" | "OWNER" | "COMMITMENT" | "DECISION" | "DELIVERABLE" | "EMAIL" | "MEETING" | "DOCUMENT" | "NOTE" | "SUGGESTION";

export interface GraphNode {
  id: string;
  type: NodeType;
  title: string;
  subtitle: string;
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

export interface Overview {
  streams: Array<{ id: string; title: string }>;
  stream: Stream | null;
  nodes: GraphNode[];
  edges: GraphEdge[];
  hidden: number;
  attention: {
    commitments: Array<{ id: string; title: string; due: string; pastDue: boolean }>;
    suggestions: Array<{ id: string; title: string; kind: "COMMITMENT" | "DECISION" }>;
    pendingDecisions: number;
  };
  suggestions: number;
}

export interface OverviewFilters {
  streamId?: string;
  scope?: "accessible" | "owned";
  links?: "confirmed" | "all";
  days?: number;
  q?: string;
}

export function getOverview(filters: OverviewFilters = {}): Promise<Overview> {
  return apiRequest(`/workgraph/overview${query({ ...filters })}`);
}

// ── Sources and suggestions ─────────────────────────────────────────────────

export function addEvidence(input: { subjectType: "STREAM" | "COMMITMENT" | "DECISION"; subjectId: string; evidence: EvidenceInput }): Promise<EvidenceView[]> {
  return apiRequest("/workgraph/evidence", { method: "POST", body: input });
}
export async function removeEvidence(id: string): Promise<void> {
  await apiRequest(`/workgraph/evidence/${encodeURIComponent(id)}`, { method: "DELETE" });
}

export interface Suggestion {
  id: string;
  kind: "COMMITMENT" | "DECISION";
  actionType: string;
  title: string;
  dueAt: string | null;
  priority: string | null;
  excerpt: string | null;
  confidence: number | null;
  source: { messageId: string; subject: string; openPath: string } | null;
  createdAt: string;
}

export function listSuggestions(kind?: "COMMITMENT" | "DECISION"): Promise<Suggestion[]> {
  return apiRequest(`/workgraph/suggestions${query({ kind })}`);
}
export function confirmSuggestion(id: string, input: { title?: string; dueAt?: string | null; streamId?: string | null; ownerEmail?: string; ownerLabel?: string | null; visibility?: WorkVisibility } = {}): Promise<{ kind: "COMMITMENT" | "DECISION"; item: Commitment | Decision }> {
  return apiRequest(`/workgraph/suggestions/${encodeURIComponent(id)}/confirm`, { method: "POST", body: input });
}
export async function dismissSuggestion(id: string): Promise<void> {
  await apiRequest(`/workgraph/suggestions/${encodeURIComponent(id)}/dismiss`, { method: "POST" });
}

export function searchPeople(q: string): Promise<Array<{ email: string; name: string }>> {
  return apiRequest(`/workgraph/people${query({ q })}`);
}
