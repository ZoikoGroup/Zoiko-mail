/**
 * Check and debug AI jobs
 * 
 * Run with: npx tsx scripts/check-ai-jobs.ts
 */

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  // Check pending AI jobs
  const jobs = await prisma.backgroundJob.findMany({
    where: { type: { in: ["AI_EXTRACTION", "AI_DRAFT_GENERATION"] } },
    orderBy: { createdAt: "desc" },
    take: 10,
    select: {
      id: true,
      type: true,
      status: true,
      attempts: true,
      maxAttempts: true,
      lastError: true,
      lockedAt: true,
      runAt: true,
      createdAt: true,
      payload: true,
    },
  });

  console.log(`\nFound ${jobs.length} AI jobs:\n`);
  jobs.forEach((j) => {
    console.log(`  ${j.status === "COMPLETED" ? "✅" : j.status === "FAILED" ? "❌" : "⏳"} ${j.type}`);
    console.log(`     ID: ${j.id}`);
    console.log(`     Status: ${j.status} | Attempts: ${j.attempts}/${j.maxAttempts}`);
    console.log(`     Created: ${j.createdAt.toISOString()}`);
    console.log(`     RunAt: ${j.runAt.toISOString()}`);
    console.log(`     LockedAt: ${j.lockedAt?.toISOString() ?? "null"}`);
    if (j.lastError) console.log(`     Error: ${j.lastError}`);
    console.log(`     Payload: ${JSON.stringify(j.payload).slice(0, 200)}`);
    console.log("");
  });

  // Check AI actions
  const actions = await prisma.aIAction.findMany({
    orderBy: { createdAt: "desc" },
    take: 10,
    select: {
      id: true,
      actionType: true,
      status: true,
      output: true,
      confidenceScore: true,
      createdAt: true,
    },
  });

  console.log(`Found ${actions.length} AI actions:\n`);
  actions.forEach((a) => {
    console.log(`  ${a.status === "COMPLETED" ? "✅" : a.status === "PENDING" ? "⏳" : "🔵"} ${a.actionType} — ${a.status}`);
    console.log(`     ID: ${a.id}`);
    console.log(`     Confidence: ${a.confidenceScore ?? "null"}`);
    console.log(`     Created: ${a.createdAt.toISOString()}`);
    if (a.output) console.log(`     Output: ${JSON.stringify(a.output).slice(0, 200)}`);
    console.log("");
  });

  // Check if the job poller query would even find these jobs
  const claimable = await prisma.$queryRaw`
    SELECT id, type, status, locked_at, run_at 
    FROM background_jobs 
    WHERE status IN ('PENDING', 'RETRY') 
      AND run_at <= NOW() 
      AND type IN ('AI_EXTRACTION', 'AI_DRAFT_GENERATION')
    ORDER BY run_at ASC 
    LIMIT 5
  `;
  console.log(`Claimable AI jobs (PENDING/RETRY with run_at <= now):`);
  console.log(claimable);
  console.log("");

  await prisma.$disconnect();
}

main().catch(console.error);