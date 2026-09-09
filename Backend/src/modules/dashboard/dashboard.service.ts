import type { MembershipRole } from "@prisma/client";
import { prisma } from "../../config/prisma.js";
import { AppError } from "../../common/errors/AppError.js";
import { ErrorCodes } from "../../common/errors/errorCodes.js";
import { auditService } from "../audit/audit.service.js";
import { deliveryFailureSummary } from "../mail/mail.service.js";

/**
 * The admin console's opening screen, as one read.
 *
 * The client used to assemble this from seven separate calls, each pulling a
 * whole collection — every member, every mailbox, every domain, every
 * connector — only to take `.length` of it. That is the cost this replaces:
 * the counts are now counts, computed by the database.
 *
 * The reason it was seven calls in the first place was resilience, and that
 * reason was sound: a single aggregate that fails as a unit turns one broken
 * subsystem into a blank page. So every section here is resolved
 * independently and a failure is reported as a named degradation rather than
 * thrown. A caller gets the sections that worked plus the list of those that
 * did not, and renders accordingly. One round trip, still no all-or-nothing.
 */

/**
 * MFA is not implemented. Security AC-002 requires enforcement and Data Model
 * §6.2 specifies `AppUser.mfaEnabled`; neither exists.
 *
 * Reported as unsupported rather than as zero coverage, because those are
 * different facts. Zero coverage reads as a workspace that has neglected to
 * enrol, and invites an admin to go and fix something they have no way to fix.
 * Unsupported says the platform does not offer it yet, which is true.
 *
 * When AC-002 lands this becomes a real count against the new column and the
 * flag goes true. Nothing else on the dashboard has to change.
 */
const MFA_SUPPORTED = false;

/** Sections a caller may see partially. Named so a client can be specific. */
export type DashboardSection =
  | "tenant"
  | "people"
  | "mailboxes"
  | "domains"
  | "connectors"
  | "audit"
  | "deliveryFailures";

const BYTES_PER_GB = 1_000_000_000;

/** Whole gigabytes, the only precision the tiles display. */
function toGb(value: bigint | null | undefined): number {
  return Math.round(Number(value ?? 0n) / BYTES_PER_GB);
}

/**
 * Runs the sections concurrently and separates what worked from what did not.
 *
 * `allSettled` rather than `all`: the whole point of this shape is that a
 * failing section costs the caller that section and nothing else.
 */
async function settleSections<T extends Record<string, () => Promise<unknown>>>(
  sections: T
): Promise<{
  values: { [K in keyof T]: Awaited<ReturnType<T[K]>> | null };
  degraded: string[];
}> {
  const names = Object.keys(sections) as Array<keyof T & string>;
  const settled = await Promise.allSettled(names.map((name) => sections[name]!()));

  const values = {} as { [K in keyof T]: Awaited<ReturnType<T[K]>> | null };
  const degraded: string[] = [];

  settled.forEach((result, index) => {
    const name = names[index]!;
    if (result.status === "fulfilled") {
      values[name] = result.value as Awaited<ReturnType<T[typeof name]>>;
    } else {
      values[name] = null;
      degraded.push(name);
    }
  });

  return { values, degraded };
}

export interface DashboardContext {
  tenantId: string;
  role: MembershipRole;
  /** Trailing window for the delivery-failure count, in hours. */
  windowHours: number;
  /** False when the caller does not hold `audit.read`. */
  canReadAudit: boolean;
}

export class DashboardService {
  async summary(context: DashboardContext) {
    const { tenantId, role, windowHours } = context;

    const { values, degraded } = await settleSections({
      tenant: () =>
        prisma.tenant.findUniqueOrThrow({
          where: { id: tenantId },
          select: { name: true, status: true, planCode: true, timezone: true },
        }),

      // Counts, not collections. `groupBy` on status answers "how many people"
      // and "how many pending invitations" in one pass.
      people: () =>
        prisma.tenantMembership.groupBy({
          by: ["status"],
          where: { tenantId, status: { not: "REMOVED" } },
          _count: { _all: true },
        }),

      mailboxes: () =>
        prisma.$transaction([
          prisma.mailbox.count({ where: { tenantId } }),
          prisma.mailbox.count({ where: { tenantId, sendSuspendedAt: { not: null } } }),
          prisma.mailbox.aggregate({
            where: { tenantId },
            _sum: { storageUsed: true, storageLimit: true },
          }),
        ]),

      domains: () =>
        prisma.$transaction([
          prisma.mailDomain.count({ where: { tenantId } }),
          prisma.mailDomain.count({ where: { tenantId, verificationStatus: "VERIFIED" } }),
        ]),

      connectors: () =>
        prisma.connectedAccount.findMany({
          where: { tenantId },
          select: {
            id: true,
            provider: true,
            email: true,
            status: true,
            lastSyncedAt: true,
            lastErrorCode: true,
            membership: {
              select: {
                user: { select: { email: true, displayName: true } },
              },
            },
          },
          orderBy: [{ status: "asc" }, { lastSyncedAt: "desc" }],
        }),

      // Role-scoped through the audit service rather than queried directly:
      // an Admin's read withholds the Owner-reserved governance categories,
      // and reimplementing that here would have quietly widened it.
      audit: () =>
        context.canReadAudit
          ? auditService.list(tenantId, { page: 1, limit: 6 }, role)
          : Promise.resolve(null),

      deliveryFailures: () => deliveryFailureSummary(tenantId, windowHours),
    });

    // The tenant is the one section with nothing sensible to render without.
    // Everything else degrades to a blank tile; a missing tenant means the
    // workspace itself could not be read.
    if (!values.tenant) {
      throw new AppError("Workspace could not be read", 503, ErrorCodes.INTERNAL_ERROR);
    }

    const peopleRows = values.people ?? [];
    const totalPeople = peopleRows.reduce((sum, row) => sum + row._count._all, 0);
    const invited =
      peopleRows.find((row) => row.status === "INVITED")?._count._all ?? 0;
    const activePeople =
      peopleRows.find((row) => row.status === "ACTIVE")?._count._all ?? 0;

    const [mailboxCount, suspendedMailboxes, storage] = values.mailboxes ?? [
      0,
      0,
      { _sum: { storageUsed: null, storageLimit: null } },
    ];
    const [domainsTotal, domainsVerified] = values.domains ?? [0, 0];
    const connectors = values.connectors ?? [];

    return {
      tenant: {
        name: values.tenant.name,
        planCode: values.tenant.planCode,
        timezone: values.tenant.timezone ?? "UTC",
        status: values.tenant.status,
      },
      counts: {
        people: totalPeople,
        pendingInvitations: invited,
        mailboxes: mailboxCount,
        suspendedMailboxes,
        connectedAccounts: connectors.length,
        connectedGmail: connectors.filter((a) => a.provider === "GMAIL").length,
        connectedMicrosoft: connectors.filter((a) => a.provider === "MICROSOFT_365")
          .length,
        domainsVerified,
        domainsTotal,
        storageUsedGb: toGb(storage._sum.storageUsed),
        storageLimitGb: toGb(storage._sum.storageLimit),
      },
      mfa: {
        supported: MFA_SUPPORTED,
        covered: 0,
        // Only active people could hold a second factor, so an invited row is
        // not counted against coverage.
        total: activePeople,
      },
      deliveryFailures: values.deliveryFailures,
      // Shaped exactly as GET /audit/events and GET /connectors/admin return
      // them, so the client keeps one set of mappers rather than growing a
      // second for the aggregate.
      recentAudit: values.audit?.events ?? [],
      providerSync: connectors.slice(0, 6),
      /**
       * Sections that could not be read. Empty on a healthy request. A client
       * should render the rest and say what is missing rather than treat this
       * as a failed call.
       */
      degraded,
      /** True when the audit section was withheld for lack of `audit.read`. */
      auditWithheld: !context.canReadAudit,
    };
  }
}

export const dashboardService = new DashboardService();
