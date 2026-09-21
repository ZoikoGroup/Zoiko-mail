import { describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import { prisma } from "../src/config/prisma.js";
import { authHeader, registerUser, stepUpHeader, type RegisteredUser } from "./helpers.js";
import { REDACTED_SUBJECT } from "../src/modules/support/redaction.js";

const app = createApp();

/**
 * What a support view may show of a restricted mailbox — Runbook §7.
 *
 * §7 asks support views to "prefer metadata, status, error codes, hashes, and
 * excerpts over full content", which on its own does not settle whether a
 * subject line counts. The Data Model spec does: it lists subject as metadata
 * alongside sender, recipient and timestamp, and then narrows it on the
 * column itself —
 *
 *     subject — Subject; may be redacted by policy for restricted mailboxes.
 *
 * So the rule is not "hide subjects from support", which would make delivery
 * triage useless. It is "hide them for restricted mailboxes" — the same set
 * AC-008 keeps away from AI. A mailbox whose owner has turned processing off
 * should not have its subject lines readable on a console the owner never
 * sees.
 *
 * The negative case is asserted as carefully as the positive one. A redaction
 * that also blanked ordinary mailboxes would pass a "is it hidden" test and
 * quietly break the screens support actually works from.
 */

const SUBJECT = "Quarterly payroll summary";

/** A failed message in a mailbox, restricted or not. */
async function failedMessageIn(owner: RegisteredUser, opts: { restricted: boolean }) {
  const mailbox = await prisma.mailbox.create({
    data: {
      tenantId: owner.tenantId,
      membershipId: owner.membershipId,
      address: `redact-${Date.now()}-${Math.random().toString(16).slice(2, 8)}@zoiko.test`,
      // aiEnabled=false is what "restricted" means everywhere else in the
      // product (AC-008), so it is what this reads too.
      aiEnabled: !opts.restricted,
    },
    select: { id: true },
  });

  const message = await prisma.emailMessage.create({
    data: {
      tenantId: owner.tenantId,
      authorUserId: owner.userId,
      subject: SUBJECT,
      fromAddress: "payroll@acme.test",
      fromName: "Payroll",
      status: "FAILED",
      scheduleLastError: "550 mailbox unavailable",
    },
    select: { id: true },
  });

  await prisma.mailboxMessage.create({
    data: { tenantId: owner.tenantId, mailboxId: mailbox.id, messageId: message.id, folder: "INBOX" },
  });

  return { mailboxId: mailbox.id, messageId: message.id };
}

describe("a restricted mailbox keeps its subject lines off the support console", () => {
  it("withholds the subject of a restricted mailbox's failed message", async () => {
    const owner = await registerUser(app, { email: `red-a-${Date.now()}@zoiko.test` });
    await failedMessageIn(owner, { restricted: true });

    const res = await request(app)
      .get("/api/v1/support/overview")
      .set(authHeader(owner.accessToken))
      .expect(200);

    const body = JSON.stringify(res.body.data.issues);
    expect(body).not.toContain(SUBJECT);
    expect(body).toContain(REDACTED_SUBJECT);
  });

  it("still shows the subject for an ordinary mailbox, because triage runs on it", async () => {
    const owner = await registerUser(app, { email: `red-b-${Date.now()}@zoiko.test` });
    await failedMessageIn(owner, { restricted: false });

    const res = await request(app)
      .get("/api/v1/support/overview")
      .set(authHeader(owner.accessToken))
      .expect(200);

    const body = JSON.stringify(res.body.data.issues);
    expect(body).toContain(SUBJECT);
    expect(body).not.toContain(REDACTED_SUBJECT);
  });

  it("keeps the sender and the error, which are what triage needs", async () => {
    const owner = await registerUser(app, { email: `red-c-${Date.now()}@zoiko.test` });
    await failedMessageIn(owner, { restricted: true });

    const res = await request(app)
      .get("/api/v1/support/overview")
      .set(authHeader(owner.accessToken))
      .expect(200);

    const body = JSON.stringify(res.body.data.issues);
    // The spec names sender, recipient and timestamp as metadata without the
    // caveat it puts on subject. Removing them would protect nothing the
    // subject did not already cover and make the view useless.
    expect(body).toContain("payroll@acme.test");
    expect(body).toContain("550 mailbox unavailable");
  });

  it("applies the same rule on the platform console, which spans every workspace", async () => {
    const owner = await registerUser(app, { email: `red-d-${Date.now()}@zoiko.test` });
    const staff = await registerUser(app, { email: `red-staff-${Date.now()}@zoiko.test` });
    await failedMessageIn(owner, { restricted: true });

    await prisma.appUser.update({
      where: { id: staff.userId },
      data: { platformRole: "SUPER_ADMIN" },
    });
    const { platformSignIn } = await import("./helpers.js");
    const token = await platformSignIn(app, staff.email, staff.password, staff.mfaSecret);

    const res = await request(app)
      .get("/api/v1/support/platform/overview")
      .set(authHeader(token))
      .expect(200);

    // Higher stakes here: one restricted mailbox's subject would otherwise be
    // readable by any staff member browsing every workspace at once.
    expect(JSON.stringify(res.body.data)).not.toContain(SUBJECT);
  });
});
