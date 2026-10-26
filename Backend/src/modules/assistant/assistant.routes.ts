import { Router, type NextFunction, type Request, type Response } from "express";
import rateLimit from "express-rate-limit";
import multer from "multer";
import { AppError } from "../../common/errors/AppError.js";
import { ErrorCodes } from "../../common/errors/errorCodes.js";
import { env } from "../../config/env.js";
import { asyncHandler } from "../../common/middleware/asyncHandler.js";
import { idempotency, requireCapability, validate } from "../../common/middleware/index.js";
import { sendSuccess } from "../../common/utils/response.js";
import { assistantService } from "./assistant.service.js";
import { attachmentIdParamsSchema, conversationIdParamsSchema, renameConversationSchema, sendMessageSchema } from "./assistant.schema.js";

export const assistantRouter = Router();

function context(req: Request) {
  const tenant = req.tenantContext!;
  return {
    tenantId: tenant.tenantId,
    userId: tenant.userId,
    membershipId: tenant.membershipId,
    role: tenant.role,
    requestId: req.requestId,
    ipAddress: req.ip ?? null,
    userAgent: req.header("user-agent") ?? null,
  };
}

// Each question costs a call to the model, so each person has a budget per
// minute, counted per membership rather than per IP address.
const askLimit = rateLimit({
  windowMs: 60_000,
  limit: env.ASSISTANT_RATE_LIMIT_PER_MINUTE,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => `assistant:${req.tenantContext?.membershipId ?? "anonymous"}`,
  handler: (req, res) => {
    res.status(429).json({
      success: false,
      error: { code: "RATE_LIMIT_EXCEEDED", message: "You're asking very quickly. Wait a minute and try again." },
      requestId: req.requestId,
    });
  },
});

// Files are held in memory while they are checked and read: a document's
// bytes never reach the disk, and an image is written only once it passes.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { files: 1, fileSize: env.ASSISTANT_ATTACHMENT_MAX_BYTES },
  defParamCharset: "utf8",
}).single("file");

function receiveFile(req: Request, res: Response, next: NextFunction) {
  upload(req, res, (error) => {
    if (error instanceof multer.MulterError && error.code === "LIMIT_FILE_SIZE") {
      next(new AppError(`Files can be up to ${Math.round(env.ASSISTANT_ATTACHMENT_MAX_BYTES / (1024 * 1024))} MB.`, 413, ErrorCodes.VALIDATION_ERROR));
      return;
    }
    if (error) {
      next(error instanceof multer.MulterError ? new AppError("Attach one file at a time.", 400, ErrorCodes.VALIDATION_ERROR) : error);
      return;
    }
    if (!req.file) {
      next(new AppError("Choose a file to attach.", 400, ErrorCodes.VALIDATION_ERROR));
      return;
    }
    next();
  });
}

const uploadLimit = rateLimit({
  windowMs: 60_000,
  limit: env.ASSISTANT_RATE_LIMIT_PER_MINUTE * 2,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => `assistant-upload:${req.tenantContext?.membershipId ?? "anonymous"}`,
  handler: (req, res) => {
    res.status(429).json({
      success: false,
      error: { code: "RATE_LIMIT_EXCEEDED", message: "You're attaching files very quickly. Wait a minute and try again." },
      requestId: req.requestId,
    });
  },
});

// One's own work, like one's mail; authenticate and tenantContext are applied
// where the router is mounted. Every write is idempotent, so a retried
// question is answered (and paid for) once.
assistantRouter.use(requireCapability("mail.own.rw"), idempotency);

assistantRouter.get(
  "/conversations",
  asyncHandler(async (req: Request, res: Response) => {
    sendSuccess(res, 200, await assistantService.listConversations(context(req)), req.requestId);
  })
);

assistantRouter.get(
  "/conversations/:conversationId",
  validate(conversationIdParamsSchema, "params"),
  asyncHandler(async (req: Request, res: Response) => {
    sendSuccess(res, 200, await assistantService.getConversation(String(req.params.conversationId), context(req)), req.requestId);
  })
);

assistantRouter.patch(
  "/conversations/:conversationId",
  validate(conversationIdParamsSchema, "params"),
  validate(renameConversationSchema),
  asyncHandler(async (req: Request, res: Response) => {
    sendSuccess(res, 200, await assistantService.rename(String(req.params.conversationId), req.body.title, context(req)), req.requestId);
  })
);

assistantRouter.delete(
  "/conversations/:conversationId",
  validate(conversationIdParamsSchema, "params"),
  asyncHandler(async (req: Request, res: Response) => {
    await assistantService.delete(String(req.params.conversationId), context(req));
    sendSuccess(res, 204, null, req.requestId);
  })
);

assistantRouter.post(
  "/messages",
  askLimit,
  validate(sendMessageSchema),
  asyncHandler(async (req: Request, res: Response) => {
    sendSuccess(res, 200, await assistantService.send(req.body, context(req)), req.requestId);
  })
);

assistantRouter.post(
  "/attachments",
  uploadLimit,
  receiveFile,
  asyncHandler(async (req: Request, res: Response) => {
    sendSuccess(res, 201, await assistantService.upload(req.file!, context(req)), req.requestId);
  })
);

assistantRouter.delete(
  "/attachments/:attachmentId",
  validate(attachmentIdParamsSchema, "params"),
  asyncHandler(async (req: Request, res: Response) => {
    await assistantService.removeUpload(String(req.params.attachmentId), context(req));
    sendSuccess(res, 204, null, req.requestId);
  })
);

// The image itself, for its thumbnail in the chat. Served as an attachment
// with no sniffing, so it can only ever be shown as the image it was checked to be.
assistantRouter.get(
  "/attachments/:attachmentId/content",
  validate(attachmentIdParamsSchema, "params"),
  asyncHandler(async (req: Request, res: Response) => {
    const image = await assistantService.readImage(String(req.params.attachmentId), context(req));
    res.setHeader("Content-Type", image.contentType);
    res.setHeader("Content-Length", String(image.data.length));
    res.setHeader("Content-Disposition", `inline; filename*=UTF-8''${encodeURIComponent(image.fileName)}`);
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Cache-Control", "private, max-age=3600");
    res.status(200).end(image.data);
  })
);
