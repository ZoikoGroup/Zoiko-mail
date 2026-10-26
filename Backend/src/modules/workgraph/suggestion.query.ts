import type { AIActionType } from "@prisma/client";
import { prisma } from "../../config/prisma.js";
import type { WorkContext } from "./workgraph.shared.js";

/**
 * Alet's suggestions awaiting a human: extractions that finished, belong to
 * the caller, and were not yet turned into a commitment or decision, or
 * dismissed. Nothing here is a commitment until a person confirms it.
 */
export const COMMITMENT_TYPES: AIActionType[] = ["COMMITMENT_EXTRACTION", "REPLY_OWED", "DEADLINE"];
export const DECISION_TYPES: AIActionType[] = ["APPROVAL"];

export async function pendingSuggestions(context: WorkContext, kind?: "COMMITMENT" | "DECISION") {
  const types = kind === "COMMITMENT" ? COMMITMENT_TYPES : kind === "DECISION" ? DECISION_TYPES : [...COMMITMENT_TYPES, ...DECISION_TYPES];
  const rows = await prisma.aIAction.findMany({
    where: { tenantId: context.tenantId, createdByUserId: context.userId, status: "COMPLETED", actionType: { in: types } },
    orderBy: { createdAt: "desc" },
    take: 100,
  });
  // Only ones that actually found something.
  const real = rows.filter((r) => {
    const output = r.output && typeof r.output === "object" && !Array.isArray(r.output) ? (r.output as Record<string, unknown>) : {};
    return typeof output.text === "string" && output.text.trim().length > 0;
  });
  if (real.length === 0) return [];
  const ids = real.map((r) => r.id);
  const [commitments, decisions] = await Promise.all([
    prisma.workCommitment.findMany({ where: { tenantId: context.tenantId, sourceAiActionId: { in: ids } }, select: { sourceAiActionId: true } }),
    prisma.workDecision.findMany({ where: { tenantId: context.tenantId, sourceAiActionId: { in: ids } }, select: { sourceAiActionId: true } }),
  ]);
  const done = new Set([...commitments, ...decisions].map((r) => r.sourceAiActionId));
  return real.filter((r) => !done.has(r.id));
}

export async function countSuggestions(context: WorkContext, kind?: "COMMITMENT" | "DECISION"): Promise<number> {
  return (await pendingSuggestions(context, kind)).length;
}
