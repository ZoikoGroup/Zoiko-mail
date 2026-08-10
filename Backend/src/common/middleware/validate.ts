import type { Request, Response, NextFunction } from "express";
import { ZodError, type ZodType } from "zod";
import { AppError } from "../errors/AppError.js";
import { ErrorCodes } from "../errors/errorCodes.js";

type RequestSource = "body" | "query" | "params";

export function validate<T>(schema: ZodType<T>, source: RequestSource = "body") {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const data = req[source];
    const result = schema.safeParse(data);

    if (!result.success) {
      next(formatZodError(result.error));
      return;
    }

    if (source === "query") {
      Object.defineProperty(req, "query", {
        value: result.data,
        configurable: true,
        enumerable: true,
        writable: false,
      });
    } else {
      req[source] = result.data;
    }
    next();
  };
}

function formatZodError(error: ZodError): AppError {
  const details = error.issues.map((issue) => ({
    path: issue.path.join("."),
    message: issue.message,
  }));

  return new AppError(
    "Validation failed",
    400,
    ErrorCodes.VALIDATION_ERROR,
    details
  );
}
