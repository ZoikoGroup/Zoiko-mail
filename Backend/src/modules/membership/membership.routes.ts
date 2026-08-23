import { Router } from "express";
import { authenticate, requireCapability, tenantContext, validate } from "../../common/middleware/index.js";
import * as controller from "./membership.controller.js";
import { acceptInvitationSchema, addMemberSchema, createInvitationSchema, membershipIdParamsSchema, updateMemberSchema } from "./membership.schema.js";

const membershipRouter = Router();

membershipRouter.post(
  "/invitations/accept",
  authenticate,
  validate(acceptInvitationSchema),
  controller.acceptInvitation
);

// Reading the roster is the floor for this router; each mutation then names
// the capability it actually needs. Gating writes at the same level as reads
// is what makes a role check feel like a permission model without being one.
membershipRouter.use(authenticate, tenantContext, requireCapability("people.read"));

membershipRouter.get("/members", controller.list);

membershipRouter.post(
  "/members",
  requireCapability("people.member.manage"),
  validate(addMemberSchema),
  controller.add
);
membershipRouter.post(
  "/invitations",
  requireCapability("people.invite.member"),
  validate(createInvitationSchema),
  controller.createInvitation
);
membershipRouter.delete(
  "/invitations/:membershipId",
  requireCapability("people.invite.member"),
  validate(membershipIdParamsSchema, "params"),
  controller.cancelInvitation
);

// The capability gate is deliberately the *floor*, not the whole check. It
// establishes that the caller may manage members at all; the service still
// applies the admin boundary, which is what refuses an Admin acting on an
// Owner. Escalation is a property of the target row, not of the route.
membershipRouter.patch(
  "/members/:membershipId",
  requireCapability("people.member.manage"),
  validate(membershipIdParamsSchema, "params"),
  validate(updateMemberSchema),
  controller.update
);
membershipRouter.delete(
  "/members/:membershipId",
  requireCapability("people.member.manage"),
  validate(membershipIdParamsSchema, "params"),
  controller.remove
);

export { membershipRouter };
