import { z } from "zod";

const email = z.string().trim().toLowerCase().email("Enter a valid email address").max(254);
const title = z.string().trim().min(1, "Give it a title").max(200);
const text = z.string().trim().max(4000);
const label = z.string().trim().min(1).max(120);
const zone = z.string().trim().min(1).max(64);
const visibility = z.enum(["PRIVATE", "WORKSPACE"]);
const uuid = z.string().uuid();

export const idParamsSchema = z.object({ id: uuid });

/** Who is accountable: a colleague by address, or a named team. Neither means the caller. */
const ownerFields = {
  ownerEmail: email.optional(),
  ownerLabel: label.nullable().optional(),
};

// ── Evidence ────────────────────────────────────────────────────────────────

export const evidenceInputSchema = z
  .object({
    kind: z.enum(["EMAIL", "MEETING", "DOCUMENT", "NOTE"]),
    /** The message or the meeting; required for those two kinds. */
    refId: uuid.optional(),
    /** For a document or note: what to call it. A message or meeting is named by itself. */
    label: z.string().trim().min(1).max(300).optional(),
    occurredAt: z.coerce.date().optional(),
  })
  .strict()
  .refine((v) => (v.kind === "EMAIL" || v.kind === "MEETING" ? Boolean(v.refId) : Boolean(v.label)), {
    message: "Choose the message or meeting, or name the document or note",
    path: ["refId"],
  });
export type EvidenceInput = z.infer<typeof evidenceInputSchema>;

export const addEvidenceSchema = z
  .object({ subjectType: z.enum(["STREAM", "COMMITMENT", "DECISION"]), subjectId: uuid, evidence: evidenceInputSchema })
  .strict();
export type AddEvidenceInput = z.infer<typeof addEvidenceSchema>;

// ── Workstreams ─────────────────────────────────────────────────────────────

const streamFields = {
  title,
  description: text.nullable().optional(),
  ...ownerFields,
  nextCheckpointAt: z.coerce.date().nullable().optional(),
  timeZone: zone.optional(),
  visibility: visibility.optional(),
};
export const streamSchema = z.object(streamFields).strict();
export type StreamInput = z.infer<typeof streamSchema>;
export const updateStreamSchema = z
  .object({ ...streamFields, title: title.optional(), status: z.enum(["ACTIVE", "ARCHIVED"]).optional() })
  .strict()
  .refine((v) => Object.keys(v).length > 0, { message: "Nothing to change" });
export type UpdateStreamInput = z.infer<typeof updateStreamSchema>;

// ── Commitments ─────────────────────────────────────────────────────────────

const commitmentFields = {
  title,
  description: text.nullable().optional(),
  streamId: uuid.nullable().optional(),
  ...ownerFields,
  /** Who it is expected from, when somebody else delivers it. */
  expectedFrom: label.nullable().optional(),
  dueAt: z.coerce.date().nullable().optional(),
  timeZone: zone.optional(),
  status: z.enum(["AWAITING", "IN_PROGRESS", "RECORDED", "CANCELLED"]).optional(),
  visibility: visibility.optional(),
};
export const commitmentSchema = z.object({ ...commitmentFields, evidence: z.array(evidenceInputSchema).max(10).optional() }).strict();
export type CommitmentInput = z.infer<typeof commitmentSchema>;
export const updateCommitmentSchema = z
  .object({ ...commitmentFields, title: title.optional() })
  .strict()
  .refine((v) => Object.keys(v).length > 0, { message: "Nothing to change" });
export type UpdateCommitmentInput = z.infer<typeof updateCommitmentSchema>;

export const listCommitmentsSchema = z.object({
  tab: z.enum(["all", "mine", "awaiting"]).default("all"),
  scope: z.enum(["accessible", "owned", "created"]).default("accessible"),
  q: z.string().trim().max(200).default(""),
  /** How far back finished items still show. 0 = all of them. */
  days: z.coerce.number().int().min(0).max(3650).default(30),
});
export type ListCommitmentsInput = z.infer<typeof listCommitmentsSchema>;

// ── Decisions ───────────────────────────────────────────────────────────────

const decisionFields = {
  title,
  rationale: text.nullable().optional(),
  streamId: uuid.nullable().optional(),
  ...ownerFields,
  /** The one person who may approve it. */
  approverEmail: email.nullable().optional(),
  reviewAt: z.coerce.date().nullable().optional(),
  timeZone: zone.optional(),
  visibility: visibility.optional(),
};
export const decisionSchema = z.object({ ...decisionFields, evidence: z.array(evidenceInputSchema).max(10).optional() }).strict();
export type DecisionInput = z.infer<typeof decisionSchema>;
export const updateDecisionSchema = z
  .object({ ...decisionFields, title: title.optional() })
  .strict()
  .refine((v) => Object.keys(v).length > 0, { message: "Nothing to change" });
export type UpdateDecisionInput = z.infer<typeof updateDecisionSchema>;

export const listDecisionsSchema = z.object({
  tab: z.enum(["all", "awaiting", "approved"]).default("all"),
  scope: z.enum(["accessible", "owned", "created"]).default("accessible"),
  q: z.string().trim().max(200).default(""),
  days: z.coerce.number().int().min(0).max(3650).default(30),
});
export type ListDecisionsInput = z.infer<typeof listDecisionsSchema>;

export const decideSchema = z
  .object({
    outcome: z.enum(["APPROVED", "DEFERRED", "SUPERSEDED"]),
    note: z.string().trim().max(1000).optional(),
    /** For SUPERSEDED: the decision that replaces it. */
    supersededById: uuid.optional(),
  })
  .strict()
  .refine((v) => v.outcome !== "SUPERSEDED" || Boolean(v.supersededById), { message: "Say which decision replaces it", path: ["supersededById"] });
export type DecideInput = z.infer<typeof decideSchema>;

// ── Dependencies ────────────────────────────────────────────────────────────

const dependencyFields = {
  deliverable: title,
  description: text.nullable().optional(),
  ...ownerFields,
  streamId: uuid.nullable().optional(),
  visibility: visibility.optional(),
};
export const dependencySchema = z
  .object({ ...dependencyFields, blockerType: z.enum(["DECISION", "COMMITMENT"]), blockerId: uuid })
  .strict();
export type DependencyInput = z.infer<typeof dependencySchema>;
export const updateDependencySchema = z
  .object({ ...dependencyFields, deliverable: title.optional(), resolved: z.boolean().optional() })
  .strict()
  .refine((v) => Object.keys(v).length > 0, { message: "Nothing to change" });
export type UpdateDependencyInput = z.infer<typeof updateDependencySchema>;

export const listDependenciesSchema = z.object({
  state: z.enum(["open", "all"]).default("all"),
  q: z.string().trim().max(200).default(""),
});
export type ListDependenciesInput = z.infer<typeof listDependenciesSchema>;

// ── Suggestions (Alet's, awaiting a human) ──────────────────────────────────

export const confirmSuggestionSchema = z
  .object({
    title: title.optional(),
    dueAt: z.coerce.date().nullable().optional(),
    streamId: uuid.nullable().optional(),
    ...ownerFields,
    visibility: visibility.optional(),
  })
  .strict();
export type ConfirmSuggestionInput = z.infer<typeof confirmSuggestionSchema>;

// ── Overview ────────────────────────────────────────────────────────────────

export const overviewSchema = z.object({
  streamId: uuid.optional(),
  scope: z.enum(["accessible", "owned"]).default("accessible"),
  links: z.enum(["confirmed", "all"]).default("confirmed"),
  days: z.coerce.number().int().min(0).max(3650).default(30),
  q: z.string().trim().max(200).default(""),
});
export type OverviewInput = z.infer<typeof overviewSchema>;

export const peopleSchema = z.object({ q: z.string().trim().max(200).default("") });
