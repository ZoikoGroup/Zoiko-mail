import { describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import { authHeader, registerUser } from "./helpers.js";
import { prisma } from "../src/config/prisma.js";

const app = createApp();

/**
 * Creating a mailbox on one of the workspace's own domains.
 *
 * It used to take the address straight from whatever the member registered
 * with, so somebody who signed up as dana@gmail.com got a "hosted mailbox"
 * at dana@gmail.com — on a domain the workspace does not own and can never
 * publish SPF or DKIM for, so it could never legitimately send. Adding a
 * custom domain had no effect on any mailbox created afterwards, which is
 * what made the domains look missing from the create dialog: there was
 * nothing to pick, because nothing was ever picked.
 *
 * The hosted mail flow puts a "Domain readiness check" between the
 * entitlement check and provisioning. This is that check.
 */

async function workspace(suffix: string) {
  const owner = await registerUser(app, { email: `md-owner-${suffix}@zoiko.test` });
  const email = `md-member-${suffix}@external-signup.test`;
  await registerUser(app, { email });
  const added = await request(app)
    .post("/api/v1/membership/members")
    .set(authHeader(owner.accessToken))
    .send({ email, role: "MEMBER" })
    .expect(201);
  return { owner, membershipId: added.body.data.id as string, email };
}

/** A domain in whatever DNS state the case needs. */
async function domain(
  ownerToken: string,
  tenantId: string,
  name: string,
  verified: boolean
) {
  const created = await request(app)
    .post("/api/v1/domains")
    .set(authHeader(ownerToken))
    .send({ domainName: name })
    .expect(201);
  const id = created.body.data.id as string;
  if (verified) {
    await prisma.mailDomain.update({
      where: { id },
      data: { verificationStatus: "VERIFIED", mxStatus: "VALID" },
    });
  }
  return id;
}

const createMailbox = (token: string, body: Record<string, unknown>) =>
  request(app).post("/api/v1/mail/admin/mailboxes").set(authHeader(token)).send(body);

describe("creating a mailbox on a workspace domain", () => {
  it("composes the address from the chosen domain, not the member's signup email", async () => {
    const w = await workspace("compose");
    const domainId = await domain(w.owner.accessToken, w.owner.tenantId, "compose-acme.test", true);

    const res = await createMailbox(w.owner.accessToken, {
      membershipId: w.membershipId,
      domainId,
      localPart: "dana",
    }).expect(201);

    expect(res.body.data.address).toBe("dana@compose-acme.test");
    // And it records which domain it belongs to, so removing that domain
    // knows the mailbox is in the way.
    const mailbox = await prisma.mailbox.findUnique({ where: { id: res.body.data.id } });
    expect(mailbox?.domainId).toBe(domainId);
  });

  it("defaults the local part to the one they already use", async () => {
    const w = await workspace("default");
    const domainId = await domain(w.owner.accessToken, w.owner.tenantId, "default-acme.test", true);

    const res = await createMailbox(w.owner.accessToken, {
      membershipId: w.membershipId,
      domainId,
    }).expect(201);

    // md-member-default@external-signup.test → md-member-default@the domain.
    expect(res.body.data.address).toBe(`${w.email.split("@")[0]}@default-acme.test`);
  });

  /** The readiness check itself. */
  it("refuses a domain whose DNS has not been verified", async () => {
    const w = await workspace("unverified");
    const domainId = await domain(w.owner.accessToken, w.owner.tenantId, "pending-acme.test", false);

    const res = await createMailbox(w.owner.accessToken, {
      membershipId: w.membershipId,
      domainId,
      localPart: "dana",
    }).expect(409);

    expect(res.body.error.details.reason).toBe("DOMAIN_NOT_VERIFIED");
    // Named, so the screen can say which one and what is missing.
    expect(res.body.error.message).toContain("pending-acme.test");
  });

  it("cannot borrow another workspace's domain", async () => {
    const mine = await workspace("mine");
    const theirs = await workspace("theirs");
    const theirDomain = await domain(
      theirs.owner.accessToken,
      theirs.owner.tenantId,
      "theirs-acme.test",
      true
    );

    // Scoped to the tenant, so it reads as absent rather than as a refusal —
    // whether another workspace holds a given domain is not mine to learn.
    await createMailbox(mine.owner.accessToken, {
      membershipId: mine.membershipId,
      domainId: theirDomain,
      localPart: "dana",
    }).expect(404);
  });

  it("refuses an address the workspace already uses", async () => {
    const w = await workspace("clash");
    const second = await workspace("clash2");
    // Both add the domain before either verifies it: an unverified claim
    // never blocks another workspace, or anyone could squat a domain by
    // adding it first. (Once one verifies, a new claim is refused — below.)
    const domainId = await domain(w.owner.accessToken, w.owner.tenantId, "clash-acme.test", false);
    const otherDomain = await domain(second.owner.accessToken, second.owner.tenantId, "clash-acme.test", false);
    await prisma.mailDomain.updateMany({ where: { id: { in: [domainId, otherDomain] } }, data: { verificationStatus: "VERIFIED", mxStatus: "VALID" } });
    const third = await registerUser(app, { email: "md-owner-clash3@zoiko.test" });
    await request(app).post("/api/v1/domains").set(authHeader(third.accessToken)).send({ domainName: "clash-acme.test" }).expect(409);
    await createMailbox(w.owner.accessToken, {
      membershipId: w.membershipId,
      domainId,
      localPart: "shared",
    }).expect(201);
    // Same local part, different workspace — allowed, because addresses are
    // unique per tenant and these are two different companies.
    await createMailbox(second.owner.accessToken, {
      membershipId: second.membershipId,
      domainId: otherDomain,
      localPart: "shared",
    }).expect(201);
  });

  it("accepts the whole address typed into the name field, on that domain only", async () => {
    const w = await workspace("fulladdr");
    const domainId = await domain(w.owner.accessToken, w.owner.tenantId, "full-acme.test", true);

    // What the screen showed as vivek@full-acme.test@full-acme.test.
    const res = await createMailbox(w.owner.accessToken, { membershipId: w.membershipId, domainId, localPart: "Vivek@Full-Acme.test" }).expect(201);
    expect(res.body.data.address).toBe("vivek@full-acme.test");

    const other = await workspace("fulladdr2");
    const otherDomain = await domain(other.owner.accessToken, other.owner.tenantId, "other-acme.test", true);
    const wrong = await createMailbox(other.owner.accessToken, { membershipId: other.membershipId, domainId: otherDomain, localPart: "vivek@gmail.com" }).expect(422);
    expect(wrong.body.error.message).toContain("other-acme.test");
  });

  it("adds a new person: invites them and has their mailbox ready", async () => {
    const owner = await registerUser(app, { email: "md-owner-newperson@zoiko.test" });
    const domainId = await domain(owner.accessToken, owner.tenantId, "new-acme.test", true);

    const res = await createMailbox(owner.accessToken, {
      newMember: { email: "Vivek.Personal@Gmail.test", firstName: "Vivek", lastName: "Kumar" },
      domainId,
      localPart: "vivek",
    }).expect(201);
    expect(res.body.data.address).toBe("vivek@new-acme.test");

    // Invited at their own address, so they choose their password.
    const membership = await prisma.tenantMembership.findUniqueOrThrow({
      where: { id: res.body.data.membershipId },
      include: { user: true },
    });
    expect(membership).toMatchObject({ status: "INVITED", role: "MEMBER" });
    expect(membership.user).toMatchObject({ email: "vivek.personal@gmail.test", displayName: "Vivek Kumar", status: "INVITED" });
  });

  it("checks the address before inviting anyone", async () => {
    const w = await workspace("newclash");
    const domainId = await domain(w.owner.accessToken, w.owner.tenantId, "newclash-acme.test", true);
    await createMailbox(w.owner.accessToken, { membershipId: w.membershipId, domainId, localPart: "taken" }).expect(201);

    await createMailbox(w.owner.accessToken, {
      newMember: { email: "stranger@elsewhere.test" },
      domainId,
      localPart: "taken",
    }).expect(409);
    // Nobody was invited for a mailbox that could not be created.
    expect(await prisma.appUser.findUnique({ where: { email: "stranger@elsewhere.test" } })).toBeNull();
  });

  it("needs a domain for a new person, and refuses someone already in the workspace", async () => {
    const w = await workspace("newrules");
    const domainId = await domain(w.owner.accessToken, w.owner.tenantId, "newrules-acme.test", true);
    await createMailbox(w.owner.accessToken, { newMember: { email: "x@elsewhere.test" } }).expect(400);
    await createMailbox(w.owner.accessToken, { membershipId: w.membershipId, newMember: { email: "x@elsewhere.test" }, domainId }).expect(400);

    const dup = await createMailbox(w.owner.accessToken, { newMember: { email: w.email }, domainId, localPart: "dup" }).expect(409);
    expect(dup.body.error.details.reason).toBe("ALREADY_A_MEMBER");
  });

  it("rejects a local part an address cannot carry", async () => {
    const w = await workspace("badlocal");
    const domainId = await domain(w.owner.accessToken, w.owner.tenantId, "bad-acme.test", true);

    await createMailbox(w.owner.accessToken, {
      membershipId: w.membershipId,
      domainId,
      localPart: "not a valid local part",
    }).expect(422);
  });

  it("still works for callers that send no domain at all", async () => {
    const w = await workspace("legacy");
    // The old shape. Mailboxes created this way keep the member's signup
    // address and carry no domain — which is the behaviour being moved away
    // from, not one worth breaking mid-flight.
    const res = await createMailbox(w.owner.accessToken, {
      membershipId: w.membershipId,
    }).expect(201);

    expect(res.body.data.address).toBe(w.email);
  });
});
