import type { Request, Response } from "express";
import { asyncHandler } from "../../common/middleware/asyncHandler.js";
import { sendSuccess } from "../../common/utils/response.js";
import { messageService } from "./message.service.js";
import { participantService } from "../participant/participant.service.js";

function context(req: Request) {
  const tenant = req.tenantContext!;
  return {
    tenantId: tenant.tenantId,
    userId: tenant.userId,
    membershipId: tenant.membershipId,
  };
}

export const list = asyncHandler(async (req: Request, res: Response) => {
  sendSuccess(res, 200, await messageService.list(req.query as never, context(req)), req.requestId);
});
export const get = asyncHandler(async (req: Request, res: Response) => {
  sendSuccess(res, 200, await messageService.get(String(req.params.messageId), context(req)), req.requestId);
});
export const listThreads = asyncHandler(async (req: Request, res: Response) => {
  sendSuccess(res, 200, await messageService.listThreads(req.query as never, context(req)), req.requestId);
});
export const getThread = asyncHandler(async (req: Request, res: Response) => {
  sendSuccess(res, 200, await messageService.getThread(String(req.params.threadId), context(req)), req.requestId);
});

/**
 * §12: "List participants in a thread."
 *
 * Roles included, because "who was on this thread" and "who sent it" are
 * different questions and a client rendering a header needs both.
 */
export const listThreadParticipants = asyncHandler(async (req: Request, res: Response) => {
  const result = await participantService.listForThread(
    req.tenantContext!.tenantId,
    String(req.params.threadId)
  );
  sendSuccess(res, 200, result, req.requestId);
});
