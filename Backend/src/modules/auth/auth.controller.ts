import type { Request, Response } from "express";
import { asyncHandler } from "../../common/middleware/asyncHandler.js";
import { sendSuccess } from "../../common/utils/response.js";
import { authService } from "./auth.service.js";

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

// export const loginWithGoogle = asyncHandler(async (req: Request, res: Response) => {
//   const result = await authService.loginWithGoogle(req.body, getRequestContext(req));
/**
 * Serialises a Google sign-in outcome onto the response.
 *
 * Shared by both legs — the token exchange and the code verification — so
 * the client sees one shape throughout. A second copy of this dispatch is a
 * second place for a state to go unhandled, which is how one leg ends up
 * silently dropping a guard the other honours.
 */
function respondWithGoogleAuthState(
  req: Request,
  res: Response,
  result: Awaited<ReturnType<typeof authService.googleLogin>>
): void {

  if (!("state" in result)) {
    sendSuccess(res, 201, result, req.requestId);
    return;
  }

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

export const googleLogin = asyncHandler(async (req: Request, res: Response) => {
  const result = await authService.googleLogin(req.body, getRequestContext(req));
  respondWithGoogleAuthState(req, res, result);
});

/**
 * Second leg of Google sign-in: the code in exchange for a session.
 *
 * Reuses the same response shape as googleLogin, because the outcome is an
 * AuthState either way — success is SIGNED_IN, and a suspension discovered
 * between sending and entering the code still surfaces as its own state.
 */
export const googleVerifyOtp = asyncHandler(async (req: Request, res: Response) => {
  const result = await authService.verifyGoogleOtp(
    req.body.pendingToken,
    req.body.code,
    getRequestContext(req),
    req.body.tenantId
  );
  respondWithGoogleAuthState(req, res, result);
});

export const googleResendOtp = asyncHandler(async (req: Request, res: Response) => {
  const result = await authService.resendGoogleOtp(req.body.pendingToken);
  sendSuccess(res, 200, result, req.requestId);
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