import { Router } from "express";
import {
  authenticate,
  loginRateLimit,
  refreshRateLimit,
  registerRateLimit,
  tenantContext,
  validate,
  passwordResetRateLimit
} from "../../common/middleware/index.js";
import {
  googleLoginSchema,
  loginSchema,
  changePasswordSchema,
  createWorkspaceSchema,
  joinWorkspaceSchema,
  logoutSchema,
  refreshSchema,
  registerSchema,
  forgotPasswordSchema,
  resetPasswordSchema,
  selectWorkspaceSchema
} from "./auth.schema.js";
import * as authController from "./auth.controller.js";
import { verifyOtpSchema } from "./otp.schema.js";

const authRouter = Router();

authRouter.post(
  "/register",
  registerRateLimit,
  validate(registerSchema),
  authController.register
);

// No `authenticate`/`tenantContext` here: the caller has a pending token,
// not an access token, and there is no tenant yet for tenantContext to
// resolve. Auth is handled inside authService.createWorkspace. Reuses
// registerRateLimit since this is still part of the signup funnel.
authRouter.post(
  "/create-workspace",
  registerRateLimit,
  validate(createWorkspaceSchema),
  authController.createWorkspace
);

// Same pending-token auth as /create-workspace: the caller just verified
// their email and is joining an invited workspace instead of creating one.
authRouter.post(
  "/join-workspace",
  registerRateLimit,
  validate(joinWorkspaceSchema),
  authController.joinWorkspace
);

authRouter.post(
  "/verify-otp",
  registerRateLimit,
  validate(verifyOtpSchema),
  authController.verifyOtp
);

authRouter.post(
  "/resend-otp",
  registerRateLimit,
  authController.resendOtp
);

authRouter.post(
  "/select-workspace",
  loginRateLimit,
  validate(selectWorkspaceSchema),
  authController.selectWorkspace
);

authRouter.post("/login", loginRateLimit, validate(loginSchema), authController.login);

// Same rate limit as password login: a sign-in attempt is a sign-in attempt
// however it is authenticated, and the Google path reaches the same account.
authRouter.post("/google", loginRateLimit, validate(googleLoginSchema), authController.googleLogin);

// Unauthenticated on purpose — the client needs to know whether to render the
// Google button before anyone has signed in. Exposes only the public client id.
authRouter.get("/providers", authController.authProviders);

authRouter.post("/forgot-password", passwordResetRateLimit, validate(forgotPasswordSchema), authController.forgotPassword);
authRouter.post("/reset-password", passwordResetRateLimit, validate(resetPasswordSchema), authController.resetPassword);

authRouter.post(
  "/refresh",
  refreshRateLimit,
  validate(refreshSchema),
  authController.refresh
);

authRouter.post(
  "/logout",
  validate(logoutSchema),
  authController.logout
);

authRouter.get(
  "/me",
  authenticate,
  tenantContext,
  authController.me
);

authRouter.post(
  "/change-password",
  authenticate,
  tenantContext,
  validate(changePasswordSchema),
  authController.changePassword
);

authRouter.post(
  "/logout-all",
  authenticate,
  tenantContext,
  authController.logoutAll
);

export { authRouter };