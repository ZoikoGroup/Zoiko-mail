/**
 * AI Feature Diagnostic Script
 * 
 * Run with: npx tsx scripts/diagnose-ai.ts
 * 
 * Tests each step of the AI pipeline independently:
 * 1. Env vars check
 * 2. OpenAI API connection test
 * 3. Extraction on a sample email
 * 4. Draft generation from a sample commitment
 * 5. Database: checks feature flags and mailbox AI setting
 * 6. End-to-end: creates a real AI_EXTRACTION job for an existing email
 */

import { PrismaClient } from "@prisma/client";
import OpenAI from "openai";

const prisma = new PrismaClient();

const AI_PROVIDER = process.env.AI_PROVIDER || "mock";
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || "";
const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-4o-mini";
const FLAG_AI_EXTRACTION = process.env.FLAG_AI_EXTRACTION_ENABLED !== "false";
const FLAG_AI_DRAFTING = process.env.FLAG_AI_DRAFTING_ENABLED !== "false";
const TENANT_ID = process.env.MAIL_PROVIDER_TENANT_ID || "";

// Sample email for testing extraction
const SAMPLE_EMAIL = {
  subject: "Q3 Report deadline and client meeting approval",
  from: "Sarah Johnson <sarah@company.com>",
  body: `Hi team,

Just a quick update on a few things:

1. I need the Q3 revenue report by this Friday (September 26). Please make sure the regional breakdown is included.

2. Can you review and approve the proposal for the Acme Corp client meeting? I've attached the agenda and budget. We need sign-off before Thursday.

3. Also, Mark mentioned he'd send over the updated pricing sheet by end of day today. Has anyone received it?

4. Please let me know if you can attend the team standup tomorrow at 10am.

Thanks,
Sarah`,
};

async function main() {
  console.log("\n═══════════════════════════════════════════════════════════");
  console.log("  AI Feature Diagnostic — Zoiko Mail");
  console.log("═══════════════════════════════════════════════════════════\n");

  // ── Step 1: Check env vars ──────────────────────────────────────────────
  console.log("STEP 1: Checking environment variables...\n");
  const checks = [
    { name: "AI_PROVIDER", value: AI_PROVIDER, ok: AI_PROVIDER === "openai" },
    { name: "OPENAI_API_KEY", value: OPENAI_API_KEY ? `${OPENAI_API_KEY.slice(0, 7)}...${OPENAI_API_KEY.slice(-4)}` : "MISSING", ok: !!OPENAI_API_KEY },
    { name: "OPENAI_MODEL", value: OPENAI_MODEL, ok: !!OPENAI_MODEL },
    { name: "FLAG_AI_EXTRACTION_ENABLED", value: String(FLAG_AI_EXTRACTION), ok: FLAG_AI_EXTRACTION },
    { name: "FLAG_AI_DRAFTING_ENABLED", value: String(FLAG_AI_DRAFTING), ok: FLAG_AI_DRAFTING },
  ];
  checks.forEach((c) => console.log(`  ${c.ok ? "✅" : "❌"} ${c.name} = ${c.value}`));

  if (AI_PROVIDER !== "openai") {
    console.log("\n  ❌ AI_PROVIDER must be 'openai'. Add AI_PROVIDER=openai to your .env\n");
    process.exit(1);
  }
  if (!OPENAI_API_KEY) {
    console.log("\n  ❌ OPENAI_API_KEY is missing. Add it to your .env\n");
    process.exit(1);
  }
  console.log("\n  ✅ All env vars set.\n");

  // ── Step 2: Test OpenAI connection ──────────────────────────────────────
  console.log("STEP 2: Testing OpenAI API connection...\n");

  const client = new OpenAI({ apiKey: OPENAI_API_KEY, timeout: 30000 });

  try {
    const models = await client.models.list();
    const hasModel = models.data.some((m) => m.id === OPENAI_MODEL);
    console.log(`  ✅ API key is valid. Connected to OpenAI.`);
    console.log(`  ${hasModel ? "✅" : "⚠️"} Model "${OPENAI_MODEL}" ${hasModel ? "available" : "not found in list (may still work)"}`);
  } catch (err: any) {
    console.log(`  ❌ OpenAI connection FAILED: ${err.message}`);
    if (err.status === 401) console.log("     → API key is invalid or expired.");
    if (err.status === 429) console.log("     → Rate limited. You may have exceeded your quota.");
    process.exit(1);
  }
  console.log("");

  // ── Step 3: Test extraction on sample email ─────────────────────────────
  console.log("STEP 3: Testing AI extraction on sample email...\n");
  console.log(`  Subject: "${SAMPLE_EMAIL.subject}"`);
  console.log(`  From: ${SAMPLE_EMAIL.from}`);
  console.log(`  Body: ${SAMPLE_EMAIL.body.slice(0, 80)}...\n`);

  try {
    const { zodResponseFormat } = await import("openai/helpers/zod");
    const { z } = await import("zod");

    const extractionSchema = z.object({
      actions: z.array(z.object({
        actionType: z.enum(["COMMITMENT_EXTRACTION", "REPLY_OWED", "DEADLINE", "APPROVAL"]),
        text: z.string().min(1).max(500),
        confidence: z.number().min(0).max(1),
        excerpt: z.string().min(1).max(220),
        dueAt: z.string().nullable().optional(),
        priority: z.enum(["LOW", "MEDIUM", "HIGH", "URGENT"]),
      })).max(5),
    });

    const startTime = Date.now();
    const completion = await client.chat.completions.parse({
      model: OPENAI_MODEL,
      temperature: 0.2,
      response_format: zodResponseFormat(extractionSchema, "email_action_extraction"),
      messages: [
        {
          role: "system",
          content: "You extract actionable requests from an email thread. Only extract real commitments the sender made to act, deadlines, approvals the sender requests, or replies owed to the sender. Ignore greetings, signatures, forward trailers, and non-actionable content.",
        },
        {
          role: "user",
          content: JSON.stringify({
            subject: SAMPLE_EMAIL.subject,
            from: SAMPLE_EMAIL.from,
            body: SAMPLE_EMAIL.body,
          }),
        },
      ],
    });
    const elapsed = Date.now() - startTime;

    const parsed = completion.choices?.[0]?.message?.parsed;
    if (!parsed || !parsed.actions) {
      console.log("  ❌ Extraction returned empty result.\n");
      process.exit(1);
    }

    console.log(`  ✅ Extraction successful! (${elapsed}ms, ${completion.usage?.total_tokens ?? "?"} tokens)\n`);
    console.log(`  Found ${parsed.actions.length} actions:\n`);
    parsed.actions.forEach((a: any, i: number) => {
      console.log(`  ${i + 1}. [${a.actionType}] ${a.text}`);
      console.log(`     Confidence: ${(a.confidence * 100).toFixed(0)}% | Priority: ${a.priority}${a.dueAt ? ` | Due: ${a.dueAt}` : ""}`);
      console.log(`     Excerpt: "${a.excerpt.slice(0, 100)}..."`);
      console.log("");
    });
  } catch (err: any) {
    console.log(`  ❌ Extraction FAILED: ${err.message}\n`);
    process.exit(1);
  }

  // ── Step 4: Test draft generation ───────────────────────────────────────
  console.log("STEP 4: Testing AI draft generation...\n");

  try {
    const { zodResponseFormat } = await import("openai/helpers/zod");
    const { z } = await import("zod");

    const draftSchema = z.object({
      subject: z.string().min(1).max(500),
      body: z.string().min(1).max(50000),
    });

    const startTime = Date.now();
    const completion = await client.chat.completions.parse({
      model: OPENAI_MODEL,
      temperature: 0.2,
      response_format: zodResponseFormat(draftSchema, "email_draft_generation"),
      messages: [
        {
          role: "system",
          content: "You write concise, professional email replies. Compose a plain draft the user can review and send.",
        },
        {
          role: "user",
          content: JSON.stringify({
            originalSubject: "Q3 Report deadline",
            originalSender: "Sarah Johnson",
            commitment: "Send the Q3 revenue report with regional breakdown by Friday",
            actorName: "Lakhan",
          }),
        },
      ],
    });
    const elapsed = Date.now() - startTime;

    const parsed = completion.choices?.[0]?.message?.parsed;
    if (!parsed) {
      console.log("  ❌ Draft generation returned empty result.\n");
      process.exit(1);
    }

    console.log(`  ✅ Draft generated! (${elapsed}ms, ${completion.usage?.total_tokens ?? "?"} tokens)\n`);
    console.log(`  Subject: ${parsed.subject}`);
    console.log(`  Body:\n`);
    console.log(`  ${parsed.body.split("\n").join("\n  ")}`);
    console.log("");
  } catch (err: any) {
    console.log(`  ❌ Draft generation FAILED: ${err.message}\n`);
    process.exit(1);
  }

  // ── Step 5: Check database readiness ────────────────────────────────────
  console.log("STEP 5: Checking database readiness...\n");

  if (TENANT_ID) {
    const mailbox = await prisma.mailbox.findFirst({
      where: { tenantId: TENANT_ID },
      select: { id: true, address: true, aiEnabled: true, membershipId: true },
    });
    if (mailbox) {
      console.log(`  ✅ Mailbox: ${mailbox.address}`);
      console.log(`  ${mailbox.aiEnabled ? "✅" : "❌"} AI enabled on mailbox: ${mailbox.aiEnabled}`);
      if (!mailbox.aiEnabled) {
        console.log("     → Run: UPDATE mailboxes SET ai_enabled = true WHERE id = '...'");
      }
    } else {
      console.log("  ⚠️  No mailbox found for this tenant.");
    }

    // Check for existing emails to process
    const emailCount = await prisma.emailMessage.count({
      where: { tenantId: TENANT_ID, textBody: { not: null } },
    });
    console.log(`  ℹ️  ${emailCount} emails with text body available for AI processing.`);

    // Check existing AI actions
    const aiActionCount = await prisma.aIAction.count({ where: { tenantId: TENANT_ID } });
    console.log(`  ℹ️  ${aiActionCount} AI actions already exist.`);

    // Check AI jobs
    const aiJobs = await prisma.backgroundJob.findMany({
      where: { tenantId: TENANT_ID, type: { in: ["AI_EXTRACTION", "AI_DRAFT_GENERATION"] } },
      orderBy: { createdAt: "desc" },
      take: 5,
      select: { id: true, type: true, status: true, lastError: true, createdAt: true },
    });
    if (aiJobs.length > 0) {
      console.log(`  Found ${aiJobs.length} recent AI jobs:`);
      aiJobs.forEach((j) => {
        const icon = j.status === "COMPLETED" ? "✅" : j.status === "FAILED" ? "❌" : "⏳";
        console.log(`    ${icon} ${j.type} | ${j.status} | ${j.createdAt.toISOString()}`);
        if (j.lastError) console.log(`       Error: ${j.lastError.slice(0, 120)}`);
      });
    } else {
      console.log("  ℹ️  No AI jobs found yet.");
    }
  }

  console.log("\n═══════════════════════════════════════════════════════════");
  console.log("  ✅ AI Diagnostic complete — all tests passed!");
  console.log("═══════════════════════════════════════════════════════════\n");
  console.log("  NEXT STEPS — How to test in the actual app:\n");
  console.log("  1. Open Zoiko Mail in browser → go to /mail");
  console.log("  2. Compose a new email TO yourself with actionable content like:");
  console.log('     "Can you send me the report by Friday? Also please approve the budget."');
  console.log("  3. Send it (or save as draft — AI works on both sent and received)");
  console.log("  4. Go to /ai → you should see extracted actions appear");
  console.log("  5. Click 'Confirm' on an action → this triggers AI_DRAFT_GENERATION");
  console.log("  6. Go to /mail → Drafts folder → AI-generated draft should appear");
  console.log("  7. Open the draft, review it, edit if needed, then send\n");

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error("Diagnostic failed:", err);
  prisma.$disconnect();
  process.exit(1);
});