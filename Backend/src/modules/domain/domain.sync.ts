import { prisma } from "../../config/prisma.js";
import { env } from "../../config/env.js";
import { logger } from "../../config/logger.js";
import { withCrossTenant, withTenant } from "../../config/tenantScope.js";
import { domainService } from "./domain.service.js";

/**
 * The background half of DNS management: every domain whose `next_check_at`
 * has passed is synchronized — records reconciled, published, verified, and
 * its status moved on — and rescheduled by the lifecycle rules.
 *
 * Claiming bumps `next_check_at` forward by a lease inside the same
 * statement, under FOR UPDATE SKIP LOCKED, so several API instances can run
 * this at once without two of them checking the same domain. If an instance
 * dies mid-check, the lease expires and another picks the domain up.
 */

const LEASE_MINUTES = 10;

export interface SyncRunResult {
  claimed: number;
  synchronized: number;
  failed: number;
}

export async function claimDueDomains(limit: number): Promise<Array<{ id: string; tenantId: string }>> {
  // Claiming spans every workspace, which the row-level policies refuse by
  // default; the scope is declared rather than assumed (AC-004).
  return withCrossTenant(() => prisma.$queryRaw<Array<{ id: string; tenantId: string }>>`
    UPDATE "mail_domains"
    SET "next_check_at" = CURRENT_TIMESTAMP + (${LEASE_MINUTES} * INTERVAL '1 minute')
    WHERE "id" IN (
      SELECT "id" FROM "mail_domains"
      WHERE "type" = 'CUSTOM' AND "next_check_at" IS NOT NULL AND "next_check_at" <= CURRENT_TIMESTAMP
      ORDER BY "next_check_at"
      LIMIT ${limit}
      FOR UPDATE SKIP LOCKED
    )
    RETURNING "id", "tenant_id" AS "tenantId"`);
}

export async function runDueDomainSyncs(limit = env.DNS_SYNC_BATCH_SIZE): Promise<SyncRunResult> {
  const due = await claimDueDomains(limit);
  let synchronized = 0;
  let failed = 0;
  for (const domain of due) {
    try {
      // Each domain runs in its own workspace scope, so its audit rows and
      // notifications pass the same policies a request's would.
      await withTenant(domain.tenantId, () => domainService.synchronize(domain.id, domain.tenantId, { trigger: "SCHEDULED" }));
      synchronized += 1;
    } catch (error) {
      failed += 1;
      const message = error instanceof Error ? error.message : "Domain synchronization failed";
      logger.warn({ error, domainId: domain.id }, "Domain DNS synchronization failed");
      // The lease already pushed the next attempt out; record why.
      await withTenant(domain.tenantId, () => prisma.mailDomain.updateMany({
        where: { id: domain.id, tenantId: domain.tenantId },
        data: { lastSyncError: message.slice(0, 1000), nextCheckAt: new Date(Date.now() + 5 * 60_000) },
      })).catch(() => undefined);
    }
  }
  return { claimed: due.length, synchronized, failed };
}
