import { Router } from "express";
import { authenticate, requireRole, tenantContext, validate } from "../../common/middleware/index.js";
import * as controller from "./message.controller.js";
import { listMessagesSchema, listThreadsSchema, messageIdParamsSchema, threadIdParamsSchema } from "./message.schema.js";

const messageRouter = Router();
messageRouter.use(authenticate, tenantContext, requireRole("OWNER", "ADMIN", "MEMBER"));
messageRouter.get("/", validate(listMessagesSchema, "query"), controller.list);
messageRouter.get("/:messageId", validate(messageIdParamsSchema, "params"), controller.get);

const threadRouter = Router();
threadRouter.use(authenticate, tenantContext, requireRole("OWNER", "ADMIN", "MEMBER"));
threadRouter.get("/", validate(listThreadsSchema, "query"), controller.listThreads);
threadRouter.get("/:threadId", validate(threadIdParamsSchema, "params"), controller.getThread);

export { messageRouter, threadRouter };
