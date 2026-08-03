import type { NextFunction, Request, Response } from "express";
import multer from "multer";
import { env } from "../../config/env.js";
import { AppError } from "../../common/errors/AppError.js";
import { ErrorCodes } from "../../common/errors/errorCodes.js";

const allowedMimeTypes = new Set([
  "application/pdf",
  "application/zip",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "image/gif",
  "image/jpeg",
  "image/png",
  "text/csv",
  "text/plain",
]);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { files: 1, fileSize: env.ATTACHMENT_MAX_SIZE_BYTES },
  fileFilter: (_req, file, callback) => {
    if (!allowedMimeTypes.has(file.mimetype)) {
      callback(new AppError("Attachment file type is not allowed", 415, ErrorCodes.VALIDATION_ERROR));
      return;
    }
    callback(null, true);
  },
}).single("file");

export function attachmentUpload(req: Request, res: Response, next: NextFunction) {
  upload(req, res, (error) => {
    if (!error) {
      if (!req.file) {
        next(new AppError("Attachment file is required", 400, ErrorCodes.VALIDATION_ERROR));
        return;
      }
      next();
      return;
    }
    if (error instanceof multer.MulterError && error.code === "LIMIT_FILE_SIZE") {
      next(new AppError("Attachment exceeds the maximum file size", 413, ErrorCodes.VALIDATION_ERROR));
      return;
    }
    next(error);
  });
}
