import type { Request, Response } from "express";
import { asyncHandler } from "../../common/middleware/asyncHandler.js";
import { sendSuccess } from "../../common/utils/response.js";
import { authService } from "./auth.service.js";
import { isGoogleSignInConfigured } from "./google.service.js";
import { env } from "../../config/env.js";

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

/**
 * Serialises an AuthState onto the response.
 *
 * Shared by every sign-in route. The state machine decides what the client
 * renders, so a second route with its own copy of this dispatch would be a
 * second place for a state to go unhandled — which is how one sign-in path
 * ends up silently skipping a guard the other enforces.
 */
function respondWithAuthState(
  req: Request,
  res: Response,
  result: Awaited<ReturnType<typeof authService.login>>
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
}

export const login = asyncHandler(async (req: Request, res: Response) => {
  const result = await authService.login(req.body, getRequestContext(req));
  respondWithAuthState(req, res, result);
});

/**
 * Sign in with Google. Takes a single-use authorization code, never a token:
 * the code is worthless without the client secret held server-side, so the
 * exchange happens in google.service and nothing client-supplied is trusted.
 */
export const googleLogin = asyncHandler(async (req: Request, res: Response) => {
  const result = await authService.loginWithGoogle(
    req.body.code,
    getRequestContext(req),
    req.body.tenantId
  );
  respondWithAuthState(req, res, result);
});

/** Lets the client show or hide the Google button honestly. */
export const authProviders = asyncHandler(async (req: Request, res: Response) => {
  sendSuccess(
    res,
    200,
    { google: { enabled: isGoogleSignInConfigured(), clientId: env.GOOGLE_OAUTH_CLIENT_ID ?? null } },
    req.requestId
  );
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