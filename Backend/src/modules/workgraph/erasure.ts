import type { Prisma } from "@prisma/client";

/**
 * When a member is erased, what they kept to themselves goes with them, and
 * what they shared with the workspace stays.
 *
 * Their private commitments, decisions, workstreams and dependencies are their
 * personal data and are deleted — unless somebody else owns or approves them,
 * in which case that person still needs the record, and it simply loses its
 * author. Anything shared with the workspace is the team's record: it stays,
 * shown as the work of a former member (the database sets its author to NULL).
 *
 * The emails they linked as evidence are in a mailbox that is being erased, so
 * those links go too. Runs inside the erasure transaction.
 */
export async function eraseMemberWork(tx: Prisma.TransactionClient, tenantId: string, membershipId: string): Promise<void> {
  const mineAlone = { tenantId, createdByMembershipId: membershipId, visibility: "PRIVATE" as const };
  const nobodyElse = { OR: [{ ownerMembershipId: membershipId }, { ownerMembershipId: null }] };

  const commitments = await tx.workCommitment.findMany({ where: { ...mineAlone, ...nobodyElse }, select: { id: true } });
  const decisions = await tx.workDecision.findMany({
    where: { ...mineAlone, AND: [nobodyElse, { OR: [{ approverMembershipId: membershipId }, { approverMembershipId: null }] }] },
    select: { id: true },
  });
  const streams = await tx.workStream.findMany({ where: { ...mineAlone, ...nobodyElse }, select: { id: true } });

  // The records themselves (their evidence goes with them; dependencies on them go by cascade).
  const gone = [
    ["COMMITMENT", commitments],
    ["DECISION", decisions],
    ["STREAM", streams],
  ] as const;
  for (const [subjectType, rows] of gone) {
    if (rows.length > 0) await tx.workEvidence.deleteMany({ where: { tenantId, subjectType, subjectId: { in: rows.map((r) => r.id) } } });
  }
  await tx.workCommitment.deleteMany({ where: { tenantId, id: { in: commitments.map((c) => c.id) } } });
  await tx.workDecision.deleteMany({ where: { tenantId, id: { in: decisions.map((d) => d.id) } } });
  await tx.workStream.deleteMany({ where: { tenantId, id: { in: streams.map((s) => s.id) } } });
  await tx.workDependency.deleteMany({ where: { ...mineAlone, ...nobodyElse } });

  // Links to their own mail point at a mailbox that no longer exists.
  await tx.workEvidence.deleteMany({ where: { tenantId, addedByMembershipId: membershipId, kind: "EMAIL" } });
}
