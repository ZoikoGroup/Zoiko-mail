import { Prisma } from "@prisma/client";
import { prisma } from "../../config/prisma.js";
import { AppError } from "../../common/errors/AppError.js";
import { ErrorCodes } from "../../common/errors/errorCodes.js";
import { commitmentService } from "./commitment.service.js";
import { decisionService } from "./decision.service.js";
import { DECISION_TYPES, pendingSuggestions } from "./suggestion.query.js";
import { audit, notFound, openableMessages, type WorkContext } from "./workgraph.shared.js";
import type { ConfirmSuggestionInput } from "./workgraph.schema.js";

/**
 * Alet's suggestions: commitments, replies owed, deadlines and approvals it
 * found in mail. They are only suggestions. Nothing becomes a commitment or a
 * decision until a person confirms it here, and an approval it spotted is
 * recorded as a pending decision — Alet never grants one.
 */

function outputOf(action: { output: Prisma.JsonValue }) {
  return action.output && typeof action.output === "object" && !Array.isArray(action.output) ? (action.output as Record<string, unknown>) : {};
}

function dueOf(output: Record<string, unknown>): Date | null {
  return typeof output.dueAt === "string" && !Number.isNaN(Date.parse(output.dueAt)) ? new Date(output.dueAt) : null;
}

export class SuggestionService {
  async list(context: WorkContext, kind?: "COMMITMENT" | "DECISION") {
    const rows = await pendingSuggestions(context, kind);
    const messageIds = rows.map((r) => r.messageId).filter((id): id is string => Boolean(id));
    const openable = await openableMessages(messageIds, context);
    return rows.map((r) => {
      const output = outputOf(r);
      const message = r.messageId ? openable.get(r.messageId) : undefined;
      return {
        id: r.id,
        kind: DECISION_TYPES.includes(r.actionType) ? ("DECISION" as const) : ("COMMITMENT" as const),
        actionType: r.actionType,
        title: String(output.text).trim(),
        dueAt: dueOf(output),
        priority: typeof output.priority === "string" ? output.priority : null,
        excerpt: r.sourceExcerpt,
        confidence: r.confidenceScore,
        source: message && r.messageId ? { messageId: r.messageId, subject: message.subject, openPath: `/mail?open=${r.messageId}&folder=${message.folder}` } : null,
        createdAt: r.createdAt,
      };
    });
  }

  async confirm(aiActionId: string, input: ConfirmSuggestionInput, context: WorkContext) {
    const action = await prisma.aIAction.findFirst({
      where: { id: aiActionId, tenantId: context.tenantId, createdByUserId: context.userId, status: "COMPLETED" },
    });
    if (!action) throw notFound("Suggestion");
    const output = outputOf(action);
    const text = typeof output.text === "string" ? output.text.trim() : "";
    if (!text) throw notFound("Suggestion");

    // The source message becomes evidence, when it is one the caller can open.
    const openable = action.messageId ? await openableMessages([action.messageId], context) : new Map();
    const evidence = action.messageId && openable.has(action.messageId) ? [{ kind: "EMAIL" as const, refId: action.messageId }] : [];
    const common = {
      title: input.title ?? text.slice(0, 200),
      streamId: input.streamId,
      ownerEmail: input.ownerEmail,
      ownerLabel: input.ownerLabel,
      visibility: input.visibility,
      evidence,
    };
    try {
      const created = DECISION_TYPES.includes(action.actionType)
        ? await decisionService.create({ ...common, rationale: action.sourceExcerpt ?? null, reviewAt: input.dueAt === undefined ? dueOf(output) : input.dueAt }, context, { sourceAiActionId: action.id })
        : await commitmentService.create({ ...common, description: action.sourceExcerpt ?? null, dueAt: input.dueAt === undefined ? dueOf(output) : input.dueAt }, context, { sourceAiActionId: action.id });
      await prisma.aIAction.updateMany({ where: { id: action.id, tenantId: context.tenantId, status: "COMPLETED" }, data: { status: "CONFIRMED" } });
      await audit(context, "WORK_SUGGESTION_CONFIRMED", "AIAction", action.id, { as: DECISION_TYPES.includes(action.actionType) ? "decision" : "commitment" });
      return { kind: DECISION_TYPES.includes(action.actionType) ? ("DECISION" as const) : ("COMMITMENT" as const), item: created };
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        throw new AppError("That suggestion was already confirmed.", 409, ErrorCodes.CONFLICT, { reason: "ALREADY_CONFIRMED" });
      }
      throw error;
    }
  }

  async dismiss(aiActionId: string, context: WorkContext) {
    const { count } = await prisma.aIAction.updateMany({
      where: { id: aiActionId, tenantId: context.tenantId, createdByUserId: context.userId, status: "COMPLETED" },
      data: { status: "DISMISSED" },
    });
    if (count === 0) throw notFound("Suggestion");
    await audit(context, "WORK_SUGGESTION_DISMISSED", "AIAction", aiActionId);
  }
}

export const suggestionService = new SuggestionService();
