import { createHash } from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import { Prisma } from "@prisma/client";
import { prisma } from "../../config/prisma.js";
import { AppError } from "../errors/AppError.js";
import { ErrorCodes } from "../errors/errorCodes.js";

/**
 * The idempotency contract — API §7.
 *
 * "All side-effecting operations must require Idempotency-Key. The API must
 * reject missing idempotency keys for create, update, delete, send, connect,
 * disconnect, export, deletion request, AI job creation, and provider
 * side-effect APIs."
 *
 * Two endpoints took an `idempotencyKey` in their *request body* and fed it to
 * the job queue's own deduplication. Every other write in the product was
 * freely replayable: a retried send sent twice, a retried invitation invited
 * twice. §7 is a header contract with a defined scope, TTL and replay
 * behaviour, and this is that contract.
 *
 * The shape worth explaining is what happens on failure. A request that ends
 * in an error releases its key, so the client can fix the problem and retry
 * with the same one. Only a request that actually succeeded is remembered,
 * because that is the only case where replaying an answer is better than
 * repeating the work — remembering failures would turn a transient 500 into a
 * permanently poisoned key.
 */

/** §7 gives 24 hours from the first accepted request. */
const TTL_MS = 24 * 60 * 60 * 1000;

/**
 * Bounds on the key itself. §7 says client-generated and nothing more; the
 * floor keeps a caller from passing "1" and colliding with themselves, and the
 * ceiling keeps an unbounded header out of the index.
 */
const MIN_KEY_LENGTH = 8;
const MAX_KEY_LENGTH = 200;

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * The endpoint family, which §7 makes part of the scope.
 *
 * The mount path is the family: `/api/v1/mail/drafts/x/send` belongs to
 * `mail`, as does every other mail write. Taken from `baseUrl` rather than the
 * full path deliberately — a family is coarser than a route, so a key reused
 * across two different operations in the same module is caught as a payload
 * mismatch rather than silently accepted as a new operation.
 */
function endpointFamily(req: Request): string {
  const mounted = req.baseUrl || req.originalUrl.split("?")[0] || "/";
  const segments = mounted.split("/").filter(Boolean);
  // Drop the "api" and "v1" prefix segments; what remains starts with the module.
  const meaningful = segments.filter((segment) => segment !== "api" && !/^v\d+$/.test(segment));
  return meaningful[0] ?? "root";
}

/**
 * A stable digest of the request payload.
 *
 * Keys are sorted at every level, so the same body serialised in a different
 * order is the same payload rather than a mismatch — clients do not promise
 * key order, and treating a reordering as a different request would refuse
 * honest retries.
 */
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, entry]) => [key, canonical(entry)])
    );
  }
  return value;
}

function payloadHash(req: Request): string {
  const hash = createHash("sha256");
  hash.update(req.method);
  hash.update("\n");
  // The path is part of the payload identity, not the scope: within one family
  // two different routes are two different payloads, which is the answer §7
  // asks for when a key is reused.
  hash.update(req.originalUrl.split("?")[0]);
  hash.update("\n");
  if (req.is("application/json") && req.body !== undefined) {
    hash.update(JSON.stringify(canonical(req.body) ?? null));
  } else {
    // A multipart upload's body is a stream that has not been read yet, so
    // there is nothing to hash faithfully. The declared length stands in: it
    // distinguishes two different files well enough to catch a reused key,
    // and a replay of the same upload still returns the stored answer.
    hash.update(`${req.headers["content-type"] ?? ""}:${req.headers["content-length"] ?? ""}`);
  }
  return hash.digest("hex");
}

/** Whether the response says the work happened. */
const isSuccess = (status: number) => status >= 200 && status < 300;

export async function idempotency(
  req: Request,
  res: Response,
  next: NextFunction,
  retried = false
): Promise<void> {
  if (SAFE_METHODS.has(req.method)) {
    next();
    return;
  }

  const context = req.tenantContext;
  // No tenant context means this is not a tenant-scoped write — the platform
  // support console, or a route that runs before tenant resolution. §7 scopes
  // records by tenant and actor, so there is nothing to scope them to here.
  if (!context) {
    next();
    return;
  }

  const key = req.header("Idempotency-Key")?.trim();
  if (!key) {
    next(
      new AppError(
        "This operation requires an Idempotency-Key header",
        400,
        ErrorCodes.IDEMPOTENCY_KEY_REQUIRED,
        { header: "Idempotency-Key" }
      )
    );
    return;
  }
  if (key.length < MIN_KEY_LENGTH || key.length > MAX_KEY_LENGTH) {
    next(
      new AppError(
        `Idempotency-Key must be between ${MIN_KEY_LENGTH} and ${MAX_KEY_LENGTH} characters`,
        400,
        ErrorCodes.VALIDATION_ERROR,
        { header: "Idempotency-Key" }
      )
    );
    return;
  }

  const scope = {
    tenantId: context.tenantId,
    actorUserId: context.userId,
    endpointFamily: endpointFamily(req),
    key,
  };
  const requestHash = payloadHash(req);
  const now = new Date();

  let claimed: { id: string } | null = null;
  try {
    claimed = await prisma.idempotencyRecord.create({
      data: { ...scope, requestHash, expiresAt: new Date(now.getTime() + TTL_MS) },
      select: { id: true },
    });
  } catch (error) {
    if (
      !(error instanceof Prisma.PrismaClientKnownRequestError) ||
      error.code !== "P2002"
    ) {
      next(error);
      return;
    }

    const existing = await prisma.idempotencyRecord.findUnique({
      where: { tenantId_actorUserId_endpointFamily_key: scope },
    });

    // Gone between the two queries, or past its TTL. Either way the key is
    // free again: §7's window is 24 hours, not forever.
    if (!existing || existing.expiresAt <= now) {
      if (existing) {
        await prisma.idempotencyRecord.deleteMany({ where: { id: existing.id } });
      }
      // One retry only. If the key is somehow still taken after clearing an
      // expired record, that is a genuine conflict rather than something to
      // spin on.
      if (retried) {
        next(
          new AppError(
            "A request with this Idempotency-Key is still in progress",
            409,
            ErrorCodes.IDEMPOTENCY_REQUEST_IN_PROGRESS,
            { key }
          )
        );
        return;
      }
      idempotency(req, res, next, true).catch(next);
      return;
    }

    if (existing.requestHash !== requestHash) {
      next(
        new AppError(
          "This Idempotency-Key was already used with a different request payload",
          409,
          ErrorCodes.IDEMPOTENCY_PAYLOAD_MISMATCH,
          { key }
        )
      );
      return;
    }

    if (existing.status === "COMPLETED" && existing.responseStatus !== null) {
      // The replay §7 asks for: the original response, said again.
      res.setHeader("Idempotent-Replay", "true");
      res.status(existing.responseStatus).json(existing.responseBody);
      return;
    }

    // Same key, same payload, and the first attempt has not answered yet.
    // Returning the not-yet-existent answer is impossible and running the
    // work twice is the thing being prevented, so the honest answer is to
    // say it is in flight.
    next(
      new AppError(
        "A request with this Idempotency-Key is still in progress",
        409,
        ErrorCodes.IDEMPOTENCY_REQUEST_IN_PROGRESS,
        { key }
      )
    );
    return;
  }

  const recordId = claimed.id;
  const originalJson = res.json.bind(res);
  let settled = false;

  const persist = (status: number, body: unknown) =>
    isSuccess(status)
      ? prisma.idempotencyRecord.update({
          where: { id: recordId },
          data: {
            status: "COMPLETED",
            responseStatus: status,
            responseBody: body as Prisma.InputJsonValue,
          },
        })
      : // Not successful, so the key is released rather than burned: the
        // caller fixes the request and retries with the same key, which is
        // what a client that generated one key per intent will do.
        prisma.idempotencyRecord.deleteMany({ where: { id: recordId } });

  // Captured at the moment the response is written, because that is the only
  // point where both the status and the body are known.
  //
  // Recorded *before* the answer is sent, and this ordering matters: a client
  // that double-submits can have its second request arrive in the moment
  // between the first one answering and the record being updated. Writing
  // afterwards left that window returning "still in progress" for a request
  // that had already finished — a replay that could see the answer exists but
  // not what it was.
  //
  // Deliberately not bounded by a timeout: the statement is a single
  // primary-key write, and if the database is unresponsive the operation this
  // is bookkeeping for has already failed.
  res.json = (body: unknown) => {
    if (settled) return originalJson(body);
    settled = true;
    persist(res.statusCode, body)
      .catch(() => {
        // A bookkeeping failure must not turn a completed operation into an
        // error for the caller. The record then expires on its own.
      })
      .finally(() => originalJson(body));
    return res;
  };

  // A response that never reaches res.json — a stream, or a connection that
  // dropped — would otherwise leave the key claimed for 24 hours.
  res.on("close", () => {
    if (settled) return;
    settled = true;
    prisma.idempotencyRecord
      .deleteMany({ where: { id: recordId, status: "IN_PROGRESS" } })
      .catch(() => {});
  });

  next();
}

/**
 * Drop records past their TTL.
 *
 * Expired records are ignored on read, so this is housekeeping rather than
 * correctness: without it the table grows forever.
 */
export async function purgeExpiredIdempotencyRecords(now = new Date()): Promise<number> {
  const { count } = await prisma.idempotencyRecord.deleteMany({
    where: { expiresAt: { lte: now } },
  });
  return count;
}
