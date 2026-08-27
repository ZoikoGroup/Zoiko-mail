import { PrismaClient, type MembershipRole } from "@prisma/client";
import bcrypt from "bcrypt";
import { createHash, randomBytes } from "node:crypto";
import { env } from "../src/config/env.js";

const prisma = new PrismaClient();

/**
 * Admin Workspace development fixture.
 *
 * Reproduces the counts shown in the Unified Role Prototype so every admin
 * screen renders real data, including the non-happy-path rows (a suspended
 * mailbox, an expiring invitation, a connector needing re-auth, an active
 * support grant). Re-running the seed rebuilds the Acme Corp tenant from
 * scratch; the system tenant is left alone.
 *
 * Deliberately NOT seeded, because the schema cannot express it yet:
 *   - MFA state           needs AppUser.mfaEnabled  (roadmap item 16)
 *   - shared mailboxes    Mailbox.membershipId is @unique (item 78)
 *   - groups              no MailGroup model (item 86)
 *   - failed sends        DeliveryEvent requires an EmailMessage graph (item 80)
 */

const SYSTEM_TENANT_ID = "00000000-0000-4000-8000-000000000000";
const ACME_TENANT_ID = "00000000-0000-4000-8000-0000000000ac";

const GB = 1024 * 1024 * 1024;
const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** Stable uuid-shaped identifiers so fixture IDs survive a reseed. */
function fixtureId(group: string, index: number): string {
  const hex = createHash("sha256").update(`${group}:${index}`).digest("hex");
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    `4${hex.slice(13, 16)}`,
    `8${hex.slice(17, 20)}`,
    hex.slice(20, 32),
  ].join("-");
}

const ago = (ms: number) => new Date(Date.now() - ms);
const ahead = (ms: number) => new Date(Date.now() + ms);

interface PersonSpec {
  name: string;
  local: string;
  role: MembershipRole;
  lastActive: number;
}

/** 14 tenant members: 2 Owner, 1 Admin, 11 Member. */
const PEOPLE: PersonSpec[] = [
  { name: "Alex Sharma", local: "alex", role: "OWNER", lastActive: 2 * MINUTE },
  { name: "Helena Voss", local: "helena", role: "OWNER", lastActive: 1 * HOUR },
  { name: "Devon Blake", local: "devon", role: "ADMIN", lastActive: 9 * MINUTE },
  { name: "Priya Nair", local: "priya", role: "MEMBER", lastActive: 14 * MINUTE },
  { name: "Sam Okafor", local: "sam", role: "MEMBER", lastActive: 3 * DAY },
  { name: "Tomas Cruz", local: "contractor", role: "MEMBER", lastActive: 94 * DAY },
  { name: "Mia Chen", local: "mia", role: "MEMBER", lastActive: 40 * MINUTE },
  { name: "Noah Reed", local: "noah", role: "MEMBER", lastActive: 2 * HOUR },
  { name: "Ivy Patel", local: "ivy", role: "MEMBER", lastActive: 5 * HOUR },
  { name: "Leo Marsh", local: "leo", role: "MEMBER", lastActive: 1 * DAY },
  { name: "Zara Khan", local: "zara", role: "MEMBER", lastActive: 2 * DAY },
  { name: "Owen Diaz", local: "owen", role: "MEMBER", lastActive: 6 * HOUR },
  { name: "Ruby Hart", local: "ruby", role: "MEMBER", lastActive: 30 * MINUTE },
  { name: "Felix Nwosu", local: "felix", role: "MEMBER", lastActive: 8 * HOUR },
];

/** 3 pending invitations, one close to expiry. */
const INVITATIONS: Array<{ local: string; role: MembershipRole; expiresIn: number; sentAgo: number }> = [
  { local: "rob", role: "MEMBER", expiresIn: 20 * HOUR, sentAgo: 2 * DAY },
  { local: "nina", role: "MEMBER", expiresIn: 3 * DAY, sentAgo: 6 * HOUR },
  { local: "ops", role: "ADMIN", expiresIn: 2 * DAY, sentAgo: 1 * DAY },
];

/** 9 connected accounts: 6 Gmail, 3 Microsoft 365, one needing re-auth. */
const CONNECTORS: Array<{ local: string; provider: "GMAIL" | "MICROSOFT_365"; status: "ACTIVE" | "REAUTH_REQUIRED" }> = [
  { local: "alex", provider: "GMAIL", status: "ACTIVE" },
  { local: "helena", provider: "GMAIL", status: "ACTIVE" },
  { local: "devon", provider: "GMAIL", status: "ACTIVE" },
  { local: "priya", provider: "GMAIL", status: "ACTIVE" },
  { local: "mia", provider: "GMAIL", status: "ACTIVE" },
  { local: "noah", provider: "GMAIL", status: "ACTIVE" },
  { local: "sam", provider: "GMAIL", status: "REAUTH_REQUIRED" },
  { local: "ivy", provider: "MICROSOFT_365", status: "ACTIVE" },
  { local: "leo", provider: "MICROSOFT_365", status: "ACTIVE" },
];

async function resetAcmeFixture(): Promise<void> {
  // audit_events is fully append-only (DELETE, UPDATE, TRUNCATE triggers).
  // Temporarily disable all three, re-seed, then re-enable.
  await prisma.$executeRawUnsafe(`ALTER TABLE audit_events DISABLE TRIGGER audit_events_no_delete`);
  await prisma.$executeRawUnsafe(`ALTER TABLE audit_events DISABLE TRIGGER audit_events_no_update`);
  await prisma.$executeRawUnsafe(`ALTER TABLE audit_events DISABLE TRIGGER audit_events_no_truncate`);

  // Deleting the tenant cascades memberships, mailboxes, domains, connectors,
  // audit events, notifications, grants and policies.
  await prisma.tenant.deleteMany({ where: { id: ACME_TENANT_ID } });
  await prisma.appUser.deleteMany({ where: { email: { endsWith: "@acme.test" } } });
  await prisma.appUser.deleteMany({ where: { email: { endsWith: "@zoikosupport.test" } } });

  // Re-enable the triggers.
  await prisma.$executeRawUnsafe(`ALTER TABLE audit_events ENABLE TRIGGER audit_events_no_delete`);
  await prisma.$executeRawUnsafe(`ALTER TABLE audit_events ENABLE TRIGGER audit_events_no_update`);
  await prisma.$executeRawUnsafe(`ALTER TABLE audit_events ENABLE TRIGGER audit_events_no_truncate`);
}

async function main(): Promise<void> {
  const passwordHash = await bcrypt.hash("Password123!", env.BCRYPT_ROUNDS);

  await prisma.tenant.upsert({
    where: { id: SYSTEM_TENANT_ID },
    update: {},
    create: { id: SYSTEM_TENANT_ID, name: "System", status: "ACTIVE", planCode: "system" },
  });

  // ── Billing plans ───────────────────────────────────────────────────────
  // The single source of truth for plan limits. `stripePriceId` is left blank
  // here; operators set it in the DB (or via a Stripe Dashboard sync) so the
  // checkout derives the real Stripe price, never one trusted from the client.
  const plans = [
    { code: "starter", name: "Starter", priceMonthly: 4900, userLimit: 10, mailboxLimit: 10, storageLimitGb: 10 },
    { code: "business_starter", name: "Business Starter", priceMonthly: 14900, userLimit: 25, mailboxLimit: 25, storageLimitGb: 50 },
    { code: "business_pro", name: "Business Pro", priceMonthly: 24900, userLimit: 50, mailboxLimit: 75, storageLimitGb: 100 },
    { code: "enterprise", name: "Enterprise", priceMonthly: 49900, userLimit: 200, mailboxLimit: 200, storageLimitGb: 500 },
  ];
  for (const plan of plans) {
    await prisma.plan.upsert({
      where: { code: plan.code },
      update: { name: plan.name, priceMonthly: plan.priceMonthly, userLimit: plan.userLimit, mailboxLimit: plan.mailboxLimit, storageLimitGb: plan.storageLimitGb, active: true },
      create: { ...plan, active: true },
    });
  }

  await resetAcmeFixture();

  const tenant = await prisma.tenant.create({
    data: {
      id: ACME_TENANT_ID,
      name: "Acme Corp",
      status: "ACTIVE",
      planCode: "business_pro",
      timezone: "Europe/London",
      language: "en",
      allowedDomains: ["acme.test"],
      memberLimit: 25,
    },
  });

  // ── People and memberships ────────────────────────────────────────────
  const membershipByLocal = new Map<string, string>();
  const userByLocal = new Map<string, string>();

  for (const [index, person] of PEOPLE.entries()) {
    const user = await prisma.appUser.create({
      data: {
        id: fixtureId("user", index),
        email: `${person.local}@acme.test`,
        passwordHash,
        displayName: person.name,
        status: "ACTIVE",
        timezone: "Europe/London",
        emailVerifiedAt: ago(30 * DAY),
        lastLoginAt: ago(person.lastActive),
      },
    });
    const membership = await prisma.tenantMembership.create({
      data: {
        id: fixtureId("membership", index),
        tenantId: tenant.id,
        userId: user.id,
        role: person.role,
        status: "ACTIVE",
      },
    });
    membershipByLocal.set(person.local, membership.id);
    userByLocal.set(person.local, user.id);
  }

  // ── Pending invitations ───────────────────────────────────────────────
  for (const [index, invite] of INVITATIONS.entries()) {
    const user = await prisma.appUser.create({
      data: {
        id: fixtureId("invited-user", index),
        email: `${invite.local}@acme.test`,
        passwordHash,
        displayName: invite.local,
        status: "INVITED",
      },
    });
    await prisma.tenantMembership.create({
      data: {
        id: fixtureId("invitation", index),
        tenantId: tenant.id,
        userId: user.id,
        role: invite.role,
        status: "INVITED",
        // Only the hash is stored; the plaintext token is shown once at issue time.
        inviteToken: createHash("sha256").update(randomBytes(48).toString("base64url")).digest("hex"),
        inviteExpiresAt: ahead(invite.expiresIn),
        createdAt: ago(invite.sentAgo),
      },
    });
  }

  // ── Zoiko support actor ───────────────────────────────────────────────
  // Spec says Support holds no membership anywhere, but SupportAccessGrant
  // requires supportMembershipId, so the schema forces one. The Users screen
  // must therefore filter SUPPORT memberships out of the people list.
  const supportUser = await prisma.appUser.create({
    data: {
      id: fixtureId("support-user", 0),
      email: "jordan@zoikosupport.test",
      passwordHash,
      displayName: "Jordan Reyes",
      status: "ACTIVE",
      platformRole: "SUPPORT",
    },
  });
  const supportMembership = await prisma.tenantMembership.create({
    data: {
      id: fixtureId("support-membership", 0),
      tenantId: tenant.id,
      userId: supportUser.id,
      role: "SUPPORT",
      status: "ACTIVE",
    },
  });

  // ── Mailboxes: 11 of a 25 seat cap, one send-suspended ────────────────
  const mailboxLocals = PEOPLE.slice(0, 11).map((p) => p.local);
  const usedStorage = [4.2, 9.8, 6.1, 12.4, 2.7, 18.4, 5.5, 1.1, 7.9, 3.3, 15.2];

  for (const [index, local] of mailboxLocals.entries()) {
    const suspended = local === "contractor";
    await prisma.mailbox.create({
      data: {
        id: fixtureId("mailbox", index),
        tenantId: tenant.id,
        membershipId: membershipByLocal.get(local)!,
        address: `${local}@acme.test`,
        storageUsed: BigInt(Math.round(usedStorage[index]! * GB)),
        storageLimit: BigInt(30 * GB),
        sendSuspendedAt: suspended ? ago(2 * DAY) : null,
        sendSuspensionReason: suspended ? "Repeated hard bounces above pilot threshold" : null,
        bounceCount: suspended ? 14 : 0,
        complaintCount: suspended ? 2 : 0,
        warmupStage: 3,
      },
    });
  }

  // ── Domains ───────────────────────────────────────────────────────────
  await prisma.mailDomain.create({
    data: {
      id: fixtureId("domain", 0),
      tenantId: tenant.id,
      domainName: "acme.test",
      type: "CUSTOM",
      verificationToken: `zoiko-verify-${randomBytes(12).toString("hex")}`,
      verificationStatus: "VERIFIED",
      mxStatus: "VALID",
      spfStatus: "VALID",
      dkimStatus: "VALID",
      dmarcStatus: "VALID",
      firstCheckedAt: ago(30 * DAY),
      lastCheckedAt: ago(1 * HOUR),
      sendingEnabled: true,
      activatedAt: ago(29 * DAY),
    },
  });

  await prisma.mailDomain.create({
    data: {
      id: fixtureId("domain", 1),
      tenantId: tenant.id,
      domainName: "zoikomail.test",
      type: "ZOIKO",
      verificationToken: `zoiko-owned-${randomBytes(12).toString("hex")}`,
      verificationStatus: "VERIFIED",
      mxStatus: "VALID",
      spfStatus: "VALID",
      dkimStatus: "VALID",
      dmarcStatus: "VALID",
      firstCheckedAt: ago(14 * DAY),
      lastCheckedAt: ago(1 * MINUTE),
      sendingEnabled: true,
      activatedAt: ago(14 * DAY),
    },
  });

  // ── Connected accounts ────────────────────────────────────────────────
  for (const [index, connector] of CONNECTORS.entries()) {
    const needsReauth = connector.status === "REAUTH_REQUIRED";
    await prisma.connectedAccount.create({
      data: {
        id: fixtureId("connector", index),
        tenantId: tenant.id,
        membershipId: membershipByLocal.get(connector.local)!,
        userId: userByLocal.get(connector.local)!,
        provider: connector.provider,
        providerAccountId: `${connector.provider.toLowerCase()}-${fixtureId("provider-account", index).slice(0, 18)}`,
        email: `${connector.local}@acme.test`,
        scopes:
          connector.provider === "GMAIL"
            ? ["https://www.googleapis.com/auth/gmail.readonly"]
            : ["Mail.Read", "User.Read"],
        status: connector.status,
        lastSyncedAt: needsReauth ? ago(1 * DAY) : ago(4 * MINUTE),
        lastErrorCode: needsReauth ? "oauth_token_expired" : null,
      },
    });
  }

  // ── Active support grant ──────────────────────────────────────────────
  await prisma.supportAccessGrant.create({
    data: {
      id: fixtureId("grant", 0),
      tenantId: tenant.id,
      supportMembershipId: supportMembership.id,
      approvedByUserId: userByLocal.get("helena")!,
      reason: "Investigating 421 deferrals reported in ticket ZM-4821",
      scopes: ["TENANT_DIAGNOSTICS", "DNS_DIAGNOSTICS", "AUDIT_READ"],
      expiresAt: ahead(2 * HOUR + 47 * MINUTE),
      createdAt: ago(1 * HOUR + 13 * MINUTE),
    },
  });

  // ── Policies ──────────────────────────────────────────────────────────
  const policyCommon = { tenantId: tenant.id, createdByUserId: userByLocal.get("alex")! };

  // AI — ACTIVE
  await prisma.tenantPolicy.create({
    data: {
      ...policyCommon,
      id: fixtureId("policy", 0),
      type: "AI",
      name: "AI Processing Policy",
      description: "Commitment detection, summarisation and drafting with human-approved send.",
      version: 1,
      status: "ACTIVE",
      rules: {
        defaultEffect: "ALLOW",
        conditions: [
          { field: "source", operator: "NOT_EQUALS", value: "restricted_mailbox", effect: "DENY" },
          { field: "training_on_customer_data", operator: "EQUALS", value: false, effect: "DENY" },
        ],
      },
      activatedAt: ago(20 * DAY),
    },
  });

  // AI — DRAFT
  await prisma.tenantPolicy.create({
    data: {
      ...policyCommon,
      id: fixtureId("policy", 1),
      type: "AI",
      name: "AI Data Isolation Policy",
      description: "Restrict AI processing from HR, legal and compliance mailboxes.",
      version: 2,
      status: "DRAFT",
      rules: {
        defaultEffect: "DENY",
        conditions: [
          { field: "mailbox.tags", operator: "IN", value: ["hr", "legal", "compliance"], effect: "DENY" },
        ],
      },
    },
  });

  // SENDING — ACTIVE
  await prisma.tenantPolicy.create({
    data: {
      ...policyCommon,
      id: fixtureId("policy", 2),
      type: "SENDING",
      name: "Sending Policy",
      description: "Rate-limited sending with new-domain warm-up. Autonomous external sending blocked.",
      version: 1,
      status: "ACTIVE",
      rules: {
        defaultEffect: "ALLOW",
        conditions: [
          { field: "sending_type", operator: "EQUALS", value: "autonomous_external", effect: "DENY" },
          { field: "daily_volume", operator: "GREATER_THAN", value: 500, effect: "DENY" },
          { field: "is_new_domain", operator: "EQUALS", value: true, effect: "ALLOW" },
        ],
      },
      activatedAt: ago(20 * DAY),
    },
  });

  // SENDING — DRAFT
  await prisma.tenantPolicy.create({
    data: {
      ...policyCommon,
      id: fixtureId("policy", 3),
      type: "SENDING",
      name: "Template-Based Sending",
      description: "Require admin-approved templates for bulk sends exceeding 100 recipients.",
      version: 2,
      status: "DRAFT",
      rules: {
        defaultEffect: "ALLOW",
        conditions: [
          { field: "recipient_count", operator: "GREATER_THAN_OR_EQUAL", value: 100, effect: "ALLOW" },
          { field: "template_id", operator: "EQUALS", value: null, effect: "DENY" },
        ],
      },
    },
  });

  // RETENTION — ACTIVE
  await prisma.tenantPolicy.create({
    data: {
      ...policyCommon,
      id: fixtureId("policy", 4),
      type: "RETENTION",
      name: "Data Retention Policy",
      description: "Retain sent and received messages for 90 days. Attachments excluded after 30 days.",
      version: 1,
      status: "ACTIVE",
      rules: {
        defaultEffect: "ALLOW",
        conditions: [
          { field: "message.age_days", operator: "GREATER_THAN_OR_EQUAL", value: 90, effect: "DENY" },
          { field: "message.has_attachment", operator: "EQUALS", value: true, effect: "ALLOW" },
        ],
      },
      activatedAt: ago(15 * DAY),
    },
  });

  // DELETION — DRAFT
  await prisma.tenantPolicy.create({
    data: {
      ...policyCommon,
      id: fixtureId("policy", 5),
      type: "DELETION",
      name: "Data Deletion Policy",
      description: "Soft-delete with 30-day grace period. Permanent purge requires owner confirmation.",
      version: 1,
      status: "DRAFT",
      rules: {
        defaultEffect: "ALLOW",
        conditions: [
          { field: "deletion.type", operator: "EQUALS", value: "permanent", effect: "DENY" },
          { field: "deletion.requestor_role", operator: "NOT_EQUALS", value: "OWNER", effect: "DENY" },
        ],
      },
    },
  });

  // ABUSE — ACTIVE
  await prisma.tenantPolicy.create({
    data: {
      ...policyCommon,
      id: fixtureId("policy", 6),
      type: "ABUSE",
      name: "Abuse Detection Policy",
      description: "Flag phishing, spam and rate abuse. Auto-block after 3 consecutive failures.",
      version: 1,
      status: "ACTIVE",
      rules: {
        defaultEffect: "ALLOW",
        conditions: [
          { field: "spam_score", operator: "GREATER_THAN_OR_EQUAL", value: 0.8, effect: "DENY" },
          { field: "consecutive_failures", operator: "GREATER_THAN_OR_EQUAL", value: 3, effect: "DENY" },
          { field: "phishing_detected", operator: "EQUALS", value: true, effect: "DENY" },
        ],
      },
      activatedAt: ago(10 * DAY),
    },
  });

  // ── Audit events ──────────────────────────────────────────────────────
  const auditEvents = [
    {
      eventType: "mailbox_created",
      actorUserId: userByLocal.get("devon")!,
      targetType: "mailbox",
      targetId: fixtureId("mailbox", 0),
      metadata: { address: "billing@acme.test" },
      createdAt: ago(2 * MINUTE),
    },
    {
      eventType: "ai_eligibility_check_passed",
      actorUserId: null,
      targetType: "policy",
      targetId: fixtureId("policy", 0),
      metadata: { actorType: "system" },
      createdAt: ago(9 * MINUTE),
    },
    {
      eventType: "support_access_approved",
      actorUserId: userByLocal.get("helena")!,
      targetType: "support_access_grant",
      targetId: fixtureId("grant", 0),
      metadata: { ticket: "ZM-4821", scope: "read-only" },
      createdAt: ago(1 * HOUR + 13 * MINUTE),
    },
    {
      eventType: "domain_verified",
      actorUserId: userByLocal.get("alex")!,
      targetType: "mail_domain",
      targetId: fixtureId("domain", 0),
      metadata: { domain: "acme.test" },
      createdAt: ago(1 * DAY),
    },
    {
      eventType: "connector_removed",
      actorUserId: userByLocal.get("sam")!,
      targetType: "connected_account",
      targetId: fixtureId("connector", 6),
      metadata: { provider: "gmail" },
      createdAt: ago(2 * DAY),
    },
    {
      eventType: "failed_login",
      actorUserId: null,
      targetType: "app_user",
      targetId: null,
      // Recorded even though the address has no account, per Audit spec.
      metadata: { attempts: 5, email: "unknown@acme.test", outcome: "account_locked" },
      createdAt: ago(2 * DAY),
    },
    {
      eventType: "sending_policy_changed",
      actorUserId: userByLocal.get("alex")!,
      targetType: "tenant_policy",
      targetId: fixtureId("policy", 1),
      metadata: { version: 1 },
      createdAt: ago(20 * DAY),
    },
    {
      eventType: "mailbox_suspended",
      actorUserId: userByLocal.get("devon")!,
      targetType: "mailbox",
      targetId: fixtureId("mailbox", 5),
      metadata: { reason: "bounce_threshold_breached" },
      createdAt: ago(2 * DAY),
    },
  ];

  for (const [index, event] of auditEvents.entries()) {
    await prisma.auditEvent.create({
      data: {
        id: fixtureId("audit", index),
        tenantId: tenant.id,
        requestId: `seed-${index}`,
        ...event,
      },
    });
  }

  // ── Notifications for the Admin ───────────────────────────────────────
  const adminUserId = userByLocal.get("devon")!;
  const notifications = [
    {
      type: "WARNING" as const,
      title: "Failed sends detected",
      body: "3 messages failed from contractor@acme.test in the last 24 hours.",
      linkPath: "/admin/mailboxes",
      createdAt: ago(12 * MINUTE),
    },
    {
      type: "ACTION_REQUIRED" as const,
      title: "Support access opened",
      body: "Jordan Reyes holds a 4 hour read-only grant, approved by H. Voss.",
      linkPath: "/admin/support-access",
      createdAt: ago(1 * HOUR + 13 * MINUTE),
    },
    {
      type: "WARNING" as const,
      title: "Invitation expiring",
      body: "The invitation for rob@acme.test expires tomorrow.",
      linkPath: "/admin/invitations",
      createdAt: ago(8 * HOUR),
    },
    {
      type: "INFO" as const,
      title: "Domain verified",
      body: "acme.test passed DKIM validation.",
      linkPath: "/admin/domains",
      createdAt: ago(1 * DAY),
    },
  ];

  for (const [index, notification] of notifications.entries()) {
    await prisma.notification.create({
      data: {
        id: fixtureId("notification", index),
        tenantId: tenant.id,
        userId: adminUserId,
        ...notification,
      },
    });
  }

  // ── Report ────────────────────────────────────────────────────────────
  const [people, invited, mailboxes, domains, connectors, audits, notes, policies] = await Promise.all([
    prisma.tenantMembership.count({ where: { tenantId: tenant.id, status: "ACTIVE", role: { not: "SUPPORT" } } }),
    prisma.tenantMembership.count({ where: { tenantId: tenant.id, status: "INVITED" } }),
    prisma.mailbox.count({ where: { tenantId: tenant.id } }),
    prisma.mailDomain.count({ where: { tenantId: tenant.id } }),
    prisma.connectedAccount.count({ where: { tenantId: tenant.id } }),
    prisma.auditEvent.count({ where: { tenantId: tenant.id } }),
    prisma.notification.count({ where: { tenantId: tenant.id } }),
    prisma.tenantPolicy.count({ where: { tenantId: tenant.id, status: "ACTIVE" } }),
  ]);

  console.log(`\nSeed completed — ${tenant.name} (${tenant.id})\n`);
  console.log(`  people (excl. support) ${people}/14`);
  console.log(`  pending invitations    ${invited}/3`);
  console.log(`  mailboxes              ${mailboxes}/11  of ${tenant.memberLimit} seats`);
  console.log(`  domains                ${domains}/2`);
  console.log(`  connected accounts     ${connectors}/9  (6 Gmail, 3 Microsoft, 1 re-auth)`);
  console.log(`  audit events           ${audits}/8`);
  console.log(`  notifications          ${notes}/4`);
  console.log(`  active support grants  1  expires in ~2h47m`);
  console.log(`  active policies        ${policies}  (AI, SENDING, RETENTION, ABUSE)`);
  console.log("\n  Logins — password for every seeded user: Password123!");
  console.log("    owner   alex@acme.test");
  console.log("    owner   helena@acme.test");
  console.log("    admin   devon@acme.test");
  console.log("    member  priya@acme.test");
  console.log("    support jordan@zoikosupport.test\n");
  console.log("  Not seeded — the schema cannot express it yet:");
  console.log("    MFA coverage (12/14)   needs AppUser.mfaEnabled       roadmap item 16");
  console.log("    shared mailboxes       Mailbox.membershipId is unique  item 78");
  console.log("    groups (4)             no MailGroup model              item 86");
  console.log("    failed sends (3)       needs an EmailMessage graph     item 80\n");
}

main()
  .catch((error: unknown) => {
    console.error("Seed failed:", error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
