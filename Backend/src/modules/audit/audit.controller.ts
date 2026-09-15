import type { Request, Response } from "express";
import { asyncHandler } from "../../common/middleware/asyncHandler.js";
import { AppError } from "../../common/errors/AppError.js";
import { ErrorCodes } from "../../common/errors/errorCodes.js";
import { sendSuccess } from "../../common/utils/response.js";
import { auditService } from "./audit.service.js";
import type { AuditEventQuery, AuditExportQuery } from "./audit.schema.js";

// The role comes from tenantContext, which re-reads the membership row on every
// request — so a demotion narrows what the caller can read on their next call
// rather than at their next sign-in.
export const list = asyncHandler(async (req: Request, res: Response) => {
  const result = await auditService.list(
    req.tenantContext!.tenantId,
    req.query as unknown as AuditEventQuery,
    req.tenantContext!.role
  );
  sendSuccess(res, 200, result, req.requestId);
});

export const getById = asyncHandler(async (req: Request, res: Response) => {
  const event = await auditService.getById(
    req.tenantContext!.tenantId,
    String(req.params.eventId),
    req.tenantContext!.role
  );
  if (!event) throw new AppError("Audit event not found", 404, ErrorCodes.NOT_FOUND);
  sendSuccess(res, 200, event, req.requestId);
});

/**
 * One CSV field.
 *
 * Quoted whenever it holds a comma, a quote or a newline, with embedded quotes
 * doubled — RFC 4180. A metadata blob routinely contains all three, so an
 * unquoted writer would produce a file that parses into the wrong number of
 * columns exactly when the row is worth reading.
 *
 * The leading apostrophe on a value opening with =, +, - or @ is deliberate.
 * Spreadsheets read those as formulas, and an audit row carries strings a user
 * influenced — a display name, a metadata value. Prefixing makes them inert
 * text rather than something that runs when the file is opened.
 */
function csvField(value: unknown): string {
  if (value === null || value === undefined) return "";
  const raw = value instanceof Date ? value.toISOString() : String(value);
  const guarded = /^[=+\-@]/.test(raw) ? `'${raw}` : raw;
  const mustQuote =
    guarded.includes('"') ||
    guarded.includes(",") ||
    guarded.includes("\n") ||
    guarded.includes("\r");
  return mustQuote ? `"${guarded.replace(/"/g, '""')}"` : guarded;
}

const EXPORT_COLUMNS = [
  "created_at",
  "event_type",
  "actor_email",
  "actor_name",
  "target_type",
  "target_id",
  "request_id",
  "ip_address",
  "user_agent",
  "metadata",
] as const;

/**
 * Download the audit log as CSV, filtered exactly as the screen is.
 *
 * The screen reads one page; this reads everything those same filters match,
 * which is the whole reason to offer it. Rows are written to the response as
 * they are read rather than assembled first, so the size of the answer does
 * not decide the memory ceiling of the process.
 *
 * The export is itself recorded. Someone taking a copy of the audit trail is
 * precisely the kind of act an audit trail exists to remember, and recording
 * it before the first row goes out means an export that fails halfway still
 * left evidence that it was attempted.
 */
export const exportCsv = asyncHandler(async (req: Request, res: Response) => {
  const filters = req.query as unknown as AuditExportQuery;
  const { tenantId, userId, role } = req.tenantContext!;

  await auditService.record({
    tenantId,
    actorUserId: userId,
    eventType: "AUDIT_LOG_EXPORTED",
    targetType: "AuditEvent",
    requestId: req.requestId,
    ipAddress: req.ip ?? null,
    userAgent: req.get("user-agent") ?? null,
    metadata: { filters: { ...filters } },
  });

  const stamp = new Date().toISOString().slice(0, 10);
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="audit-log-${stamp}.csv"`);
  // Rows are produced over time. Without this a proxy may hold the whole
  // response back to compute a length, which is the buffering this avoids.
  res.setHeader("Cache-Control", "no-store");

  // A byte-order mark, so Excel opens this as UTF-8 rather than mangling any
  // non-ASCII display name. Other readers ignore it.
  res.write("﻿");
  res.write(`${EXPORT_COLUMNS.join(",")}\n`);

  for await (const batch of auditService.exportRows(tenantId, filters, role)) {
    let chunk = "";
    for (const event of batch) {
      chunk +=
        [
          csvField(event.createdAt),
          csvField(event.eventType),
          csvField(event.actor?.email),
          csvField(event.actor?.displayName),
          csvField(event.targetType),
          csvField(event.targetId),
          csvField(event.requestId),
          csvField(event.ipAddress),
          csvField(event.userAgent),
          csvField(event.metadata === null ? "" : JSON.stringify(event.metadata)),
        ].join(",") + "\n";
    }
    // Respect back-pressure. Without waiting for drain, a fast database and a
    // slow client would queue the entire export in the socket buffer — the
    // same unbounded memory the batching exists to avoid.
    if (!res.write(chunk)) {
      await new Promise<void>((resolve) => res.once("drain", resolve));
    }
  }

  res.end();
});
