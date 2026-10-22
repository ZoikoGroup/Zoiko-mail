import { env } from "../../config/env.js";
import type { Request, Response } from "express";
import { asyncHandler } from "../../common/middleware/asyncHandler.js";
import { sendSuccess } from "../../common/utils/response.js";
import { membershipService } from "./membership.service.js";

function requestContext(req: Request) {
  const tenant = req.tenantContext!;
  return {
    tenantId: tenant.tenantId,
    userId: tenant.userId,
    role: tenant.role,
    requestId: req.requestId,
    ipAddress: req.ip ?? null,
    userAgent: req.header("user-agent") ?? null,
  };
}

export const list = asyncHandler(async (req: Request, res: Response) => {
  const q = req.query as { limit?: number; cursor?: string };
  const page = await membershipService.list(requestContext(req), {
    limit: q.limit,
    cursor: q.cursor,
  });
  // `members` keeps its name and stays an array — every existing caller reads
  // it that way, and a page object under the same key would be a silent
  // breaking change that renders as an empty table rather than an error.
  sendSuccess(res, 200, { members: page.items, nextCursor: page.nextCursor }, req.requestId);
});

export const add = asyncHandler(async (req: Request, res: Response) => {
  const member = await membershipService.add(req.body, requestContext(req));
  sendSuccess(res, 201, member, req.requestId);
});

/**
 * Creates the invitation. With system email off nobody can receive it, so the
 * link is handed back here, to the admin who asked, to pass on themselves; with
 * email on it is null and the invitation went out by email.
 *
 * The link is a credential. The response carries it once, and the idempotency
 * layer is told to keep the link and the raw token out of the 24-hour replay
 * copy it stores in the database.
 */
export const createInvitation = asyncHandler(async (req: Request, res: Response) => {
  res.locals.redactFromReplay = ["invitationToken", "invitationLink"];
  const invitation = await membershipService.createInvitation(req.body, requestContext(req));
  // The raw token and link go back only when nothing was emailed — then the
  // admin is the one passing them on. When the email went out, the inviter
  // has no reason to hold a credential meant for the invitee's mailbox.
  const { invitationToken, ...rest } = invitation;
  const handedOver = !env.SYSTEM_MAIL_ENABLED;
  sendSuccess(
    res,
    201,
    {
      ...rest,
      invitationToken: handedOver ? invitationToken : null,
      invitationLink: handedOver ? membershipService.acceptUrl(invitationToken) : null,
    },
    req.requestId
  );
});

// 200, not 201: nothing is created. Drafting a letter for review is a read of
// what would be sent, and re-running it must stay free of side effects.
export const previewInvitation = asyncHandler(async (req: Request, res: Response) => {
  const letter = await membershipService.previewInvitation(req.body, requestContext(req));
  sendSuccess(res, 200, { letter }, req.requestId);
});

/**
 * Responses that answer for an invitation token are never cached, and the
 * page that made the request is not passed on in a Referer header.
 */
function noStore(res: Response) {
  res.set("Cache-Control", "no-store");
  res.set("Pragma", "no-cache");
  res.set("Referrer-Policy", "no-referrer");
}

/** Kept for links and clients that still send the token in the query string. */
export const lookupInvitation = asyncHandler(async (req: Request, res: Response) => {
  noStore(res);
  const token = String((req.query as { token?: string }).token ?? "");
  sendSuccess(res, 200, await membershipService.lookupInvitation(token), req.requestId);
});

/**
 * The same lookup with the token in the body. Preferred: a query string is
 * written to proxy and load-balancer access logs, a request body is not.
 */
export const lookupInvitationByBody = asyncHandler(async (req: Request, res: Response) => {
  noStore(res);
  sendSuccess(res, 200, await membershipService.lookupInvitation(String(req.body.token)), req.requestId);
});

export const claimInvitation = asyncHandler(async (req: Request, res: Response) => {
  noStore(res);
  const result = await membershipService.claimInvitation(req.body, {
    userId: "",
    requestId: req.requestId,
    ipAddress: req.ip ?? null,
    userAgent: req.header("user-agent") ?? null,
  });
  // No session is issued. Choosing a password and signing in with it are
  // separate on purpose: it proves the password works before they rely on
  // it, and it keeps MFA enrolment on the sign-in path where AC-002 puts it.
  sendSuccess(res, 200, { email: result.email }, req.requestId);
});

export const acceptInvitation = asyncHandler(async (req: Request, res: Response) => {
  const membership = await membershipService.acceptInvitation(req.body, {
    userId: req.auth?.sub ?? "",
    requestId: req.requestId,
    ipAddress: req.ip ?? null,
    userAgent: req.header("user-agent") ?? null,
  });
  sendSuccess(res, 200, membership, req.requestId);
});

export const cancelInvitation = asyncHandler(async (req: Request, res: Response) => {
  await membershipService.cancelInvitation(
    String(req.params.membershipId),
    requestContext(req)
  );
  sendSuccess(res, 200, { message: "Invitation cancelled successfully" }, req.requestId);
});

export const update = asyncHandler(async (req: Request, res: Response) => {
  const member = await membershipService.update(
    String(req.params.membershipId),
    req.body,
    requestContext(req)
  );
  sendSuccess(res, 200, member, req.requestId);
});

export const remove = asyncHandler(async (req: Request, res: Response) => {
  await membershipService.remove(String(req.params.membershipId), requestContext(req));
  sendSuccess(res, 200, { message: "Membership removed successfully" }, req.requestId);
});

/**
 * Clear a member's authenticator so they can enrol a new one.
 *
 * The response says what happens next rather than "ok": the member has to
 * set up a new authenticator before they can reach anything, and whoever
 * pressed the button is the person who will be asked about it.
 */
export const resetMfa = asyncHandler(async (req: Request, res: Response) => {
  const result = await membershipService.resetMfa(
    String(req.params.membershipId),
    requestContext(req)
  );
  sendSuccess(
    res,
    200,
    {
      ...result,
      message:
        "Authenticator cleared and active sessions ended. They will be asked to set up a new authenticator the next time they sign in.",
    },
    req.requestId
  );
});
