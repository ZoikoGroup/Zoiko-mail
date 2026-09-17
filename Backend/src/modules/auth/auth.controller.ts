import type { Request, Response } from "express";
import { asyncHandler } from "../../common/middleware/asyncHandler.js";
import { sendSuccess } from "../../common/utils/response.js";
import { authService } from "./auth.service.js";
import { mfaService } from "./mfa.service.js";

function getRequestContext(req: Request) {
  return {
    requestId: req.requestId,
    ipAddress: req.ip ?? null,
    userAgent: req.header("user-agent") ?? null,
  };
}

function getBearerToken(req: Request): string {
  const header = req.header("authorization") ?? "";
  return header.startsWith("Bearer ") ? header.slice(7) : "";
}

export const verifyOtp = asyncHandler(async (req: Request, res: Response) => {
  const pendingToken = getBearerToken(req);
  const result = await authService.verifyEmailOtp(pendingToken, req.body.code, getRequestContext(req));
  sendSuccess(res, 200, result, req.requestId);
});

export const resendOtp = asyncHandler(async (req: Request, res: Response) => {
  const pendingToken = getBearerToken(req);
  const result = await authService.resendEmailOtp(pendingToken, getRequestContext(req));
  sendSuccess(res, 200, result, req.requestId);
});

export const register = asyncHandler(async (req: Request, res: Response) => {
  const result = await authService.register(req.body, getRequestContext(req));
  sendSuccess(res, 201, result, req.requestId);
});

export const createWorkspace = asyncHandler(async (req: Request, res: Response) => {
  const pendingToken = getBearerToken(req);
  const result = await authService.createWorkspace(
    req.body,
    pendingToken,
    getRequestContext(req)
  );
  sendSuccess(res, 201, result, req.requestId);
});

export const joinWorkspace = asyncHandler(async (req: Request, res: Response) => {
  const pendingToken = getBearerToken(req);
  const result = await authService.joinWorkspace(
    req.body,
    pendingToken,
    getRequestContext(req)
  );
  sendSuccess(res, 201, result, req.requestId);
});

export const login = asyncHandler(async (req: Request, res: Response) => {
  const result = await authService.login(req.body, getRequestContext(req));

  if (result.state === "SIGNED_IN") {
    sendSuccess(
      res,
      200,
      {
        ...result,
        accessToken: result.session.accessToken,
        refreshToken: result.session.refreshToken,
        expiresIn: result.session.expiresIn,
        user: result.session.user,
        tenant: result.session.tenant,
        membership: result.session.membership,
      },
      req.requestId
    );
    return;
  }

  if (result.state === "WORKSPACE_SELECTION") {
    sendSuccess(
      res,
      200,
      {
        ...result,
        requiresTenantSelection: true,
        tenants: result.workspaces,
      },
      req.requestId
    );
    return;
  }

  sendSuccess(res, 200, result, req.requestId);
});

/**
 * Serialises a Google sign-in outcome onto the response.
 *
 * SIGNED_IN is flattened so the client reads tokens off the top level, the
 * same way the password login response is shaped. Every other state falls
 * through unchanged, so a new guard state surfaces to the client rather than
 * being silently swallowed here.
 */
function respondWithGoogleAuthState(
  req: Request,
  res: Response,
  result: Awaited<ReturnType<typeof authService.loginWithGoogle>>
): void {
  if (result.state === "SIGNED_IN") {
    sendSuccess(
      res,
      200,
      {
        ...result,
        accessToken: result.session.accessToken,
        refreshToken: result.session.refreshToken,
        expiresIn: result.session.expiresIn,
        user: result.session.user,
        tenant: result.session.tenant,
        membership: result.session.membership,
      },
      req.requestId
    );
    return;
  }

  if (result.state === "WORKSPACE_SELECTION") {
    sendSuccess(
      res,
      200,
      { ...result, requiresTenantSelection: true, tenants: result.workspaces },
      req.requestId
    );
    return;
  }

  sendSuccess(res, 200, result, req.requestId);
}

export const loginWithGoogle = asyncHandler(async (req: Request, res: Response) => {
  const result = await authService.loginWithGoogle(req.body, getRequestContext(req));
  respondWithGoogleAuthState(req, res, result);
});

export const refresh = asyncHandler(async (req: Request, res: Response) => {
  const result = await authService.refresh(req.body, getRequestContext(req));
  sendSuccess(res, 200, result, req.requestId);
});

export const logout = asyncHandler(async (req: Request, res: Response) => {
  await authService.logout(req.body, getRequestContext(req));
  sendSuccess(res, 200, { message: "Logged out successfully" }, req.requestId);
});

export const changePassword = asyncHandler(async (req: Request, res: Response) => {
  const tenant = req.tenantContext!;
  await authService.changePassword(
    req.body,
    tenant.userId,
    tenant.tenantId,
    getRequestContext(req)
  );
  sendSuccess(res, 200, { message: "Password changed successfully" }, req.requestId);
});

/**
 * Re-authenticate for a high-risk action — Security §5, AC-003.
 *
 * Returns a short-lived token the client sends back as `x-step-up-token` on
 * the privileged request. Kept out of the session so it expires on its own
 * rather than riding along for the life of the login.
 */
export const stepUp = asyncHandler(async (req: Request, res: Response) => {
  const tenant = req.tenantContext!;
  const { token, expiresIn } = await authService.stepUp(req.body, {
    userId: tenant.userId,
    tenantId: tenant.tenantId,
    ...getRequestContext(req),
  });
  // Named for what it is rather than a bare `token`: the client has an
  // access token already, and the two go in different headers.
  sendSuccess(res, 200, { stepUpToken: token, expiresIn }, req.requestId);
});

export const logoutAll = asyncHandler(async (req: Request, res: Response) => {
  const tenant = req.tenantContext!;
  const revokedSessionCount = await authService.logoutAll(
    tenant.userId,
    tenant.tenantId,
    getRequestContext(req)
  );
  sendSuccess(
    res,
    200,
    { message: "Logged out from all tenant devices", revokedSessionCount },
    req.requestId
  );
});

export const me = asyncHandler(async (req: Request, res: Response) => {
  const result = authService.getCurrentUser(req);
  sendSuccess(res, 200, result, req.requestId);
});

export const forgotPassword = asyncHandler(async (req: Request, res: Response) => {
  const result = await authService.forgotPassword(req.body, getRequestContext(req));
  sendSuccess(res, 200, result, req.requestId);
});
export const resetPassword = asyncHandler(async (req: Request, res: Response) => {
  const result = await authService.resetPassword(req.body, getRequestContext(req));
  sendSuccess(res, 200, result, req.requestId);
});

export const selectWorkspace = asyncHandler(async (req: Request, res: Response) => {
  const result = await authService.selectWorkspace(req.body, getRequestContext(req));
  res.json({ success: true, data: result });
});

/* ── multi-factor authentication — AC-002 ─────────────────────────────────
 *
 * Two families, deliberately separated by which token they accept.
 *
 * The `/challenge/*` routes take the short-lived challenge token from a
 * sign-in that is still owed a second factor. They exist because the account
 * has no session yet: a newly privileged user who could not enrol from the
 * challenge would be locked out by the control meant to protect them.
 *
 * The rest take an ordinary access token and belong to a settings screen.
 */

export const mfaStatus = asyncHandler(async (req: Request, res: Response) => {
  sendSuccess(res, 200, await mfaService.status(req.auth!.sub), req.requestId);
});

export const mfaEnrol = asyncHandler(async (req: Request, res: Response) => {
  const offer = await mfaService.beginEnrolment(
    req.auth!.sub,
    req.tenantContext!.user.email,
    getRequestContext(req)
  );
  sendSuccess(res, 201, offer, req.requestId);
});

export const mfaConfirm = asyncHandler(async (req: Request, res: Response) => {
  const result = await mfaService.confirmEnrolment(
    req.auth!.sub,
    req.body.code,
    getRequestContext(req)
  );
  sendSuccess(res, 200, result, req.requestId);
});

export const mfaDisable = asyncHandler(async (req: Request, res: Response) => {
  const result = await mfaService.disable(req.auth!.sub, req.body.code, getRequestContext(req));
  sendSuccess(res, 200, result, req.requestId);
});

export const mfaRegenerateRecoveryCodes = asyncHandler(async (req: Request, res: Response) => {
  const result = await mfaService.regenerateRecoveryCodes(
    req.auth!.sub,
    req.body.code,
    getRequestContext(req)
  );
  sendSuccess(res, 200, result, req.requestId);
});

export const mfaChallengeVerify = asyncHandler(async (req: Request, res: Response) => {
  const result = await authService.completeMfaChallenge(
    getBearerToken(req),
    req.body.code,
    getRequestContext(req)
  );
  sendSuccess(res, 200, result, req.requestId);
});

export const mfaChallengeEnrol = asyncHandler(async (req: Request, res: Response) => {
  const offer = await authService.enrolFromChallenge(getBearerToken(req), getRequestContext(req));
  sendSuccess(res, 201, offer, req.requestId);
});

export const mfaChallengeConfirm = asyncHandler(async (req: Request, res: Response) => {
  const result = await authService.confirmEnrolmentFromChallenge(
    getBearerToken(req),
    req.body.code,
    getRequestContext(req)
  );
  sendSuccess(res, 200, result, req.requestId);
});
