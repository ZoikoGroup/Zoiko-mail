import type { Response } from "express";

export interface ApiSuccessResponse<T> {
  success: true;
  data: T;
  requestId?: string;
}

export interface ApiErrorResponse {
  success: false;
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
  requestId?: string;
}

export function sendSuccess<T>(
  res: Response,
  statusCode: number,
  data: T,
  requestId?: string
): Response {
  const body: ApiSuccessResponse<T> = {
    success: true,
    data,
  };

  if (requestId) {
    body.requestId = requestId;
  }

  return res.status(statusCode).json(body);
}
