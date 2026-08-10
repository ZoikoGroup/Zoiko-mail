import { Router } from "express";
import { authenticate, requireRole, tenantContext, validate } from "../../common/middleware/index.js";
import * as controller from "./user.controller.js";
import { updateProfileSchema } from "./user.schema.js";

const userRouter = Router();
userRouter.use(authenticate, tenantContext, requireRole("OWNER", "ADMIN", "MEMBER", "SUPPORT"));
userRouter.get("/me", controller.getMe);
userRouter.patch("/me", validate(updateProfileSchema), controller.updateMe);

export { userRouter };
