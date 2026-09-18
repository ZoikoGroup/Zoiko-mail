import { Router } from "express";
import { authenticate, idempotency, requireCapability, tenantContext, validate } from "../../common/middleware/index.js";
import * as controller from "./audit.controller.js";
import {
  auditEventParamsSchema,
  auditEventQuerySchema,
  auditExportQuerySchema,
} from "./audit.schema.js";

const auditRouter = Router();
auditRouter.use(authenticate, tenantContext, requireCapability("audit.read"), idempotency);
auditRouter.get("/events", validate(auditEventQuerySchema, "query"), controller.list);
// Declared before /events/:eventId so "export" is never read as an id.
auditRouter.get(
  "/events/export",
  validate(auditExportQuerySchema, "query"),
  controller.exportCsv
);
auditRouter.get(
  "/events/:eventId",
  validate(auditEventParamsSchema, "params"),
  controller.getById
);

export { auditRouter };
