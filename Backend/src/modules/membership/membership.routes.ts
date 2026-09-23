import { Router } from "express";
import { authenticate, idempotency, invitationRateLimit, requireCapability, tenantContext, validate } from "../../common/middleware/index.js";
import * as controller from "./membership.controller.js";
import { acceptInvitationSchema, addMemberSchema, claimInvitationSchema, createInvitationSchema, listQuerySchema, lookupInvitationSchema, membershipIdParamsSchema, previewInvitationSchema, updateMemberSchema } from "./membership.schema.js";

const membershipRouter = Router();

/**
 * The two routes an invitee reaches before they have a session — and they
 * cannot have one, because createInvitation gives a new person a placeholder
 * account with a random password nobody knows. Requiring authentication to
 * accept an invitation is a closed loop: no password, so no sign-in; no
 * sign-in, so no accept.
 *
 * The invitation token is the credential, exactly as it is for a password
 * reset: it was delivered to the invited address, so presenting it proves
 * control of that mailbox. Rate-limited on the same limiter for the same
 * reason — a bearer token in a URL deserves a ceiling on guesses, even one
 * this long.
 *
 * Declared before "/invitations/accept" so neither is shadowed by it.
 */
membershipRouter.get(
  "/invitations/lookup",
  invitationRateLimit,
  validate(lookupInvitationSchema, "query"),
  controller.lookupInvitation
);
membershipRouter.post(
  "/invitations/claim",
  invitationRateLimit,
  validate(claimInvitationSchema),
  controller.claimInvitation
);

membershipRouter.post(
  "/invitations/accept",
  authenticate,
  validate(acceptInvitationSchema),
  controller.acceptInvitation
);

// Reading the roster is the floor for this router; each mutation then names
// the capability it actually needs. Gating writes at the same level as reads
// is what makes a role check feel like a permission model without being one.
membershipRouter.use(authenticate, tenantContext, requireCapability("people.read"), idempotency);

membershipRouter.get("/members", validate(listQuerySchema, "query"), controller.list);

membershipRouter.post(
  "/members",
  requireCapability("people.member.manage"),
  validate(addMemberSchema),
  controller.add
);
// Drafts the letter without inviting anyone, so an admin can read and edit
// what a stranger is about to receive. Gated identically to sending it:
// drafting an invitation the caller could not send would be a way to probe
// the role ceiling.
membershipRouter.post(
  "/invitations/preview",
  requireCapability("people.invite.member"),
  validate(previewInvitationSchema),
  controller.previewInvitation
);
membershipRouter.post(
  "/invitations",
  requireCapability("people.invite.member"),
  validate(createInvitationSchema),
  controller.createInvitation
);
membershipRouter.delete(
  "/invitations/:membershipId",
  requireCapability("people.invite.member"),
  validate(membershipIdParamsSchema, "params"),
  controller.cancelInvitation
);

// The capability gate is deliberately the *floor*, not the whole check. It
// establishes that the caller may manage members at all; the service still
// applies the admin boundary, which is what refuses an Admin acting on an
// Owner. Escalation is a property of the target row, not of the route.
membershipRouter.patch(
  "/members/:membershipId",
  requireCapability("people.member.manage"),
  validate(membershipIdParamsSchema, "params"),
  validate(updateMemberSchema),
  controller.update
);
membershipRouter.delete(
  "/members/:membershipId",
  requireCapability("people.member.manage"),
  validate(membershipIdParamsSchema, "params"),
  controller.remove
);

/**
 * RBAC §2 "people.mfa.reset" — Owner Yes, Admin No, Step-up.
 *
 * Step-up because §5 lists it among the high-risk actions, and rightly:
 * whoever holds this can end a member's second factor and have a new one
 * enrolled. Owner-only because the matrix says so — the capability appears
 * in no other role's row, so an Admin reaching this route is refused by the
 * gate rather than by a role string.
 */
membershipRouter.post(
  "/members/:membershipId/mfa/reset",
  requireCapability("people.mfa.reset"),
  validate(membershipIdParamsSchema, "params"),
  controller.resetMfa
);

export { membershipRouter };
