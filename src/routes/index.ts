import { Router } from "express";
import { authRouter } from "../modules/auth/auth.routes.js";
import { membershipRouter } from "../modules/membership/membership.routes.js";
import { tenantRouter } from "../modules/tenant/tenant.routes.js";
import { userRouter } from "../modules/user/user.routes.js";
import { auditRouter } from "../modules/audit/audit.routes.js";
import { policyRouter } from "../modules/policy/policy.routes.js";
import { mailRouter } from "../modules/mail/mail.routes.js";
import { messageRouter, threadRouter } from "../modules/message/message.routes.js";
import { domainRouter } from "../modules/domain/domain.routes.js";
import { aiRouter } from "../modules/ai/ai.routes.js";
import { actionRouter } from "../modules/action/action.routes.js";
import { notificationRouter } from "../modules/notification/notification.routes.js";
import { integrationRouter } from "../modules/integration/integration.routes.js";
import { jobRouter } from "../modules/job/job.routes.js";
import { lifecycleRouter } from "../modules/lifecycle/lifecycle.routes.js";
import { supportRouter } from "../modules/support/support.routes.js";

const apiRouter = Router();

apiRouter.use("/auth", authRouter);
apiRouter.use("/membership", membershipRouter);
apiRouter.use("/users", userRouter);
apiRouter.use("/tenants", tenantRouter);
apiRouter.use("/audit", auditRouter);
apiRouter.use("/policies", policyRouter);
apiRouter.use("/mail", mailRouter);
apiRouter.use("/messages", messageRouter);
apiRouter.use("/threads", threadRouter);
apiRouter.use("/domains", domainRouter);
apiRouter.use("/ai", aiRouter);
apiRouter.use("/actions", actionRouter);
apiRouter.use("/notifications", notificationRouter);
apiRouter.use("/integrations", integrationRouter);
apiRouter.use("/jobs", jobRouter);
apiRouter.use("/lifecycle", lifecycleRouter);
apiRouter.use("/support", supportRouter);

export { apiRouter };
