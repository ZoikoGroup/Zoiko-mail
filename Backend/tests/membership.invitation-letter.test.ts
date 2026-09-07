import { describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import { prisma } from "../src/config/prisma.js";
import { authHeader, registerUser } from "./helpers.js";
import { draftInvitationLetter } from "../src/modules/membership/invitation-letter.js";

const app = createApp();

/**
 * The invitation letter: what it says, and who is allowed to draft or edit it.
 *
 * Drafting is a read of what would be sent, so it must be free of side
 * effects — an admin reading a draft three times must not create an account
 * or an invitation. That is the property most worth pinning down here,
 * because the endpoint looks like a write.
 */
describe("the invitation letter", () => {
  describe("drafting", () => {
    it("greets the invitee by name when a name was given", () => {
      const letter = draftInvitationLetter({
        firstName: "Priya",
        lastName: "Sharma",
        email: "priya@example.com",
        role: "MEMBER",
        workspaceName: "Acme Corp",
        inviterName: "Devon Lee",
        expiresInHours: 72,
      });

      expect(letter.greeting).toBe("Dear Priya Sharma,");
      expect(letter.subject).toContain("Acme Corp");
    });

    it("falls back to a plain hello rather than a placeholder", () => {
      // "Dear there," is worse than not using a name at all, and a literal
      // "Dear {{name}}" reaching a customer is worse still.
      const letter = draftInvitationLetter({
        email: "someone@example.com",
        role: "MEMBER",
        workspaceName: "Acme Corp",
        inviterName: "Devon Lee",
        expiresInHours: 72,
      });

      expect(letter.greeting).toBe("Hello,");
      expect(letter.paragraphs.join(" ")).not.toMatch(/undefined|null|\{\{/);
    });

    it("says what the role will let them do, differently per role", () => {
      const base = {
        firstName: "Priya",
        email: "priya@example.com",
        workspaceName: "Acme Corp",
        inviterName: "Devon Lee",
        expiresInHours: 72,
      } as const;

      const owner = draftInvitationLetter({ ...base, role: "OWNER" });
      const member = draftInvitationLetter({ ...base, role: "MEMBER" });

      // Someone deciding whether to accept should know what they are being
      // given, and an owner invitation is a different proposition entirely.
      expect(owner.paragraphs.join(" ")).toContain("full control");
      expect(member.paragraphs.join(" ")).toContain("own mailbox");
      expect(owner.paragraphs.join(" ")).not.toBe(member.paragraphs.join(" "));
    });

    it("states the expiry in days rather than a raw hour count", () => {
      const letter = draftInvitationLetter({
        firstName: "Priya",
        email: "priya@example.com",
        role: "MEMBER",
        workspaceName: "Acme Corp",
        inviterName: "Devon Lee",
        expiresInHours: 72,
      });

      // 72 hours is accurate but makes the reader do arithmetic.
      expect(letter.paragraphs.join(" ")).toContain("3 days");
    });

    it("tells an unexpected recipient that doing nothing is safe", () => {
      const letter = draftInvitationLetter({
        email: "stranger@example.com",
        role: "MEMBER",
        workspaceName: "Acme Corp",
        inviterName: "Devon Lee",
        expiresInHours: 72,
      });

      expect(letter.paragraphs.join(" ")).toContain("safely ignore");
    });
  });

  describe("previewing over the API", () => {
    it("returns the letter an admin is about to send", async () => {
      const owner = await registerUser(app, {
        email: `letter-owner-${Date.now()}@zoiko.test`,
        tenantName: "Letterhead Ltd",
      });

      const res = await request(app)
        .post("/api/v1/membership/invitations/preview")
        .set(authHeader(owner.accessToken))
        .send({
          email: "priya@example.com",
          role: "MEMBER",
          firstName: "Priya",
          lastName: "Sharma",
        })
        .expect(200);

      expect(res.body.data.letter.greeting).toBe("Dear Priya Sharma,");
      expect(res.body.data.letter.subject).toContain("Letterhead Ltd");
      expect(res.body.data.letter.paragraphs.length).toBeGreaterThan(1);
    });

    it("creates nothing, however many times it is called", async () => {
      const owner = await registerUser(app, {
        email: `letter-noop-${Date.now()}@zoiko.test`,
      });
      const invitee = `preview-only-${Date.now()}@example.com`;

      for (let i = 0; i < 3; i += 1) {
        await request(app)
          .post("/api/v1/membership/invitations/preview")
          .set(authHeader(owner.accessToken))
          .send({ email: invitee, role: "MEMBER", firstName: "Priya" })
          .expect(200);
      }

      // The endpoint is a POST and looks like a write, so this is the
      // property worth asserting: reading a draft must not invite anyone.
      expect(await prisma.appUser.count({ where: { email: invitee } })).toBe(0);
      expect(
        await prisma.tenantMembership.count({
          where: { tenantId: owner.tenantId, status: "INVITED" },
        })
      ).toBe(0);
    });

    it("refuses to draft an invitation the caller could not send", async () => {
      const owner = await registerUser(app, {
        email: `letter-host-${Date.now()}@zoiko.test`,
      });
      const adminEmail = `letter-admin-${Date.now()}@zoiko.test`;
      const admin = await registerUser(app, { email: adminEmail });

      await request(app)
        .post("/api/v1/membership/members")
        .set(authHeader(owner.accessToken))
        .send({ email: adminEmail, role: "ADMIN" })
        .expect(201);

      const asAdmin = await request(app)
        .post("/api/v1/auth/login")
        .send({
          email: adminEmail,
          password: admin.password,
          tenantId: owner.tenantId,
        })
        .expect(200);
      const session = asAdmin.body.data.session ?? asAdmin.body.data;

      // Otherwise previewing becomes a way to probe the role ceiling: an
      // admin learning whether they may invite an owner without trying.
      await request(app)
        .post("/api/v1/membership/invitations/preview")
        .set(authHeader(session.accessToken))
        .send({ email: "boss@example.com", role: "OWNER", firstName: "Boss" })
        .expect(403);
    });
  });

  describe("sending", () => {
    it("names the placeholder account after the invitee, not their email", async () => {
      const owner = await registerUser(app, {
        email: `letter-name-${Date.now()}@zoiko.test`,
      });
      const invitee = `priya-${Date.now()}@example.com`;

      await request(app)
        .post("/api/v1/membership/invitations")
        .set(authHeader(owner.accessToken))
        .send({
          email: invitee,
          role: "MEMBER",
          firstName: "Priya",
          lastName: "Sharma",
        })
        .expect(201);

      // Before this, an invited person appeared everywhere as the local part
      // of their address until they registered.
      const created = await prisma.appUser.findUniqueOrThrow({
        where: { email: invitee },
      });
      expect(created.displayName).toBe("Priya Sharma");
    });

    it("still invites when no name is given", async () => {
      const owner = await registerUser(app, {
        email: `letter-nameless-${Date.now()}@zoiko.test`,
      });
      const invitee = `nameless-${Date.now()}@example.com`;

      // Names are optional on purpose: an invitation with only an address is
      // still a valid invitation, and other callers only know the address.
      await request(app)
        .post("/api/v1/membership/invitations")
        .set(authHeader(owner.accessToken))
        .send({ email: invitee, role: "MEMBER" })
        .expect(201);

      expect(await prisma.appUser.count({ where: { email: invitee } })).toBe(1);
    });

    it("accepts an edited body, and rejects an empty one", async () => {
      const owner = await registerUser(app, {
        email: `letter-edit-${Date.now()}@zoiko.test`,
      });

      await request(app)
        .post("/api/v1/membership/invitations")
        .set(authHeader(owner.accessToken))
        .send({
          email: `edited-${Date.now()}@example.com`,
          role: "MEMBER",
          firstName: "Priya",
          letterBody: ["We would like you to join us.", "Speak soon."],
        })
        .expect(201);

      // A blank paragraph would send an email with an empty line where the
      // letter should be, so the schema refuses it rather than the mailer.
      await request(app)
        .post("/api/v1/membership/invitations")
        .set(authHeader(owner.accessToken))
        .send({
          email: `blank-${Date.now()}@example.com`,
          role: "MEMBER",
          letterBody: ["   "],
        })
        .expect(400);
    });
  });
});
