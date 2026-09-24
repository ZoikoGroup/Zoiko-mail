import { z } from "zod";
import { AppError } from "../errors/AppError.js";
import { ErrorCodes } from "../errors/errorCodes.js";

/**
 * Cursor pagination for list endpoints — API Specification §4.
 *
 * Three admin lists (members, domains, policies) were unbounded `findMany`
 * calls. They are correct and fast on a workspace of twelve people and they
 * degrade silently: nothing fails, the payload simply grows with the customer
 * until a screen that was instant becomes a timeout. There is no error to
 * catch and no log line to find, which is why this is enforced by shape rather
 * than left to judgement.
 *
 * Cursor rather than offset, as §4 requires, and the reason matters for the
 * audit log in particular: offset pagination over a table that is being
 * appended to shifts rows between requests, so page two can repeat a row from
 * page one or skip one entirely. An append-only evidence log is the last place
 * that should happen.
 *
 * The cursor is an opaque base64 id. Opaque because a client that parses it
 * starts depending on the ordering key, and the ordering key is ours to
 * change.
 */

/** What every paginated list returns. `nextCursor` is null on the last page. */
export interface Page<T> {
  items: T[];
  nextCursor: string | null;
}

export function encodeCursor(id: string): string {
  return Buffer.from(id, "utf8").toString("base64url");
}

/** Every id in this schema is a uuid; a cursor that is not one never was ours. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Decode a client-supplied cursor.
 *
 * Two wrong answers to guard against, and they fail in opposite directions.
 *
 * Returning null on garbage would restart at page one, so a client walking a
 * list with a corrupted cursor would loop over the first page forever while
 * believing it was advancing — an infinite list that looks like it works.
 *
 * Passing the garbage through to Prisma is what this did first: an id that
 * decodes to nonsense reaches the database as a cursor for a row that cannot
 * exist, and the driver throws. That surfaced as a 500, which says the server
 * is broken when in fact the request was.
 *
 * So: a cursor is either a uuid we could have issued, or a 400 naming it.
 */
export function decodeCursor(cursor: string | undefined): string | null {
  if (!cursor) return null;
  let id: string;
  try {
    id = Buffer.from(cursor, "base64url").toString("utf8");
  } catch {
    id = "";
  }
  if (!UUID.test(id)) {
    throw new AppError("That pagination cursor is not valid", 400, ErrorCodes.VALIDATION_ERROR, {
      parameter: "cursor",
    });
  }
  return id;
}

/**
 * Turn a limit and cursor into the `take`/`cursor`/`skip` Prisma expects.
 *
 * `take: limit + 1` on purpose: the extra row is never returned, it only
 * answers "is there another page?" without a second count query. A COUNT over
 * a large tenant costs more than the page itself.
 */
export function cursorArgs(limit: number, cursor?: string) {
  const id = decodeCursor(cursor);
  return {
    take: limit + 1,
    ...(id ? { cursor: { id }, skip: 1 } : {}),
  };
}

/**
 * Trim the probe row and report the cursor for the next page.
 *
 * Call with exactly what `cursorArgs` fetched; it assumes the caller asked for
 * one more than it wanted.
 */
export function toPage<T extends { id: string }>(rows: T[], limit: number): Page<T> {
  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;
  return {
    items,
    nextCursor: hasMore && items.length > 0 ? encodeCursor(items[items.length - 1]!.id) : null,
  };
}

/**
 * The query shape every paginated list accepts.
 *
 * `limit` is capped at 200 rather than left open: an unbounded limit is the
 * same unbounded query this file exists to remove, just spelled by the caller.
 * The default of 50 is what the admin screens render without scrolling.
 */
export const paginationQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  cursor: z.string().trim().min(1).max(512).optional(),
});
