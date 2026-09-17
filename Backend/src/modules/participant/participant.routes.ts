import { Router } from "express";
import { z } from "zod";
import {
  authenticate,
  idempotency,
  requireRole,
  tenantContext,
  validate,
} from "../../common/middleware/index.js";
import { asyncHandler } from "../../common/middleware/asyncHandler.js";
import { sendSuccess } from "../../common/utils/response.js";
import { participantService } from "./participant.service.js";

/**
 * The Participant API — §12.
 *
 * "Commitments must never expose opaque participant IDs without a resolution
 * path. Clients may either use embedded participant summaries or fetch
 * participant details." Both halves are served: summaries are inlined where
 * participants appear, and these endpoints are the resolution path.
 *
 * Member-level throughout. A participant is an address the workspace has
 * already corresponded with, so the directory tells a member nothing their
 * own mail does not — and the thread and commitment reads below stay
 * metadata-only, so this cannot become a way to read mail by asking about
 * the person instead of the message (AC-011).
 */
export const participantRouter = Router();

participantRouter.use(
  authenticate,
  tenantContext,
  requireRole("OWNER", "ADMIN", "MEMBER"),
  idempotency
);

const pagination = {
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(25),
};

const listQuery = z.object({
  q: z.string().trim().min(1).max(200).optional(),
  type: z
    .enum(["INTERNAL_USER", "EXTERNAL_PERSON", "GROUP_ADDRESS", "SYSTEM", "UNKNOWN"])
    .optional(),
  ...pagination,
});
const pageQuery = z.object(pagination);
const participantParams = z.object({ participantId: z.string().uuid() });

participantRouter.get(
  "/",
  validate(listQuery, "query"),
  asyncHandler(async (req, res) => {
    const result = await participantService.list(
      req.tenantContext!.tenantId,
      req.query as unknown as z.infer<typeof listQuery>
    );
    sendSuccess(res, 200, result, req.requestId);
  })
);

participantRouter.get(
  "/:participantId",
  validate(participantParams, "params"),
  asyncHandler(async (req, res) => {
    const result = await participantService.get(
      req.tenantContext!.tenantId,
      String(req.params.participantId)
    );
    sendSuccess(res, 200, result, req.requestId);
  })
);

participantRouter.get(
  "/:participantId/threads",
  validate(participantParams, "params"),
  validate(pageQuery, "query"),
  asyncHandler(async (req, res) => {
    const result = await participantService.listThreads(
      req.tenantContext!.tenantId,
      String(req.params.participantId),
      req.query as unknown as z.infer<typeof pageQuery>
    );
    sendSuccess(res, 200, result, req.requestId);
  })
);

participantRouter.get(
  "/:participantId/commitments",
  validate(participantParams, "params"),
  validate(pageQuery, "query"),
  asyncHandler(async (req, res) => {
    const result = await participantService.listCommitments(
      req.tenantContext!.tenantId,
      String(req.params.participantId),
      req.query as unknown as z.infer<typeof pageQuery>
    );
    sendSuccess(res, 200, result, req.requestId);
  })
);
