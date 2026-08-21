import { Router } from "express";
import { authenticate, requireCapability, tenantContext, validate } from "../../common/middleware/index.js";
import * as controller from "./audit.controller.js";
import { auditEventParamsSchema, auditEventQuerySchema } from "./audit.schema.js";

const auditRouter = Router();
auditRouter.use(authenticate, tenantContext, requireCapability("audit.read"));
auditRouter.get("/events", validate(auditEventQuerySchema, "query"), controller.list);
auditRouter.get(
  "/events/:eventId",
  validate(auditEventParamsSchema, "params"),
  controller.getById
);

export { auditRouter };
