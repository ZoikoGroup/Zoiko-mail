import type { NextFunction, Request, Response } from "express";
import multer from "multer";
import { env } from "../../config/env.js";
import { AppError } from "../../common/errors/AppError.js";
import { ErrorCodes } from "../../common/errors/errorCodes.js";
import { checkAttachmentType } from "./attachment-types.js";

const maxMb = Math.round((env.ATTACHMENT_MAX_SIZE_BYTES / (1024 * 1024)) * 10) / 10;

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { files: 1, fileSize: env.ATTACHMENT_MAX_SIZE_BYTES },
  // Filenames as UTF-8. multer's default reads them as Latin-1, which turned
  // "résumé.pdf" into "rÃ©sumÃ©.pdf" on the way in.
  defParamCharset: "utf8",
  fileFilter: (_req, file, callback) => {
    const check = checkAttachmentType(file.originalname, file.mimetype);
    if (!check.ok) {
      callback(new AppError(check.reason, 415, ErrorCodes.VALIDATION_ERROR, { fileName: file.originalname }));
      return;
    }
    // Stored, previewed and sent on as what the file actually is, not what
    // the uploading browser guessed.
    file.mimetype = check.contentType;
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
      next(new AppError(`Attachments can be up to ${maxMb} MB each.`, 413, ErrorCodes.VALIDATION_ERROR, { maxBytes: env.ATTACHMENT_MAX_SIZE_BYTES }));
      return;
    }
    next(error);
  });
}
