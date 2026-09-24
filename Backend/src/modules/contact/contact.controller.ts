import type { Request, Response } from "express";
import { asyncHandler } from "../../common/middleware/asyncHandler.js";
import { sendSuccess } from "../../common/utils/response.js";
import { contactService } from "./contact.service.js";
import { listContactsSchema } from "./contact.schema.js";

// function context(req: Request) {
//   return {
//     tenantId: req.tenantId!,
//     userId: req.userId!,
//     membershipId: req.membershipId!,
//     requestId: req.requestId,
//     ipAddress: req.ip ?? null,
//     userAgent: req.headers["user-agent"] ?? null,
//   };
// }
function context(req: Request) {
  const tenant = req.tenantContext!;
  return {
    tenantId: tenant.tenantId,
    userId: tenant.userId,
    membershipId: tenant.membershipId,
    requestId: req.requestId,
    ipAddress: req.ip ?? null,
    userAgent: req.header("user-agent") ?? null,
  };
}

export const list = asyncHandler(async (req: Request, res: Response) => {
  sendSuccess(res, 200, await contactService.list(listContactsSchema.parse(req.query), context(req)), req.requestId);
});

export const getById = asyncHandler(async (req: Request, res: Response) => {
  sendSuccess(res, 200, await contactService.getById(String(req.params.contactId), context(req)), req.requestId);
});

export const create = asyncHandler(async (req: Request, res: Response) => {
  sendSuccess(res, 201, await contactService.create(req.body, context(req)), req.requestId);
});

export const update = asyncHandler(async (req: Request, res: Response) => {
  sendSuccess(
    res,
    200,
    await contactService.update(String(req.params.contactId), req.body, context(req)),
    req.requestId
  );
});

export const remove = asyncHandler(async (req: Request, res: Response) => {
  await contactService.delete(String(req.params.contactId), context(req));
  sendSuccess(res, 204, null, req.requestId);
});

export const listTags = asyncHandler(async (req: Request, res: Response) => {
  sendSuccess(res, 200, await contactService.listTags(context(req)), req.requestId);
});

export const suggest = asyncHandler(async (req: Request, res: Response) => {
  const q = String(req.query.q ?? "");
  sendSuccess(res, 200, await contactService.suggest(q, context(req)), req.requestId);
});