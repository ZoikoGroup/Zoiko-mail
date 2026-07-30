import { Router } from "express";
import { authenticate, requireRole, tenantContext, validate } from "../../common/middleware/index.js";
import * as controller from "./membership.controller.js";
import { acceptInvitationSchema, addMemberSchema, createInvitationSchema, membershipIdParamsSchema, updateMemberSchema } from "./membership.schema.js";

const membershipRouter = Router();

membershipRouter.post(
  "/invitations/accept",
  authenticate,
  validate(acceptInvitationSchema),
  controller.acceptInvitation
);

membershipRouter.use(authenticate, tenantContext, requireRole("ADMIN", "OWNER"));
membershipRouter.get("/members", controller.list);
membershipRouter.post("/members", validate(addMemberSchema), controller.add);
membershipRouter.post(
  "/invitations",
  validate(createInvitationSchema),
  controller.createInvitation
);
membershipRouter.delete(
  "/invitations/:membershipId",
  validate(membershipIdParamsSchema, "params"),
  controller.cancelInvitation
);
membershipRouter.patch(
  "/members/:membershipId",
  validate(membershipIdParamsSchema, "params"),
  validate(updateMemberSchema),
  controller.update
);
membershipRouter.delete(
  "/members/:membershipId",
  validate(membershipIdParamsSchema, "params"),
  controller.remove
);

export { membershipRouter };
