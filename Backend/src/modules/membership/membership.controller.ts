import type { Request, Response } from "express";
import { asyncHandler } from "../../common/middleware/asyncHandler.js";
import { sendSuccess } from "../../common/utils/response.js";
import { membershipService } from "./membership.service.js";

function requestContext(req: Request) {
  const tenant = req.tenantContext!;
  return {
    tenantId: tenant.tenantId,
    userId: tenant.userId,
    role: tenant.role,
    requestId: req.requestId,
    ipAddress: req.ip ?? null,
    userAgent: req.header("user-agent") ?? null,
  };
}

export const list = asyncHandler(async (req: Request, res: Response) => {
  const members = await membershipService.list(requestContext(req));
  sendSuccess(res, 200, { members }, req.requestId);
});

export const add = asyncHandler(async (req: Request, res: Response) => {
  const member = await membershipService.add(req.body, requestContext(req));
  sendSuccess(res, 201, member, req.requestId);
});

export const createInvitation = asyncHandler(async (req: Request, res: Response) => {
  const invitation = await membershipService.createInvitation(req.body, requestContext(req));
  sendSuccess(res, 201, invitation, req.requestId);
});

export const acceptInvitation = asyncHandler(async (req: Request, res: Response) => {
  const membership = await membershipService.acceptInvitation(req.body, {
    userId: req.auth!.sub,
    requestId: req.requestId,
    ipAddress: req.ip ?? null,
    userAgent: req.header("user-agent") ?? null,
  });
  sendSuccess(res, 200, membership, req.requestId);
});

export const cancelInvitation = asyncHandler(async (req: Request, res: Response) => {
  await membershipService.cancelInvitation(
    String(req.params.membershipId),
    requestContext(req)
  );
  sendSuccess(res, 200, { message: "Invitation cancelled successfully" }, req.requestId);
});

export const update = asyncHandler(async (req: Request, res: Response) => {
  const member = await membershipService.update(
    String(req.params.membershipId),
    req.body,
    requestContext(req)
  );
  sendSuccess(res, 200, member, req.requestId);
});

export const remove = asyncHandler(async (req: Request, res: Response) => {
  await membershipService.remove(String(req.params.membershipId), requestContext(req));
  sendSuccess(res, 200, { message: "Membership removed successfully" }, req.requestId);
});
