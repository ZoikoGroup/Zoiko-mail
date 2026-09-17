import { Router } from "express";
import { authenticate, idempotency, requireRole, tenantContext, validate } from "../../common/middleware/index.js";
import * as controller from "./message.controller.js";
import { listMessagesSchema, listThreadsSchema, messageIdParamsSchema, threadIdParamsSchema } from "./message.schema.js";

const messageRouter = Router();
messageRouter.use(authenticate, tenantContext, requireRole("OWNER", "ADMIN", "MEMBER"), idempotency);
messageRouter.get("/", validate(listMessagesSchema, "query"), controller.list);
messageRouter.get("/:messageId", validate(messageIdParamsSchema, "params"), controller.get);

const threadRouter = Router();
threadRouter.use(authenticate, tenantContext, requireRole("OWNER", "ADMIN", "MEMBER"), idempotency);
threadRouter.get("/", validate(listThreadsSchema, "query"), controller.listThreads);
threadRouter.get("/:threadId", validate(threadIdParamsSchema, "params"), controller.getThread);
// §12 lists this under the Participant API, but it hangs off a thread, so it
// lives with the thread routes rather than making /participants own a path
// that starts with a different resource.
threadRouter.get(
  "/:threadId/participants",
  validate(threadIdParamsSchema, "params"),
  controller.listThreadParticipants
);

export { messageRouter, threadRouter };
