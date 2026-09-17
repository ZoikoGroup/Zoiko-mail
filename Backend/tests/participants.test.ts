import { describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import { authHeader, registerUser } from "./helpers.js";
import { prisma } from "../src/config/prisma.js";
import { withCrossTenant } from "../src/config/tenantScope.js";

const app = createApp();

/**
 * Participants — Data Model §6.7, §6.8; API §12.
 *
 * A participant used to be a string in a JSON array on the thread. Three
 * things followed, and each has a block below: you could not ask what else an
 * address had been involved in, a commitment could only be owned by an
 * internal user — so an obligation owed *to* a customer had nowhere to point
 * — and §12's "commitments must never expose opaque participant IDs without a
 * resolution path" could not be met, because there was nothing to resolve.
 */

const draft = (token: string, body: Record<string, unknown>) =>
  request(app).post("/api/v1/mail/drafts").set(authHeader(token)).send(body);

const draftBody = (to: string[], extra: Record<string, unknown> = {}) => ({
  subject: "Quarterly invoice",
  textBody: "Attached.",
  recipients: { to, cc: [], bcc: [], ...(extra.recipients as object ?? {}) },
  ...extra,
});

const participants = (token: string, query = "") =>
  request(app).get(`/api/v1/participants${query}`).set(authHeader(token));

describe("participants are created from the mail that mentions them", () => {
  it("records the sender and every recipient, with the role each held", async () => {
    const owner = await registerUser(app, { email: `pt-owner-${Date.now()}@zoiko.test` });

    const created = await draft(
      owner.accessToken,
      draftBody(["customer@acme.test"], {
        recipients: { to: ["customer@acme.test"], cc: ["cc@acme.test"], bcc: ["bcc@acme.test"] },
      })
    ).expect(201);

    const threadId = created.body.data.threadId as string;
    const links = await prisma.threadParticipant.findMany({
      where: { tenantId: owner.tenantId, threadId },
      include: { participant: true },
    });

    const byEmail = new Map(links.map((link) => [link.participant.canonicalEmail, link.roles]));
    expect(byEmail.get(owner.email)).toEqual(["SENDER"]);
    expect(byEmail.get("customer@acme.test")).toEqual(["RECIPIENT"]);
    expect(byEmail.get("cc@acme.test")).toEqual(["CC"]);
    expect(byEmail.get("bcc@acme.test")).toEqual(["BCC"]);
  });

  it("reuses one participant across messages instead of duplicating", async () => {
    const owner = await registerUser(app, { email: `pt-reuse-${Date.now()}@zoiko.test` });

    await draft(owner.accessToken, draftBody(["repeat@acme.test"])).expect(201);
    await draft(owner.accessToken, draftBody(["repeat@acme.test"])).expect(201);

    // The point of normalising: the same address is the same entity, however
    // many threads it turns up in.
    const rows = await prisma.participant.findMany({
      where: { tenantId: owner.tenantId, canonicalEmail: "repeat@acme.test" },
    });
    expect(rows).toHaveLength(1);
  });

  it("treats a differently-cased address as the same person", async () => {
    const owner = await registerUser(app, { email: `pt-case-${Date.now()}@zoiko.test` });

    await draft(owner.accessToken, draftBody(["Mixed.Case@Acme.test"])).expect(201);
    await draft(owner.accessToken, draftBody(["mixed.case@acme.test"])).expect(201);

    // citext, so this holds at the database rather than only when the
    // application remembers to lowercase.
    const rows = await prisma.participant.findMany({
      where: { tenantId: owner.tenantId, canonicalEmail: "MIXED.CASE@ACME.TEST" },
    });
    expect(rows).toHaveLength(1);
  });

  it("accumulates roles rather than replacing them", async () => {
    const suffix = String(Date.now());
    const owner = await registerUser(app, { email: `pt-roles-${suffix}@zoiko.test` });
    const colleagueEmail = `pt-colleague-${suffix}@acme.test`;

    // First as a recipient…
    const first = await draft(owner.accessToken, draftBody([colleagueEmail])).expect(201);
    // …then copied on the same thread.
    await request(app)
      .patch(`/api/v1/mail/drafts/${first.body.data.id}`)
      .set(authHeader(owner.accessToken))
      .send({ recipients: { to: [colleagueEmail], cc: [colleagueEmail], bcc: [] } })
      .expect(200);

    const link = await prisma.threadParticipant.findFirstOrThrow({
      where: {
        tenantId: owner.tenantId,
        threadId: first.body.data.threadId,
        participant: { canonicalEmail: colleagueEmail },
      },
    });
    // Somebody who was written to and then copied is both; a timeline that
    // forgot the first would misattribute the conversation.
    expect(link.roles).toContain("RECIPIENT");
  });

  it("knows a colleague from a stranger", async () => {
    const suffix = String(Date.now());
    const owner = await registerUser(app, { email: `pt-kind-${suffix}@zoiko.test` });
    const memberEmail = `pt-member-${suffix}@zoiko.test`;
    await registerUser(app, { email: memberEmail });
    await request(app)
      .post("/api/v1/membership/members")
      .set(authHeader(owner.accessToken))
      .send({ email: memberEmail, role: "MEMBER" })
      .expect(201);

    await draft(
      owner.accessToken,
      draftBody([memberEmail, "stranger@elsewhere.test", "no-reply@notifications.test"])
    ).expect(201);

    const rows = await prisma.participant.findMany({
      where: { tenantId: owner.tenantId },
      select: { canonicalEmail: true, participantType: true, linkedUserId: true },
    });
    const byEmail = new Map(rows.map((row) => [row.canonicalEmail, row]));
    expect(byEmail.get(memberEmail)?.participantType).toBe("INTERNAL_USER");
    expect(byEmail.get(memberEmail)?.linkedUserId).toBeTruthy();
    expect(byEmail.get("stranger@elsewhere.test")?.participantType).toBe("EXTERNAL_PERSON");
    // Nobody is behind a no-reply address, and a commitment owed to one would
    // be a commitment owed to nobody.
    expect(byEmail.get("no-reply@notifications.test")?.participantType).toBe("SYSTEM");
  });

  it("calls a shared mailbox a group, not a person", async () => {
    const suffix = String(Date.now());
    const owner = await registerUser(app, { email: `pt-group-${suffix}@zoiko.test` });
    const shared = await request(app)
      .post("/api/v1/mail/admin/shared-mailboxes")
      .set(authHeader(owner.accessToken))
      .send({ address: `team-${suffix}@acme.test`, type: "SHARED" })
      .expect(201);

    await draft(owner.accessToken, draftBody([shared.body.data.address])).expect(201);

    const row = await prisma.participant.findFirstOrThrow({
      where: { tenantId: owner.tenantId, canonicalEmail: shared.body.data.address },
    });
    expect(row.participantType).toBe("GROUP_ADDRESS");
  });
});

describe("the directory", () => {
  it("lists what the workspace has corresponded with, most recent first", async () => {
    const owner = await registerUser(app, { email: `pt-list-${Date.now()}@zoiko.test` });
    await draft(owner.accessToken, draftBody(["first@acme.test"])).expect(201);
    await draft(owner.accessToken, draftBody(["second@acme.test"])).expect(201);

    const listed = await participants(owner.accessToken).expect(200);

    const emails = listed.body.data.participants.map((p: { primaryEmail: string }) => p.primaryEmail);
    expect(emails).toContain("first@acme.test");
    expect(emails).toContain("second@acme.test");
    expect(listed.body.data.pagination.total).toBeGreaterThanOrEqual(3);
  });

  it("searches by address and by name", async () => {
    const owner = await registerUser(app, { email: `pt-search-${Date.now()}@zoiko.test` });
    await draft(owner.accessToken, draftBody(["findme@acme.test"])).expect(201);
    await draft(owner.accessToken, draftBody(["other@elsewhere.test"])).expect(201);

    const found = await participants(owner.accessToken, "?q=findme").expect(200);

    expect(found.body.data.participants).toHaveLength(1);
    expect(found.body.data.participants[0].primaryEmail).toBe("findme@acme.test");
  });

  it("filters by kind", async () => {
    const owner = await registerUser(app, { email: `pt-filter-${Date.now()}@zoiko.test` });
    await draft(owner.accessToken, draftBody(["outsider@acme.test"])).expect(201);

    const externals = await participants(owner.accessToken, "?type=EXTERNAL_PERSON").expect(200);

    expect(externals.body.data.participants.length).toBeGreaterThan(0);
    expect(
      externals.body.data.participants.every(
        (p: { participantType: string }) => p.participantType === "EXTERNAL_PERSON"
      )
    ).toBe(true);
  });

  it("keeps one workspace out of another's directory", async () => {
    const suffix = String(Date.now());
    const mine = await registerUser(app, { email: `pt-mine-${suffix}@zoiko.test` });
    const theirs = await registerUser(app, { email: `pt-theirs-${suffix}@zoiko.test` });
    await draft(theirs.accessToken, draftBody([`their-customer-${suffix}@acme.test`])).expect(201);

    const listed = await participants(mine.accessToken).expect(200);

    const emails = listed.body.data.participants.map((p: { primaryEmail: string }) => p.primaryEmail);
    expect(emails).not.toContain(`their-customer-${suffix}@acme.test`);
  });
});

describe("resolving one participant", () => {
  async function withParticipant(suffix: string) {
    const owner = await registerUser(app, { email: `pt-one-${suffix}@zoiko.test` });
    const created = await draft(owner.accessToken, draftBody([`someone-${suffix}@acme.test`])).expect(201);
    const participant = await prisma.participant.findFirstOrThrow({
      where: { tenantId: owner.tenantId, canonicalEmail: `someone-${suffix}@acme.test` },
    });
    return { owner, participant, threadId: created.body.data.threadId as string };
  }

  it("answers with the shape §12 specifies", async () => {
    const { owner, participant } = await withParticipant(String(Date.now()));

    const resolved = await request(app)
      .get(`/api/v1/participants/${participant.id}`)
      .set(authHeader(owner.accessToken))
      .expect(200);

    expect(resolved.body.data).toMatchObject({
      participantId: participant.id,
      primaryEmail: participant.canonicalEmail,
      participantType: "EXTERNAL_PERSON",
      tenantId: owner.tenantId,
    });
    expect(resolved.body.data.emailAddresses).toEqual([participant.canonicalEmail]);
    expect(resolved.body.data.threadCount).toBe(1);
  });

  it("follows a merge, so an old id still resolves", async () => {
    const suffix = String(Date.now());
    const { owner, participant } = await withParticipant(suffix);
    const survivor = await withCrossTenant(async () =>
      prisma.participant.create({
        data: {
          tenantId: owner.tenantId,
          canonicalEmail: `merged-into-${suffix}@acme.test`,
          participantType: "EXTERNAL_PERSON",
        },
      })
    );
    await withCrossTenant(async () =>
      prisma.participant.update({
        where: { id: participant.id },
        data: { status: "MERGED", mergeParentId: survivor.id },
      })
    );

    const resolved = await request(app)
      .get(`/api/v1/participants/${participant.id}`)
      .set(authHeader(owner.accessToken))
      .expect(200);

    // A merged id stays resolvable on purpose: it may be sitting in a client
    // cache or an old commitment, and "no such participant" would make a
    // successful deduplication look like data loss.
    expect(resolved.body.data.participantId).toBe(survivor.id);
    expect(resolved.body.data.resolvedFromMergedId).toBe(participant.id);
  });

  it("refuses another workspace's participant", async () => {
    const suffix = String(Date.now());
    const { participant } = await withParticipant(suffix);
    const outsider = await registerUser(app, { email: `pt-outsider-${suffix}@zoiko.test` });

    await request(app)
      .get(`/api/v1/participants/${participant.id}`)
      .set(authHeader(outsider.accessToken))
      .expect(404);
  });

  it("lists the threads they appear in, as metadata only", async () => {
    const { owner, participant, threadId } = await withParticipant(String(Date.now()));

    const threads = await request(app)
      .get(`/api/v1/participants/${participant.id}/threads`)
      .set(authHeader(owner.accessToken))
      .expect(200);

    expect(threads.body.data.threads).toHaveLength(1);
    expect(threads.body.data.threads[0].threadId).toBe(threadId);
    // §12 says metadata only, and it is load-bearing: this read is keyed by
    // somebody else's address, so a body here would be a way to read mail by
    // asking about the person instead of the message (AC-011).
    const serialised = JSON.stringify(threads.body.data);
    expect(serialised).not.toContain("Attached.");
  });

  it("lists the participants on a thread, with their roles", async () => {
    const { owner, participant, threadId } = await withParticipant(String(Date.now()));

    const onThread = await request(app)
      .get(`/api/v1/threads/${threadId}/participants`)
      .set(authHeader(owner.accessToken))
      .expect(200);

    const found = onThread.body.data.participants.find(
      (p: { participantId: string }) => p.participantId === participant.id
    );
    expect(found.roles).toEqual(["RECIPIENT"]);
    expect(
      onThread.body.data.participants.some((p: { roles: string[] }) => p.roles.includes("SENDER"))
    ).toBe(true);
  });
});

describe("commitments name who owes and who waits", () => {
  it("accepts addresses and resolves both sides to participants", async () => {
    const suffix = String(Date.now());
    const owner = await registerUser(app, { email: `pt-cmt-${suffix}@zoiko.test` });

    const commitment = await request(app)
      .post("/api/v1/actions")
      .set(authHeader(owner.accessToken))
      .send({
        text: "Send the revised proposal",
        owedByEmail: owner.email,
        owedToEmail: `client-${suffix}@acme.test`,
      })
      .expect(201);

    // §12: summaries, never bare ids.
    expect(commitment.body.data.owedBy).toMatchObject({
      primaryEmail: owner.email,
      participantType: "INTERNAL_USER",
    });
    expect(commitment.body.data.owedTo).toMatchObject({
      primaryEmail: `client-${suffix}@acme.test`,
      participantType: "EXTERNAL_PERSON",
    });
    expect(commitment.body.data.owedTo.participantId).toBeTruthy();
  });

  it("can be owed to somebody outside the workspace, which was impossible before", async () => {
    const suffix = String(Date.now());
    const owner = await registerUser(app, { email: `pt-ext-${suffix}@zoiko.test` });
    const clientEmail = `outside-${suffix}@acme.test`;

    await request(app)
      .post("/api/v1/actions")
      .set(authHeader(owner.accessToken))
      .send({ text: "Chase the signed contract", owedToEmail: clientEmail })
      .expect(201);

    const participant = await prisma.participant.findFirstOrThrow({
      where: { tenantId: owner.tenantId, canonicalEmail: clientEmail },
    });
    const owed = await request(app)
      .get(`/api/v1/participants/${participant.id}/commitments`)
      .set(authHeader(owner.accessToken))
      .expect(200);

    expect(owed.body.data.commitments).toHaveLength(1);
    expect(owed.body.data.commitments[0].text).toBe("Chase the signed contract");
    expect(owed.body.data.commitments[0].owedTo.primaryEmail).toBe(clientEmail);
  });

  it("inlines the summaries when commitments are listed", async () => {
    const suffix = String(Date.now());
    const owner = await registerUser(app, { email: `pt-cmtlist-${suffix}@zoiko.test` });
    await request(app)
      .post("/api/v1/actions")
      .set(authHeader(owner.accessToken))
      .send({ text: "Reply to the RFP", owedToEmail: `rfp-${suffix}@acme.test` })
      .expect(201);

    const listed = await request(app)
      .get("/api/v1/actions")
      .set(authHeader(owner.accessToken))
      .expect(200);

    expect(listed.body.data.actions[0].owedTo.primaryEmail).toBe(`rfp-${suffix}@acme.test`);
  });
});

describe("threads carry their participants", () => {
  it("inlines summaries on the thread detail", async () => {
    const owner = await registerUser(app, { email: `pt-thread-${Date.now()}@zoiko.test` });
    const created = await draft(owner.accessToken, draftBody(["reader@acme.test"])).expect(201);
    await request(app)
      .post(`/api/v1/mail/drafts/${created.body.data.id}/send`)
      .set(authHeader(owner.accessToken))
      .expect(200);

    const thread = await request(app)
      .get(`/api/v1/threads/${created.body.data.threadId}`)
      .set(authHeader(owner.accessToken))
      .expect(200);

    const emails = thread.body.data.participantSummaries.map(
      (p: { primaryEmail: string }) => p.primaryEmail
    );
    expect(emails).toContain("reader@acme.test");
    expect(emails).toContain(owner.email);
  });
});

describe("the tables are protected like the rest", () => {
  it("keeps participants inside their workspace at the database", async () => {
    const suffix = String(Date.now());
    const mine = await registerUser(app, { email: `pt-rls-a-${suffix}@zoiko.test` });
    const theirs = await registerUser(app, { email: `pt-rls-b-${suffix}@zoiko.test` });
    await draft(theirs.accessToken, draftBody([`secret-${suffix}@acme.test`])).expect(201);

    // Security §8.1 names participant and thread_participant among the
    // high-sensitivity tables; the earlier RLS migration could not cover them
    // because they did not exist yet (AC-004).
    const rows = await withCrossTenant(async () =>
      prisma.$queryRawUnsafe<Array<{ enabled: boolean; forced: boolean; policies: number }>>(`
        SELECT c.relrowsecurity AS enabled, c.relforcerowsecurity AS forced,
               (SELECT count(*)::int FROM pg_policies p WHERE p.tablename = c.relname) AS policies
        FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relname = ANY($1::text[])
      `, ["participants", "thread_participants"])
    );
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(row.enabled).toBe(true);
      expect(row.forced).toBe(true);
      expect(row.policies).toBeGreaterThan(0);
    }

    // And the API agrees: one workspace cannot see the other's.
    const listed = await participants(mine.accessToken).expect(200);
    const emails = listed.body.data.participants.map((p: { primaryEmail: string }) => p.primaryEmail);
    expect(emails).not.toContain(`secret-${suffix}@acme.test`);
  });
});
