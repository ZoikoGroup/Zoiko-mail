import type { Prisma } from "@prisma/client";
import { prisma } from "../../config/prisma.js";

/**
 * Sessions — P1 (ZM-05) account protection.
 *
 * A session is one sign-in: the `sid` its access and refresh tokens share,
 * carried across every refresh. Its refresh-token rows are the record of it.
 * A session is live while one of its rows is unrevoked; ending a session
 * revokes them all, and every workspace request checks the session it names
 * (tenantContext), so ending one takes effect on the next request rather than
 * when its access token happens to expire — S2 §06 "token/session
 * revocation", ZMT-18 "revoked grant → cached views fail".
 */

type Db = Prisma.TransactionClient | typeof prisma;

/**
 * Why a row was revoked, which decides what presenting it again means.
 *
 * Theft signals — the holder had no business keeping the token:
 *  - ROTATED: it was replaced by its successor on refresh.
 *  - LOGOUT: this device signed itself out and discarded the token.
 *
 * Not theft — the session was ended from somewhere else, so the device that
 * holds it legitimately still has it and will present it once (a stale tab):
 * sign-out-everywhere, a device signed out from another, an administrator's
 * containment, a password change ending the other sessions.
 */
export const RevokedReason = {
  ROTATED: "ROTATED",
  LOGOUT: "LOGOUT",
  LOGOUT_ALL: "LOGOUT_ALL",
  SESSION_REVOKED: "SESSION_REVOKED",
  ADMIN_REVOKED: "ADMIN_REVOKED",
  SECURITY_REMEDIATION: "SECURITY_REMEDIATION",
  PASSWORD_CHANGED: "PASSWORD_CHANGED",
} as const;
export type RevokedReason = (typeof RevokedReason)[keyof typeof RevokedReason];

const DELIBERATE: ReadonlySet<string> = new Set<string>([
  RevokedReason.PASSWORD_CHANGED,
  RevokedReason.LOGOUT_ALL,
  RevokedReason.SESSION_REVOKED,
  RevokedReason.ADMIN_REVOKED,
  RevokedReason.SECURITY_REMEDIATION,
]);

/** True when a revoked row was ended on purpose rather than rotated away. */
export function revokedDeliberately(reason: string | null | undefined): boolean {
  return reason != null && DELIBERATE.has(reason);
}

/**
 * LIVE: an unrevoked row exists. REVOKED: rows exist and every one is revoked.
 * UNKNOWN: no row carries this session — written before session binding, or
 * deleted with the account's access (membership removal, an MFA reset). The
 * caller refuses both non-live states; they differ only in whether the client
 * should try a refresh.
 */
export type SessionState = "LIVE" | "REVOKED" | "UNKNOWN";

export async function sessionState(
  sessionId: string,
  userId: string,
  tenantId: string,
  db: Db = prisma
): Promise<SessionState> {
  // One indexed read: an unrevoked row sorts first if there is one.
  const row = await db.refreshToken.findFirst({
    where: { sessionId, userId, tenantId },
    orderBy: { revokedAt: { sort: "asc", nulls: "first" } },
    select: { revokedAt: true },
  });
  if (!row) return "UNKNOWN";
  return row.revokedAt ? "REVOKED" : "LIVE";
}

/**
 * The key a session is addressed by. Rows from before session binding have no
 * session id; each is its own session, keyed by row so it can still be listed
 * and ended. The prefix keeps the two key spaces from ever colliding.
 */
const LEGACY_PREFIX = "row:";

function whereForKey(key: string, userId: string, tenantId: string): Prisma.RefreshTokenWhereInput {
  return key.startsWith(LEGACY_PREFIX)
    ? { id: key.slice(LEGACY_PREFIX.length), sessionId: null, userId, tenantId }
    : { sessionId: key, userId, tenantId };
}

export function isWellFormedSessionKey(key: string): boolean {
  const id = key.startsWith(LEGACY_PREFIX) ? key.slice(LEGACY_PREFIX.length) : key;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
}

export interface SessionSummary {
  key: string;
  deviceLabel: string | null;
  ipAddress: string | null;
  userAgent: string | null;
  /** When this sign-in happened (its first row). */
  signedInAt: Date;
  /** When it last renewed — the live row's issue time. */
  lastActiveAt: Date;
  expiresAt: Date;
  current: boolean;
}

/** The account's live sessions in one workspace, most recently active first. */
export async function listSessions(
  userId: string,
  tenantId: string,
  currentSessionId: string | null,
  db: Db = prisma
): Promise<SessionSummary[]> {
  const live = await db.refreshToken.findMany({
    where: { userId, tenantId, revokedAt: null, expiresAt: { gt: new Date() } },
    select: {
      id: true, sessionId: true, deviceLabel: true, ipAddress: true, userAgent: true,
      lastUsedAt: true, createdAt: true, expiresAt: true,
    },
    orderBy: { createdAt: "desc" },
  });
  const sessionIds = [...new Set(live.map((row) => row.sessionId).filter((id): id is string => id !== null))];
  const firstSeen = sessionIds.length
    ? await db.refreshToken.groupBy({
      by: ["sessionId"],
      where: { userId, tenantId, sessionId: { in: sessionIds } },
      _min: { createdAt: true },
    })
    : [];
  const started = new Map(firstSeen.map((row) => [row.sessionId, row._min.createdAt]));

  // One entry per session: a rotation race can briefly leave two live rows.
  const seen = new Set<string>();
  const sessions: SessionSummary[] = [];
  for (const row of live) {
    const key = row.sessionId ?? `${LEGACY_PREFIX}${row.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    sessions.push({
      key,
      deviceLabel: row.deviceLabel,
      ipAddress: row.ipAddress,
      userAgent: row.userAgent,
      signedInAt: (row.sessionId ? started.get(row.sessionId) : null) ?? row.createdAt,
      lastActiveAt: row.lastUsedAt ?? row.createdAt,
      expiresAt: row.expiresAt,
      current: row.sessionId !== null && row.sessionId === currentSessionId,
    });
  }
  return sessions;
}

/**
 * End one session. Returns how many rows it revoked and whether the session
 * existed at all for this account, so "already ended" (idempotent success) is
 * told apart from "not yours / never existed" (not found).
 */
export async function revokeSession(
  input: { userId: string; tenantId: string; key: string; reason: RevokedReason },
  db: Db = prisma
): Promise<{ existed: boolean; revoked: number }> {
  const where = whereForKey(input.key, input.userId, input.tenantId);
  const revoked = await db.refreshToken.updateMany({
    where: { ...where, revokedAt: null },
    data: { revokedAt: new Date(), revokedReason: input.reason },
  });
  if (revoked.count > 0) return { existed: true, revoked: revoked.count };
  const existed = (await db.refreshToken.count({ where })) > 0;
  return { existed, revoked: 0 };
}

/** End every session an account holds in one workspace. */
export async function revokeAllSessions(
  input: { userId: string; tenantId: string; reason: RevokedReason },
  db: Db = prisma
): Promise<number> {
  const revoked = await db.refreshToken.updateMany({
    where: { userId: input.userId, tenantId: input.tenantId, revokedAt: null },
    data: { revokedAt: new Date(), revokedReason: input.reason },
  });
  return revoked.count;
}
