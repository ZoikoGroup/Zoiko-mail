/**
 * SMTP Delivery Diagnostic Script
 * 
 * Run with: npx tsx scripts/diagnose-smtp.ts
 * 
 * This tests each step of the mail delivery pipeline independently
 * so you can see exactly where it breaks.
 */

import { PrismaClient } from "@prisma/client";
import nodemailer from "nodemailer";

const prisma = new PrismaClient();

// ── Config from .env ─────────────────────────────────────────────────────────
const SMTP_HOST = process.env.SMTP_HOST || "smtpout.secureserver.net";
const SMTP_PORT = Number(process.env.SMTP_PORT) || 465;
const SMTP_SECURE = process.env.SMTP_SECURE !== "false";
const USERNAME = process.env.MAIL_PROVIDER_USERNAME || "";
const PASSWORD = process.env.MAIL_PROVIDER_PASSWORD || "";
const FROM_ADDRESS = process.env.MAIL_PROVIDER_FROM_ADDRESS || "";
const TENANT_ID = process.env.MAIL_PROVIDER_TENANT_ID || "";
const MEMBERSHIP_ID = process.env.MAIL_PROVIDER_MEMBERSHIP_ID || "";

// ── Change this to your real email to receive the test ───────────────────────
const TEST_RECIPIENT = process.argv[2] || "";

async function main() {
  console.log("\n═══════════════════════════════════════════════════════════");
  console.log("  SMTP Delivery Diagnostic — Zoiko Mail");
  console.log("═══════════════════════════════════════════════════════════\n");

  if (!TEST_RECIPIENT) {
    console.log("❌ Usage: npx tsx scripts/diagnose-smtp.ts your-email@gmail.com");
    console.log("   Pass a real email address you can check.\n");
    process.exit(1);
  }

  // ── Step 1: Check env vars ──────────────────────────────────────────────
  console.log("STEP 1: Checking environment variables...\n");
  const envChecks = [
    { name: "SMTP_HOST", value: SMTP_HOST },
    { name: "SMTP_PORT", value: SMTP_PORT },
    { name: "SMTP_SECURE", value: SMTP_SECURE },
    { name: "MAIL_PROVIDER_USERNAME", value: USERNAME ? `${USERNAME.slice(0, 5)}...` : "MISSING" },
    { name: "MAIL_PROVIDER_PASSWORD", value: PASSWORD ? "***set***" : "MISSING" },
    { name: "MAIL_PROVIDER_FROM_ADDRESS", value: FROM_ADDRESS || "MISSING" },
    { name: "MAIL_PROVIDER_TENANT_ID", value: TENANT_ID || "MISSING" },
    { name: "MAIL_PROVIDER_MEMBERSHIP_ID", value: MEMBERSHIP_ID || "MISSING" },
  ];
  envChecks.forEach((c) => {
    const ok = c.value && c.value !== "MISSING";
    console.log(`  ${ok ? "✅" : "❌"} ${c.name} = ${c.value}`);
  });

  const missingEnv = envChecks.some((c) => String(c.value) === "MISSING" || !c.value);
  if (missingEnv) {
    console.log("\n❌ Fix the missing env vars above, then re-run.\n");
    process.exit(1);
  }
  console.log("\n  ✅ All env vars present.\n");

  // ── Step 2: Verify tenant + membership exist in DB ──────────────────────
  console.log("STEP 2: Checking database mapping...\n");
  
  const tenant = await prisma.tenant.findUnique({
    where: { id: TENANT_ID },
    select: { id: true, name: true, status: true },
  });
  if (!tenant) {
    console.log(`  ❌ Tenant ${TENANT_ID} not found in database.`);
    console.log("     Run: SELECT id, name FROM tenants; to find the correct ID.\n");
    process.exit(1);
  }
  console.log(`  ✅ Tenant found: "${tenant.name}" (${tenant.status})`);

  const membership = await prisma.tenantMembership.findFirst({
    where: { id: MEMBERSHIP_ID, tenantId: TENANT_ID },
    include: { user: { select: { id: true, email: true, status: true } } },
  });
  if (!membership) {
    console.log(`  ❌ Membership ${MEMBERSHIP_ID} not found in tenant ${TENANT_ID}.`);
    console.log("     Run: SELECT id, user_id FROM tenant_memberships WHERE tenant_id = '...' AND status = 'ACTIVE';");
    process.exit(1);
  }
  console.log(`  ✅ Membership found: ${membership.user.email} (role: ${membership.role}, status: ${membership.status})`);

  if (membership.status !== "ACTIVE") {
    console.log(`  ❌ Membership status is ${membership.status}, needs to be ACTIVE.`);
    process.exit(1);
  }
  if (membership.user.status !== "ACTIVE") {
    console.log(`  ❌ User status is ${membership.user.status}, needs to be ACTIVE.`);
    process.exit(1);
  }

  const mailbox = await prisma.mailbox.findFirst({
    where: { membershipId: MEMBERSHIP_ID, tenantId: TENANT_ID },
    select: { id: true, address: true, sendSuspendedAt: true },
  });
  if (mailbox) {
    console.log(`  ✅ Mailbox found: ${mailbox.address}`);
    if (mailbox.sendSuspendedAt) {
      console.log(`  ⚠️  Mailbox sending is SUSPENDED since ${mailbox.sendSuspendedAt}`);
    }
  } else {
    console.log("  ⚠️  No mailbox yet — will be auto-created on first send.");
  }
  console.log("");

  // ── Step 3: Test raw SMTP connection ────────────────────────────────────
  console.log("STEP 3: Testing SMTP connection...\n");
  
  const transport = nodemailer.createTransport({
    host: SMTP_HOST,
    port: SMTP_PORT,
    secure: SMTP_SECURE,
    auth: USERNAME && PASSWORD ? { user: USERNAME, pass: PASSWORD } : undefined,
    connectionTimeout: 15000,
    greetingTimeout: 15000,
    socketTimeout: 30000,
    ...(SMTP_SECURE ? { tls: { rejectUnauthorized: true, minVersion: "TLSv1.2" } } : {}),
  });

  try {
    await transport.verify();
    console.log("  ✅ SMTP connection successful! Server accepted credentials.\n");
  } catch (err: any) {
    console.log(`  ❌ SMTP connection FAILED: ${err.message}`);
    if (err.code === "EAUTH") {
      console.log("     → Credentials are wrong. Check username/password.");
    } else if (err.code === "ECONNREFUSED") {
      console.log("     → Server refused connection. Check host/port.");
    } else if (err.code === "ESOCKET" || err.code === "ETIMEDOUT") {
      console.log("     → Network timeout. Firewall blocking port 465?");
    }
    console.log("");
    process.exit(1);
  }

  // ── Step 4: Send a real test email ──────────────────────────────────────
  console.log(`STEP 4: Sending test email to ${TEST_RECIPIENT}...\n`);

  try {
    const result = await transport.sendMail({
      from: FROM_ADDRESS,
      to: TEST_RECIPIENT,
      subject: `Zoiko Mail SMTP Test — ${new Date().toISOString()}`,
      text: `This is a test email sent from the Zoiko Mail SMTP diagnostic script.\n\nIf you see this, SMTP delivery is working.\n\nTimestamp: ${new Date().toISOString()}\nFrom: ${FROM_ADDRESS}\nSMTP: ${SMTP_HOST}:${SMTP_PORT}`,
    });

    console.log(`  ✅ Email sent successfully!`);
    console.log(`     Message ID: ${result.messageId}`);
    console.log(`     Accepted: ${result.accepted.join(", ")}`);
    if (result.rejected.length > 0) {
      console.log(`     Rejected: ${result.rejected.join(", ")}`);
    }
    console.log(`\n  👉 Check ${TEST_RECIPIENT}'s inbox (and spam folder) for the test email.\n`);
  } catch (err: any) {
    console.log(`  ❌ Send FAILED: ${err.message}`);
    if (err.responseCode === 550) {
      console.log("     → Recipient rejected. Email address may not exist.");
    } else if (err.responseCode === 553 || err.responseCode === 554) {
      console.log("     → Server rejected the from address. Check MAIL_PROVIDER_FROM_ADDRESS.");
    } else if (err.responseCode === 421) {
      console.log("     → Too many connections or rate limited. Try again later.");
    }
    console.log("");
    process.exit(1);
  }

  // ── Step 5: Check background job poller ─────────────────────────────────
  console.log("STEP 5: Checking background job status...\n");

  const pendingJobs = await prisma.backgroundJob.findMany({
    where: { tenantId: TENANT_ID, type: "SMTP_SEND" },
    orderBy: { createdAt: "desc" },
    take: 5,
    select: { id: true, status: true, lastError: true, attempts: true, createdAt: true },
  });

  if (pendingJobs.length === 0) {
    console.log("  ℹ️  No SMTP_SEND jobs found. This means either:");
    console.log("     - No email has been sent through the app yet");
    console.log("     - All recipients were internal (same tenant) — no SMTP needed");
  } else {
    console.log(`  Found ${pendingJobs.length} recent SMTP_SEND jobs:`);
    pendingJobs.forEach((j) => {
      const icon = j.status === "COMPLETED" ? "✅" : j.status === "FAILED" ? "❌" : "⏳";
      console.log(`  ${icon} ${j.id.slice(0, 8)}... | ${j.status} | attempts: ${j.attempts} | ${j.createdAt.toISOString()}`);
      if (j.lastError) {
        console.log(`     Error: ${j.lastError.slice(0, 150)}`);
      }
    });
  }
  console.log("");

  // ── Step 6: Check if sent emails exist ──────────────────────────────────
  console.log("STEP 6: Checking recent sent messages...\n");

  const sentMessages = await prisma.emailMessage.findMany({
    where: { tenantId: TENANT_ID, status: { in: ["SENT", "SENDING", "FAILED"] } },
    orderBy: { createdAt: "desc" },
    take: 5,
    select: {
      id: true, subject: true, status: true, sentAt: true, scheduleLastError: true,
      recipients: { select: { email: true, type: true, deliveryStatus: true, recipientMembershipId: true } },
    },
  });

  if (sentMessages.length === 0) {
    console.log("  ℹ️  No sent/sending/failed messages found.");
  } else {
    sentMessages.forEach((m) => {
      const icon = m.status === "SENT" ? "✅" : m.status === "FAILED" ? "❌" : "⏳";
      console.log(`  ${icon} "${m.subject}" — ${m.status}`);
      m.recipients.forEach((r) => {
        const isInternal = r.recipientMembershipId !== null;
        console.log(`     ${r.type}: ${r.email} → ${r.deliveryStatus} ${isInternal ? "(INTERNAL)" : "(EXTERNAL)"}`);
      });
      if (m.scheduleLastError) {
        console.log(`     Error: ${m.scheduleLastError.slice(0, 150)}`);
      }
    });
  }

  console.log("\n═══════════════════════════════════════════════════════════");
  console.log("  Diagnostic complete.");
  console.log("═══════════════════════════════════════════════════════════\n");

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error("Diagnostic script failed:", err);
  prisma.$disconnect();
  process.exit(1);
});