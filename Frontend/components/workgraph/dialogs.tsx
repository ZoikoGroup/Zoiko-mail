"use client";

import { useMemo, useState } from "react";
import { Link2, Link as LinkIcon, ShieldCheck, Waypoints } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import type { Commitment, CommitmentStatus, Decision, Dependency, EvidenceInput, EvidenceView, Stream } from "@/lib/workgraph-api";
import {
  useAddEvidence,
  useCommitments,
  useCreateCommitment,
  useCreateDecision,
  useCreateDependency,
  useCreateStream,
  useDecide,
  useDecisions,
  useRemoveEvidence,
  useStreams,
  useUpdateCommitment,
  useUpdateDecision,
  useUpdateDependency,
  useUpdateStream,
} from "@/lib/workgraph-hooks";
import {
  DueFields,
  EvidenceList,
  OwnerField,
  VisibilityField,
  dueFromIso,
  dueToIso,
  emptyDue,
  label,
  ownerFromView,
  ownerPayload,
  problemText,
  type DueValue,
  type OwnerValue,
} from "./shared";
import { SourcePicker, type PickedSource } from "./SourcePicker";

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function ErrorLine({ error }: { error: unknown }) {
  if (!error) return null;
  return (
    <p role="alert" className="text-[12.5px] text-[var(--crit)]">
      {(error as Error).message}
    </p>
  );
}

function StreamSelect({ id, value, onChange, current }: { id: string; value: string; onChange: (next: string) => void; current?: { id: string; title: string } | null }) {
  const streams = useStreams();
  // An item may sit in a workstream that has since been archived; keep showing it.
  const archived = current && !(streams.data ?? []).some((s) => s.id === current.id) ? current : null;
  return (
    <div>
      <label htmlFor={id} className={label}>
        Workstream
      </label>
      <select id={id} className="zoiko-input w-full" value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">None</option>
        {archived && <option value={archived.id}>{archived.title} (archived)</option>}
        {(streams.data ?? []).map((s) => (
          <option key={s.id} value={s.id}>
            {s.title}
          </option>
        ))}
      </select>
    </div>
  );
}

/**
 * The sources of an item being edited: those already attached (removable on
 * the spot) and a picker to add more. When creating, picks are held and sent
 * with the item.
 */
function SourcesField({
  subject,
  existing,
  pending,
  onPending,
}: {
  subject?: { type: "COMMITMENT" | "DECISION" | "STREAM"; id: string };
  existing: EvidenceView[];
  pending: PickedSource[];
  onPending: (next: PickedSource[]) => void;
}) {
  const add = useAddEvidence();
  const remove = useRemoveEvidence();
  const [live, setLive] = useState(existing);
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="space-y-2">
      <p className={label}>Sources</p>
      {subject && <EvidenceList items={live} onRemove={(item) => remove.mutate(item.id, { onSuccess: () => setLive((l) => l.filter((x) => x.id !== item.id)) })} />}
      {pending.length > 0 && (
        <ul className="space-y-1" data-testid="pending-sources">
          {pending.map((p, i) => (
            <li key={i} className="flex items-center justify-between rounded-lg border border-[var(--border)] bg-[var(--s2)] px-2.5 py-1.5 text-[12.5px] text-[var(--ink)]">
              <span className="truncate">
                {p.input.kind === "EMAIL" ? "Email" : p.input.kind === "MEETING" ? "Meeting" : p.input.kind === "DOCUMENT" ? "Document" : "Note"}: {p.name}
              </span>
              <button type="button" className="text-[11.5px] text-[var(--ink3)] hover:text-[var(--crit)]" onClick={() => onPending(pending.filter((_, j) => j !== i))}>
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}
      <SourcePicker
        chosen={pending}
        onPick={(source) => {
          setError(null);
          if (!subject) return onPending([...pending, source]);
          add.mutate(
            { subjectType: subject.type, subjectId: subject.id, evidence: source.input },
            { onSuccess: (items) => setLive(items), onError: (e) => setError((e as Error).message) }
          );
        }}
      />
      {error && <p role="alert" className="text-[12px] text-[var(--crit)]">{error}</p>}
    </div>
  );
}

const evidenceOf = (pending: PickedSource[]): EvidenceInput[] => pending.map((p) => p.input);

// ── Commitment ──────────────────────────────────────────────────────────────

export function CommitmentDialog({
  commitment,
  seed,
  onClose,
  onSaved,
}: {
  commitment?: Commitment | null;
  seed?: { title?: string; streamId?: string; sources?: PickedSource[] };
  onClose: () => void;
  onSaved?: (saved: Commitment) => void;
}) {
  const create = useCreateCommitment();
  const update = useUpdateCommitment();
  const [title, setTitle] = useState(commitment?.title ?? seed?.title ?? "");
  const [description, setDescription] = useState(commitment?.description ?? "");
  const [streamId, setStreamId] = useState(commitment?.stream?.id ?? seed?.streamId ?? "");
  const [owner, setOwner] = useState<OwnerValue>(commitment ? ownerFromView(commitment.owner) : { text: "" });
  const [expectedFrom, setExpectedFrom] = useState(commitment?.expectedFrom ?? "");
  const [due, setDue] = useState<DueValue>(commitment?.dueAt ? dueFromIso(commitment.dueAt, commitment.timeZone) : emptyDue());
  const [status, setStatus] = useState<CommitmentStatus | "">(commitment?.status ?? "");
  const [visibility, setVisibility] = useState<"PRIVATE" | "WORKSPACE">(commitment?.visibility ?? "PRIVATE");
  const [pending, setPending] = useState<PickedSource[]>(seed?.sources ?? []);
  const [touched, setTouched] = useState(false);
  const busy = create.isPending || update.isPending;
  const problem = title.trim() ? null : "Give the commitment a title.";

  const submit = () => {
    setTouched(true);
    if (problem || busy) return;
    const dueIso = dueToIso(due);
    const common = {
      title: title.trim(),
      description: description.trim() || null,
      streamId: streamId || null,
      ...ownerPayload(owner),
      expectedFrom: expectedFrom.trim() || null,
      dueAt: dueIso,
      ...(dueIso ? { timeZone: due.zone } : {}),
      visibility,
    };
    if (commitment) {
      update.mutate(
        { id: commitment.id, input: { ...common, ...(status ? { status } : {}) } },
        { onSuccess: (saved) => { onSaved?.(saved); onClose(); } }
      );
    } else {
      create.mutate(
        { ...common, ...(status ? { status } : {}), ...(pending.length ? { evidence: evidenceOf(pending) } : {}) },
        { onSuccess: (saved) => { onSaved?.(saved); onClose(); } }
      );
    }
  };

  return (
    <Modal
      open
      size="lg"
      onClose={busy ? () => undefined : onClose}
      title={commitment ? "Edit commitment" : "New commitment"}
      footer={
        <>
          <button type="button" className="zoiko-btn" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button type="button" className="zoiko-btn pri" onClick={submit} disabled={busy}>
            {busy ? "Saving…" : commitment ? "Save changes" : "Create commitment"}
          </button>
        </>
      }
    >
      <form noValidate className="flex flex-col gap-4" onSubmit={(e) => { e.preventDefault(); submit(); }}>
        <div>
          <label htmlFor="cm-title" className={label}>
            What was promised
          </label>
          <input id="cm-title" className="zoiko-input w-full" autoFocus value={title} placeholder="e.g. Partner launch confirmation" onChange={(e) => setTitle(e.target.value)} aria-invalid={touched && Boolean(problem)} />
          {touched && problem && <p className={problemText}>{problem}</p>}
        </div>
        <div>
          <label htmlFor="cm-desc" className={label}>
            Details
          </label>
          <textarea id="cm-desc" className="zoiko-input min-h-[70px] w-full" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="What exactly is expected, and from whom?" />
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label htmlFor="cm-owner" className={label}>
              Accountable owner
            </label>
            <OwnerField id="cm-owner" value={owner} onChange={setOwner} />
          </div>
          <div>
            <label htmlFor="cm-expected" className={label}>
              Expected from (if someone else delivers it)
            </label>
            <input id="cm-expected" className="zoiko-input w-full" value={expectedFrom} maxLength={120} placeholder="e.g. External partner" onChange={(e) => setExpectedFrom(e.target.value)} />
          </div>
        </div>
        <DueFields idPrefix="cm-due" value={due} onChange={setDue} />
        <div className="grid gap-3 sm:grid-cols-3">
          <StreamSelect id="cm-stream" value={streamId} onChange={setStreamId} current={commitment?.stream} />
          <div>
            <label htmlFor="cm-status" className={label}>
              Status
            </label>
            <select id="cm-status" className="zoiko-input w-full" value={status} onChange={(e) => setStatus(e.target.value as CommitmentStatus | "")}>
              <option value="">{commitment ? "Keep as is" : "Automatic"}</option>
              <option value="AWAITING">Awaiting</option>
              <option value="IN_PROGRESS">In progress</option>
              <option value="RECORDED">Recorded (done)</option>
              <option value="CANCELLED">Cancelled</option>
            </select>
          </div>
          <VisibilityField id="cm-visibility" value={visibility} onChange={setVisibility} disabled={Boolean(commitment) && !commitment!.isCreator} />
        </div>
        <SourcesField subject={commitment ? { type: "COMMITMENT", id: commitment.id } : undefined} existing={commitment?.evidence ?? []} pending={pending} onPending={setPending} />
        <ErrorLine error={create.error ?? update.error} />
      </form>
    </Modal>
  );
}

// ── Decision ────────────────────────────────────────────────────────────────

export function DecisionDialog({
  decision,
  seed,
  onClose,
  onSaved,
}: {
  decision?: Decision | null;
  seed?: { title?: string; streamId?: string; sources?: PickedSource[] };
  onClose: () => void;
  onSaved?: (saved: Decision) => void;
}) {
  const create = useCreateDecision();
  const update = useUpdateDecision();
  const [title, setTitle] = useState(decision?.title ?? seed?.title ?? "");
  const [rationale, setRationale] = useState(decision?.rationale ?? "");
  const [streamId, setStreamId] = useState(decision?.stream?.id ?? seed?.streamId ?? "");
  const [owner, setOwner] = useState<OwnerValue>(decision ? ownerFromView(decision.owner) : { text: "" });
  const [approver, setApprover] = useState<OwnerValue>(decision?.approver ? { text: decision.approver.name, email: decision.approver.email } : { text: "" });
  const [review, setReview] = useState<DueValue>(decision?.reviewAt ? dueFromIso(decision.reviewAt, decision.timeZone) : emptyDue());
  const [visibility, setVisibility] = useState<"PRIVATE" | "WORKSPACE">(decision?.visibility ?? "PRIVATE");
  const [pending, setPending] = useState<PickedSource[]>(seed?.sources ?? []);
  const [touched, setTouched] = useState(false);
  const busy = create.isPending || update.isPending;
  const approverLocked = Boolean(decision) && decision!.status !== "PENDING";
  const approverText = approver.text.trim();
  const problems = {
    title: title.trim() ? null : "Give the decision a title.",
    approver: approverText && !approver.email && !EMAIL.test(approverText) ? "Choose a colleague — an approver has to be someone in the workspace." : null,
  };

  const submit = () => {
    setTouched(true);
    if (problems.title || problems.approver || busy) return;
    const reviewIso = dueToIso(review);
    const approverEmail = approver.email ?? (approverText ? approverText.toLowerCase() : null);
    const common = {
      title: title.trim(),
      rationale: rationale.trim() || null,
      streamId: streamId || null,
      ...ownerPayload(owner),
      reviewAt: reviewIso,
      ...(reviewIso ? { timeZone: review.zone } : {}),
      visibility,
    };
    if (decision) {
      update.mutate({ id: decision.id, input: { ...common, ...(approverLocked ? {} : { approverEmail }) } }, { onSuccess: (saved) => { onSaved?.(saved); onClose(); } });
    } else {
      create.mutate({ ...common, approverEmail, ...(pending.length ? { evidence: evidenceOf(pending) } : {}) }, { onSuccess: (saved) => { onSaved?.(saved); onClose(); } });
    }
  };

  return (
    <Modal
      open
      size="lg"
      onClose={busy ? () => undefined : onClose}
      title={decision ? "Edit decision" : "Record decision"}
      footer={
        <>
          <button type="button" className="zoiko-btn" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button type="button" className="zoiko-btn pri" onClick={submit} disabled={busy}>
            {busy ? "Saving…" : decision ? "Save changes" : "Record decision"}
          </button>
        </>
      }
    >
      <form noValidate className="flex flex-col gap-4" onSubmit={(e) => { e.preventDefault(); submit(); }}>
        <div>
          <label htmlFor="dc-title" className={label}>
            The decision
          </label>
          <input id="dc-title" className="zoiko-input w-full" autoFocus value={title} placeholder="e.g. Approve partner launch messaging" onChange={(e) => setTitle(e.target.value)} aria-invalid={touched && Boolean(problems.title)} />
          {touched && problems.title && <p className={problemText}>{problems.title}</p>}
        </div>
        <div>
          <label htmlFor="dc-rationale" className={label}>
            What needs deciding, and why
          </label>
          <textarea id="dc-rationale" className="zoiko-input min-h-[70px] w-full" value={rationale} onChange={(e) => setRationale(e.target.value)} />
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label htmlFor="dc-owner" className={label}>
              Decision owner
            </label>
            <OwnerField id="dc-owner" value={owner} onChange={setOwner} />
          </div>
          <div>
            <label htmlFor="dc-approver" className={label}>
              Authorized approver
            </label>
            <OwnerField id="dc-approver" value={approver} onChange={setApprover} placeholder="A colleague — or leave empty" />
            {touched && problems.approver && <p className={problemText}>{problems.approver}</p>}
            <p className="mt-1 text-[11px] text-[var(--ink3)]">
              {approverLocked ? "Fixed once a decision has been given." : "Only they can approve it. With nobody named, a workspace Owner or Admin can."}
            </p>
          </div>
        </div>
        <DueFields idPrefix="dc-review" value={review} onChange={setReview} dateLabel="Review date" />
        <div className="grid gap-3 sm:grid-cols-2">
          <StreamSelect id="dc-stream" value={streamId} onChange={setStreamId} current={decision?.stream} />
          <VisibilityField id="dc-visibility" value={visibility} onChange={setVisibility} disabled={Boolean(decision) && !decision!.isCreator} />
        </div>
        <SourcesField subject={decision ? { type: "DECISION", id: decision.id } : undefined} existing={decision?.evidence ?? []} pending={pending} onPending={setPending} />
        <ErrorLine error={create.error ?? update.error} />
      </form>
    </Modal>
  );
}

// ── Giving an outcome ───────────────────────────────────────────────────────

export function DecideDialog({ decision, onClose, onDone }: { decision: Decision; onClose: () => void; onDone?: (saved: Decision) => void }) {
  const decide = useDecide();
  const others = useDecisions({ tab: "all", days: 0 });
  const replacements = (others.data?.items ?? []).filter((d) => d.id !== decision.id && d.status !== "SUPERSEDED");
  const options: Array<{ key: "APPROVED" | "DEFERRED" | "SUPERSEDED"; text: string; hint: string }> = [
    { key: "APPROVED", text: "Approve", hint: "Blocked deliverables waiting on it are released." },
    { key: "DEFERRED", text: "Defer", hint: "Not now. Deliverables waiting on it are marked blocked." },
    { key: "SUPERSEDED", text: "Replace with another decision", hint: "It no longer applies." },
  ];
  const allowed = options.filter((o) => (decision.status === "APPROVED" ? o.key === "SUPERSEDED" : decision.status === "DEFERRED" ? o.key !== "DEFERRED" : true));
  const [outcome, setOutcome] = useState<(typeof options)[number]["key"]>(allowed[0]!.key);
  const [note, setNote] = useState("");
  const [replacement, setReplacement] = useState("");
  const problem = outcome === "SUPERSEDED" && !replacement ? "Choose the decision that replaces it." : null;
  const [touched, setTouched] = useState(false);

  const submit = () => {
    setTouched(true);
    if (problem || decide.isPending) return;
    decide.mutate(
      { id: decision.id, input: { outcome, ...(note.trim() ? { note: note.trim() } : {}), ...(outcome === "SUPERSEDED" ? { supersededById: replacement } : {}) } },
      { onSuccess: (saved) => { onDone?.(saved); onClose(); } }
    );
  };

  return (
    <Modal
      open
      onClose={decide.isPending ? () => undefined : onClose}
      title="Review approval"
      footer={
        <>
          <button type="button" className="zoiko-btn" onClick={onClose} disabled={decide.isPending}>
            Cancel
          </button>
          <button type="button" className="zoiko-btn pri" onClick={submit} disabled={decide.isPending}>
            {decide.isPending ? "Saving…" : outcome === "APPROVED" ? "Approve decision" : outcome === "DEFERRED" ? "Defer decision" : "Replace decision"}
          </button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <div>
          <p className="text-[14px] font-semibold text-[var(--ink)]">{decision.title}</p>
          <p className="mt-1 flex items-center gap-1.5 text-[12px] text-[var(--ink3)]">
            <ShieldCheck className="h-3.5 w-3.5" aria-hidden /> {decision.authority} Your outcome is recorded against your name.
          </p>
        </div>
        <div role="radiogroup" aria-label="Outcome" className="space-y-2">
          {allowed.map((o) => (
            <label key={o.key} className={`flex cursor-pointer items-start gap-3 rounded-xl border p-3 ${outcome === o.key ? "border-[var(--accent)] bg-[var(--zm-selected)]" : "border-[var(--border)]"}`}>
              <input type="radio" name="outcome" checked={outcome === o.key} onChange={() => setOutcome(o.key)} className="mt-1" aria-label={o.text} />
              <span>
                <span className="block text-[13.5px] font-semibold text-[var(--ink)]">{o.text}</span>
                <span className="text-[12px] text-[var(--ink3)]">{o.hint}</span>
              </span>
            </label>
          ))}
        </div>
        {outcome === "SUPERSEDED" && (
          <div>
            <label htmlFor="dd-replacement" className={label}>
              Replaced by
            </label>
            <select id="dd-replacement" className="zoiko-input w-full" value={replacement} onChange={(e) => setReplacement(e.target.value)}>
              <option value="">Choose a decision…</option>
              {replacements.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.title}
                </option>
              ))}
            </select>
            {touched && problem && <p className={problemText}>{problem}</p>}
          </div>
        )}
        <div>
          <label htmlFor="dd-note" className={label}>
            Note (optional)
          </label>
          <textarea id="dd-note" className="zoiko-input min-h-[64px] w-full" maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} />
        </div>
        <ErrorLine error={decide.error} />
      </div>
    </Modal>
  );
}

// ── Workstream ──────────────────────────────────────────────────────────────

export function StreamDialog({ stream, onClose, onSaved }: { stream?: Stream | null; onClose: () => void; onSaved?: (saved: Stream) => void }) {
  const create = useCreateStream();
  const update = useUpdateStream();
  const [title, setTitle] = useState(stream?.title ?? "");
  const [description, setDescription] = useState(stream?.description ?? "");
  const [owner, setOwner] = useState<OwnerValue>(stream ? ownerFromView(stream.owner) : { text: "" });
  const [checkpoint, setCheckpoint] = useState<DueValue>(stream?.nextCheckpointAt ? dueFromIso(stream.nextCheckpointAt, stream.timeZone) : emptyDue());
  const [visibility, setVisibility] = useState<"PRIVATE" | "WORKSPACE">(stream?.visibility ?? "PRIVATE");
  const [touched, setTouched] = useState(false);
  const busy = create.isPending || update.isPending;
  const problem = title.trim() ? null : "Give the workstream a name.";

  const submit = () => {
    setTouched(true);
    if (problem || busy) return;
    const at = dueToIso(checkpoint);
    const input = { title: title.trim(), description: description.trim() || null, ...ownerPayload(owner), nextCheckpointAt: at, ...(at ? { timeZone: checkpoint.zone } : {}), visibility };
    if (stream) update.mutate({ id: stream.id, input }, { onSuccess: (saved) => { onSaved?.(saved); onClose(); } });
    else create.mutate(input, { onSuccess: (saved) => { onSaved?.(saved); onClose(); } });
  };

  return (
    <Modal
      open
      onClose={busy ? () => undefined : onClose}
      title={stream ? "Edit workstream" : "New workstream"}
      footer={
        <>
          <button type="button" className="zoiko-btn" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button type="button" className="zoiko-btn pri" onClick={submit} disabled={busy}>
            {busy ? "Saving…" : stream ? "Save changes" : "Create workstream"}
          </button>
        </>
      }
    >
      <form noValidate className="flex flex-col gap-4" onSubmit={(e) => { e.preventDefault(); submit(); }}>
        <div>
          <label htmlFor="ws-title" className={label}>
            Name
          </label>
          <input id="ws-title" className="zoiko-input w-full" autoFocus value={title} placeholder="e.g. Q4 Launch Readiness" onChange={(e) => setTitle(e.target.value)} />
          {touched && problem && <p className={problemText}>{problem}</p>}
        </div>
        <div>
          <label htmlFor="ws-desc" className={label}>
            What it coordinates
          </label>
          <textarea id="ws-desc" className="zoiko-input min-h-[70px] w-full" value={description} onChange={(e) => setDescription(e.target.value)} />
        </div>
        <div>
          <label htmlFor="ws-owner" className={label}>
            Accountable owner
          </label>
          <OwnerField id="ws-owner" value={owner} onChange={setOwner} />
        </div>
        <DueFields idPrefix="ws-checkpoint" value={checkpoint} onChange={setCheckpoint} dateLabel="Next checkpoint" />
        <VisibilityField id="ws-visibility" value={visibility} onChange={setVisibility} disabled={Boolean(stream) && !stream!.isCreator} />
        <ErrorLine error={create.error ?? update.error} />
      </form>
    </Modal>
  );
}

// ── Dependency ──────────────────────────────────────────────────────────────

export function DependencyDialog({
  seed,
  onClose,
  onSaved,
}: {
  seed?: { blockerType?: "DECISION" | "COMMITMENT"; blockerId?: string; deliverable?: string };
  onClose: () => void;
  onSaved?: (saved: Dependency) => void;
}) {
  const create = useCreateDependency();
  const decisions = useDecisions({ tab: "all", days: 0 });
  const commitments = useCommitments({ days: 0 });
  const openDecisions = (decisions.data?.items ?? []).filter((d) => d.status === "PENDING" || d.status === "DEFERRED");
  const openCommitments = (commitments.data?.items ?? []).filter((c) => c.status === "AWAITING" || c.status === "IN_PROGRESS");
  const [deliverable, setDeliverable] = useState(seed?.deliverable ?? "");
  const [description, setDescription] = useState("");
  const [owner, setOwner] = useState<OwnerValue>({ text: "" });
  const [blockerType, setBlockerType] = useState<"DECISION" | "COMMITMENT">(seed?.blockerType ?? "DECISION");
  const [blockerId, setBlockerId] = useState(seed?.blockerId ?? "");
  const [visibility, setVisibility] = useState<"PRIVATE" | "WORKSPACE">("PRIVATE");
  const [touched, setTouched] = useState(false);
  const choices = blockerType === "DECISION" ? openDecisions : openCommitments;
  const problems = { deliverable: deliverable.trim() ? null : "Say what is blocked.", blocker: blockerId ? null : "Choose what it is waiting on." };

  const submit = () => {
    setTouched(true);
    if (problems.deliverable || problems.blocker || create.isPending) return;
    create.mutate(
      { deliverable: deliverable.trim(), description: description.trim() || null, ...ownerPayload(owner), blockerType, blockerId, visibility },
      { onSuccess: (saved) => { onSaved?.(saved); onClose(); } }
    );
  };

  return (
    <Modal
      open
      onClose={create.isPending ? () => undefined : onClose}
      title="Add dependency"
      footer={
        <>
          <button type="button" className="zoiko-btn" onClick={onClose} disabled={create.isPending}>
            Cancel
          </button>
          <button type="button" className="zoiko-btn pri" onClick={submit} disabled={create.isPending}>
            {create.isPending ? "Saving…" : "Add dependency"}
          </button>
        </>
      }
    >
      <form noValidate className="flex flex-col gap-4" onSubmit={(e) => { e.preventDefault(); submit(); }}>
        <div>
          <label htmlFor="dp-deliverable" className={label}>
            What is blocked
          </label>
          <input id="dp-deliverable" className="zoiko-input w-full" autoFocus value={deliverable} placeholder="e.g. Partner email sequence" onChange={(e) => setDeliverable(e.target.value)} />
          {touched && problems.deliverable && <p className={problemText}>{problems.deliverable}</p>}
        </div>
        <div>
          <label htmlFor="dp-owner" className={label}>
            Whose deliverable it is
          </label>
          <OwnerField id="dp-owner" value={owner} onChange={setOwner} />
        </div>
        <div className="grid gap-3 sm:grid-cols-[160px_1fr]">
          <div>
            <label htmlFor="dp-type" className={label}>
              Waiting on a
            </label>
            <select id="dp-type" className="zoiko-input w-full" value={blockerType} onChange={(e) => { setBlockerType(e.target.value as "DECISION" | "COMMITMENT"); setBlockerId(""); }}>
              <option value="DECISION">Decision</option>
              <option value="COMMITMENT">Commitment</option>
            </select>
          </div>
          <div>
            <label htmlFor="dp-blocker" className={label}>
              Which one
            </label>
            <select id="dp-blocker" className="zoiko-input w-full" value={blockerId} onChange={(e) => setBlockerId(e.target.value)}>
              <option value="">{choices.length ? "Choose…" : `No open ${blockerType === "DECISION" ? "decisions" : "commitments"}`}</option>
              {choices.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.title}
                </option>
              ))}
            </select>
            {touched && problems.blocker && <p className={problemText}>{problems.blocker}</p>}
          </div>
        </div>
        <div>
          <label htmlFor="dp-desc" className={label}>
            Notes
          </label>
          <textarea id="dp-desc" className="zoiko-input min-h-[56px] w-full" value={description} onChange={(e) => setDescription(e.target.value)} />
        </div>
        <VisibilityField id="dp-visibility" value={visibility} onChange={setVisibility} />
        <p className="text-[11.5px] text-[var(--ink3)]">It unblocks by itself, and tells its owner, the moment the decision is approved or the commitment is recorded.</p>
        <ErrorLine error={create.error} />
      </form>
    </Modal>
  );
}

// ── Add relationship ────────────────────────────────────────────────────────

type Mode = "stream" | "source" | "blocked";

/** Join things up: put an item in a workstream, link a source as evidence, or block a deliverable. */
export function RelationshipDialog({ streamId, onClose }: { streamId?: string; onClose: () => void }) {
  const [mode, setMode] = useState<Mode>("stream");
  const streams = useStreams();
  const commitments = useCommitments({ days: 0 });
  const decisions = useDecisions({ tab: "all", days: 0 });
  const updateCommitment = useUpdateCommitment();
  const updateDecision = useUpdateDecision();
  const addEvidence = useAddEvidence();
  const [target, setTarget] = useState(streamId ?? "");
  const [item, setItem] = useState("");
  const [subject, setSubject] = useState("");
  const [done, setDone] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const editable = useMemo(
    () => [
      ...(commitments.data?.items ?? []).filter((c) => c.canEdit).map((c) => ({ key: `COMMITMENT:${c.id}`, text: `Commitment · ${c.title}` })),
      ...(decisions.data?.items ?? []).filter((d) => d.canEdit).map((d) => ({ key: `DECISION:${d.id}`, text: `Decision · ${d.title}` })),
    ],
    [commitments.data, decisions.data]
  );
  const subjects = useMemo(
    () => [
      ...(streams.data ?? []).filter((s) => s.canEdit).map((s) => ({ key: `STREAM:${s.id}`, text: `Workstream · ${s.title}` })),
      ...editable,
    ],
    [streams.data, editable]
  );

  const link = () => {
    setError(null);
    const [type, id] = item.split(":");
    const onError = (e: unknown) => setError((e as Error).message);
    const onSuccess = () => { setDone("Added to the workstream."); setItem(""); };
    if (type === "COMMITMENT") updateCommitment.mutate({ id: id!, input: { streamId: target } }, { onSuccess, onError });
    else if (type === "DECISION") updateDecision.mutate({ id: id!, input: { streamId: target } }, { onSuccess, onError });
  };

  if (mode === "blocked") return <DependencyDialog onClose={onClose} />;

  return (
    <Modal open size="lg" onClose={onClose} title="Add relationship" footer={<button type="button" className="zoiko-btn pri" onClick={onClose}>Done</button>}>
      <div className="flex flex-col gap-4">
        <div role="radiogroup" aria-label="Kind of relationship" className="grid gap-2 sm:grid-cols-3">
          {(
            [
              ["stream", "Put in a workstream", Waypoints],
              ["source", "Link a source", LinkIcon],
              ["blocked", "Blocked by", Link2],
            ] as const
          ).map(([key, text, Icon]) => (
            <button
              key={key}
              type="button"
              role="radio"
              aria-checked={mode === key}
              onClick={() => { setMode(key); setDone(null); setError(null); }}
              className={`flex items-center gap-2 rounded-xl border px-3 py-3 text-left text-[13px] font-semibold ${mode === key ? "border-[var(--accent)] bg-[var(--zm-selected)] text-[var(--ink)]" : "border-[var(--border)] text-[var(--ink2)] hover:bg-[var(--s2)]"}`}
            >
              <Icon className="h-4 w-4" aria-hidden /> {text}
            </button>
          ))}
        </div>

        {mode === "stream" && (
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label htmlFor="rl-item" className={label}>
                Commitment or decision
              </label>
              <select id="rl-item" className="zoiko-input w-full" value={item} onChange={(e) => setItem(e.target.value)}>
                <option value="">Choose…</option>
                {editable.map((o) => (
                  <option key={o.key} value={o.key}>
                    {o.text}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="rl-stream" className={label}>
                Workstream
              </label>
              <select id="rl-stream" className="zoiko-input w-full" value={target} onChange={(e) => setTarget(e.target.value)}>
                <option value="">Choose…</option>
                {(streams.data ?? []).map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.title}
                  </option>
                ))}
              </select>
            </div>
            <div className="sm:col-span-2">
              <button type="button" className="zoiko-btn pri" disabled={!item || !target || updateCommitment.isPending || updateDecision.isPending} onClick={link}>
                Add to workstream
              </button>
            </div>
          </div>
        )}

        {mode === "source" && (
          <div className="space-y-3">
            <div>
              <label htmlFor="rl-subject" className={label}>
                Attach it to
              </label>
              <select id="rl-subject" className="zoiko-input w-full" value={subject} onChange={(e) => setSubject(e.target.value)}>
                <option value="">Choose…</option>
                {subjects.map((o) => (
                  <option key={o.key} value={o.key}>
                    {o.text}
                  </option>
                ))}
              </select>
            </div>
            {subject && (
              <SourcePicker
                onPick={(source) => {
                  setError(null);
                  const [type, id] = subject.split(":");
                  addEvidence.mutate(
                    { subjectType: type as "STREAM" | "COMMITMENT" | "DECISION", subjectId: id!, evidence: source.input },
                    { onSuccess: () => setDone(`Linked: ${source.name}`), onError: (e) => setError((e as Error).message) }
                  );
                }}
              />
            )}
          </div>
        )}

        {done && <p role="status" className="text-[12.5px] text-[#22B07D]">{done}</p>}
        {error && <p role="alert" className="text-[12.5px] text-[var(--crit)]">{error}</p>}
      </div>
    </Modal>
  );
}
