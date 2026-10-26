/**
 * Corrects the AI policy the seed used to write with its two rules inverted.
 *
 *   Was:  source NOT_EQUALS "restricted_mailbox" → DENY
 *         training_on_customer_data EQUALS false  → DENY
 *   Now:  source EQUALS "restricted_mailbox"     → DENY
 *         training_on_customer_data EQUALS true   → DENY
 *
 * As written, the first rule denied every AI request that was not from a
 * restricted mailbox — that is, all of them — so no AI feature (assistant,
 * extraction, drafting) worked in a workspace carrying it. The policy's own
 * description ("Commitment detection, summarisation and drafting with
 * human-approved send") is what the corrected rules say.
 *
 * Only an ACTIVE AI policy whose rules match the inverted set exactly is
 * touched. A policy is superseded, never edited: the fix is a new version
 * with the corrected rules, the old one is archived, and both steps are in
 * the audit log as a system correction.
 *
 *   npx tsx scripts/fix-inverted-ai-policy.ts            # report only
 *   npx tsx scripts/fix-inverted-ai-policy.ts --apply    # make the change
 */
import type { Prisma } from "@prisma/client";
import { prisma } from "../src/config/prisma.js";
import { withCrossTenant, withTenant } from "../src/config/tenantScope.js";
import { auditService } from "../src/modules/audit/audit.service.js";

const INVERTED = [
  { field: "source", operator: "NOT_EQUALS", value: "restricted_mailbox", effect: "DENY" },
  { field: "training_on_customer_data", operator: "EQUALS", value: false, effect: "DENY" },
];
const CORRECTED = {
  defaultEffect: "ALLOW",
  conditions: [
    { field: "source", operator: "EQUALS", value: "restricted_mailbox", effect: "DENY" },
    { field: "training_on_customer_data", operator: "EQUALS", value: true, effect: "DENY" },
  ],
};

const apply = process.argv.includes("--apply");

type Condition = { field: string; operator: string; value: unknown; effect: string };
// jsonb does not keep key order, so conditions are compared field by field.
const same = (a: Condition, b: Condition) =>
  a.field === b.field && a.operator === b.operator && a.value === b.value && a.effect === b.effect;

function isInverted(rules: unknown): boolean {
  const r = rules as { defaultEffect?: string; conditions?: Condition[] } | null;
  return Boolean(
    r &&
      r.defaultEffect === "ALLOW" &&
      Array.isArray(r.conditions) &&
      r.conditions.length === INVERTED.length &&
      r.conditions.every((c, i) => same(c, INVERTED[i]!))
  );
}

const policies = await withCrossTenant(() =>
  prisma.tenantPolicy.findMany({
    where: { type: "AI", status: "ACTIVE" },
    include: { tenant: { select: { name: true } } },
  })
);
const broken = policies.filter((p) => isInverted(p.rules));

if (broken.length === 0) {
  console.log("No active AI policy has the inverted rules. Nothing to do.");
} else {
  for (const p of broken) {
    console.log(`${apply ? "Correcting" : "Would correct"}: "${p.tenant.name}" — ${p.name} v${p.version}`);
    if (!apply) continue;
    await withTenant(p.tenantId, () =>
      prisma.$transaction(async (tx) => {
        const latest = await tx.tenantPolicy.aggregate({ where: { tenantId: p.tenantId, type: "AI" }, _max: { version: true } });
        await tx.tenantPolicy.update({ where: { id: p.id }, data: { status: "ARCHIVED" } });
        const next = await tx.tenantPolicy.create({
          data: {
            tenantId: p.tenantId,
            type: "AI",
            name: p.name,
            description: p.description,
            version: (latest._max.version ?? p.version) + 1,
            rules: CORRECTED as Prisma.InputJsonValue,
            status: "ACTIVE",
            activatedAt: new Date(),
            // The rules are the original author's, corrected; the audit event says who changed them.
            createdByUserId: p.createdByUserId,
          },
        });
        await auditService.record(
          {
            tenantId: p.tenantId,
            actorType: "SYSTEM",
            eventType: "POLICY_CORRECTED",
            targetType: "TenantPolicy",
            targetId: next.id,
            metadata: {
              reason: "The seeded AI policy's two rules were inverted and denied every AI request.",
              supersededPolicyId: p.id,
              supersededVersion: p.version,
              version: next.version,
              before: p.rules as Prisma.InputJsonValue,
              after: CORRECTED as Prisma.InputJsonValue,
            },
          },
          tx
        );
        console.log(`  now v${next.version} (ACTIVE); v${p.version} archived`);
      })
    );
  }
  if (!apply) console.log("\nRun again with --apply to make the change.");
}

await prisma.$disconnect();
