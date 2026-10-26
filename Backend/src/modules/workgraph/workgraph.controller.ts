import type { Request, Response } from "express";
import { asyncHandler } from "../../common/middleware/asyncHandler.js";
import { sendSuccess } from "../../common/utils/response.js";
import { invitationService } from "../calendar/invitation.service.js";
import { commitmentService } from "./commitment.service.js";
import { decisionService } from "./decision.service.js";
import { dependencyService } from "./dependency.service.js";
import { overviewService } from "./overview.service.js";
import { evidenceService, streamService } from "./stream.service.js";
import { suggestionService } from "./suggestion.service.js";
import { listCommitmentsSchema, listDecisionsSchema, listDependenciesSchema, overviewSchema, peopleSchema } from "./workgraph.schema.js";
import type { WorkContext } from "./workgraph.shared.js";

function context(req: Request): WorkContext {
  const tenant = req.tenantContext!;
  return {
    tenantId: tenant.tenantId,
    userId: tenant.userId,
    membershipId: tenant.membershipId,
    membershipRole: tenant.membershipRole,
    requestId: req.requestId,
  };
}
const id = (req: Request) => String(req.params.id);

export const people = asyncHandler(async (req: Request, res: Response) => {
  sendSuccess(res, 200, await invitationService.people(peopleSchema.parse(req.query).q, context(req)), req.requestId);
});
export const overview = asyncHandler(async (req: Request, res: Response) => {
  sendSuccess(res, 200, await overviewService.build(overviewSchema.parse(req.query), context(req)), req.requestId);
});

// Workstreams
export const listStreams = asyncHandler(async (req: Request, res: Response) => {
  sendSuccess(res, 200, await streamService.list(context(req), req.query.archived === "true"), req.requestId);
});
export const createStream = asyncHandler(async (req: Request, res: Response) => {
  sendSuccess(res, 201, await streamService.create(req.body, context(req)), req.requestId);
});
export const updateStream = asyncHandler(async (req: Request, res: Response) => {
  sendSuccess(res, 200, await streamService.update(id(req), req.body, context(req)), req.requestId);
});
export const deleteStream = asyncHandler(async (req: Request, res: Response) => {
  await streamService.remove(id(req), context(req));
  sendSuccess(res, 204, null, req.requestId);
});

// Commitments
export const listCommitments = asyncHandler(async (req: Request, res: Response) => {
  sendSuccess(res, 200, await commitmentService.list(listCommitmentsSchema.parse(req.query), context(req)), req.requestId);
});
export const getCommitment = asyncHandler(async (req: Request, res: Response) => {
  sendSuccess(res, 200, await commitmentService.get(id(req), context(req)), req.requestId);
});
export const createCommitment = asyncHandler(async (req: Request, res: Response) => {
  sendSuccess(res, 201, await commitmentService.create(req.body, context(req)), req.requestId);
});
export const updateCommitment = asyncHandler(async (req: Request, res: Response) => {
  sendSuccess(res, 200, await commitmentService.update(id(req), req.body, context(req)), req.requestId);
});
export const deleteCommitment = asyncHandler(async (req: Request, res: Response) => {
  await commitmentService.remove(id(req), context(req));
  sendSuccess(res, 204, null, req.requestId);
});

// Decisions
export const listDecisions = asyncHandler(async (req: Request, res: Response) => {
  sendSuccess(res, 200, await decisionService.list(listDecisionsSchema.parse(req.query), context(req)), req.requestId);
});
export const getDecision = asyncHandler(async (req: Request, res: Response) => {
  sendSuccess(res, 200, await decisionService.get(id(req), context(req)), req.requestId);
});
export const createDecision = asyncHandler(async (req: Request, res: Response) => {
  sendSuccess(res, 201, await decisionService.create(req.body, context(req)), req.requestId);
});
export const updateDecision = asyncHandler(async (req: Request, res: Response) => {
  sendSuccess(res, 200, await decisionService.update(id(req), req.body, context(req)), req.requestId);
});
export const decide = asyncHandler(async (req: Request, res: Response) => {
  sendSuccess(res, 200, await decisionService.decide(id(req), req.body, context(req)), req.requestId);
});
export const deleteDecision = asyncHandler(async (req: Request, res: Response) => {
  await decisionService.remove(id(req), context(req));
  sendSuccess(res, 204, null, req.requestId);
});

// Dependencies
export const listDependencies = asyncHandler(async (req: Request, res: Response) => {
  sendSuccess(res, 200, await dependencyService.list(listDependenciesSchema.parse(req.query), context(req)), req.requestId);
});
export const createDependency = asyncHandler(async (req: Request, res: Response) => {
  sendSuccess(res, 201, await dependencyService.create(req.body, context(req)), req.requestId);
});
export const updateDependency = asyncHandler(async (req: Request, res: Response) => {
  sendSuccess(res, 200, await dependencyService.update(id(req), req.body, context(req)), req.requestId);
});
export const deleteDependency = asyncHandler(async (req: Request, res: Response) => {
  await dependencyService.remove(id(req), context(req));
  sendSuccess(res, 204, null, req.requestId);
});

// Sources
export const addEvidence = asyncHandler(async (req: Request, res: Response) => {
  sendSuccess(res, 201, await evidenceService.add(req.body, context(req)), req.requestId);
});
export const removeEvidence = asyncHandler(async (req: Request, res: Response) => {
  await evidenceService.remove(id(req), context(req));
  sendSuccess(res, 204, null, req.requestId);
});

// Suggestions Alet found, awaiting a person
export const listSuggestions = asyncHandler(async (req: Request, res: Response) => {
  const kind = req.query.kind === "COMMITMENT" || req.query.kind === "DECISION" ? req.query.kind : undefined;
  sendSuccess(res, 200, await suggestionService.list(context(req), kind), req.requestId);
});
export const confirmSuggestion = asyncHandler(async (req: Request, res: Response) => {
  sendSuccess(res, 201, await suggestionService.confirm(id(req), req.body, context(req)), req.requestId);
});
export const dismissSuggestion = asyncHandler(async (req: Request, res: Response) => {
  await suggestionService.dismiss(id(req), context(req));
  sendSuccess(res, 204, null, req.requestId);
});
