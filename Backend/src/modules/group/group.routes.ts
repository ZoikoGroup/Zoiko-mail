import { Router } from "express";
import { authenticate, requireCapability, requireRole, tenantContext, validate } from "../../common/middleware/index.js";
import { asyncHandler } from "../../common/middleware/asyncHandler.js";
import { sendSuccess } from "../../common/utils/response.js";
import { addGroupMemberSchema, createGroupSchema, groupIdParamsSchema, groupMemberParamsSchema, updateGroupSchema } from "./group.schema.js";
import { groupService } from "./group.service.js";

export const groupRouter = Router();
groupRouter.use(authenticate, tenantContext, requireRole("OWNER", "ADMIN"), requireCapability("workspace.groups.manage"));

groupRouter.get("/", asyncHandler(async (req, res) => {
  sendSuccess(res, 200, { groups: await groupService.list(req.tenantContext!.tenantId) }, req.requestId);
}));
groupRouter.post("/", validate(createGroupSchema), asyncHandler(async (req, res) => {
  sendSuccess(res, 201, await groupService.create(req.body, req.tenantContext!.tenantId, req.tenantContext!.userId), req.requestId);
}));
groupRouter.get("/:groupId", validate(groupIdParamsSchema, "params"), asyncHandler(async (req, res) => {
  sendSuccess(res, 200, await groupService.get(req.tenantContext!.tenantId, String(req.params.groupId)), req.requestId);
}));
groupRouter.get("/:groupId/members", validate(groupIdParamsSchema, "params"), asyncHandler(async (req, res) => {
  sendSuccess(res, 200, { members: await groupService.listMembers(req.tenantContext!.tenantId, String(req.params.groupId)) }, req.requestId);
}));
groupRouter.patch("/:groupId", validate(groupIdParamsSchema, "params"), validate(updateGroupSchema), asyncHandler(async (req, res) => {
  sendSuccess(res, 200, await groupService.update(req.tenantContext!.tenantId, String(req.params.groupId), req.body, req.tenantContext!.userId), req.requestId);
}));
groupRouter.delete("/:groupId", validate(groupIdParamsSchema, "params"), asyncHandler(async (req, res) => {
  sendSuccess(res, 200, await groupService.remove(req.tenantContext!.tenantId, String(req.params.groupId), req.tenantContext!.userId), req.requestId);
}));
groupRouter.post("/:groupId/members", validate(groupIdParamsSchema, "params"), validate(addGroupMemberSchema), asyncHandler(async (req, res) => {
  sendSuccess(res, 201, await groupService.addMember(req.tenantContext!.tenantId, String(req.params.groupId), req.body.membershipId, req.tenantContext!.userId), req.requestId);
}));
groupRouter.delete("/:groupId/members/:membershipId", validate(groupMemberParamsSchema, "params"), asyncHandler(async (req, res) => {
  sendSuccess(res, 200, await groupService.removeMember(req.tenantContext!.tenantId, String(req.params.groupId), String(req.params.membershipId), req.tenantContext!.userId), req.requestId);
}));