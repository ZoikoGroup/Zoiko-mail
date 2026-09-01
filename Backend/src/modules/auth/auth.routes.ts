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
  loginSchema,
  changePasswordSchema,
  createWorkspaceSchema,
  joinWorkspaceSchema,
  logoutSchema,
  refreshSchema,
  registerSchema,
  forgotPasswordSchema,
  resetPasswordSchema,
  selectWorkspaceSchema,
  googleLoginSchema,
  googleResendOtpSchema,
  googleVerifyOtpSchema
} from "./auth.schema.js";
import * as authController from "./auth.controller.js";
import { verifyOtpSchema } from "./otp.schema.js";
import { requireFlag } from "../../common/flags/index.js";

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

// First leg of Google sign-in. Two implementations landed independently —
// main's authService.loginWithGoogle (which signs the user straight in) and
// this one (which sends an OTP first). Only one may own the path: Express
// matches the first registration, so registering both silently disabled the
// OTP legs below. The OTP flow wins because confirming the address is a
// product requirement, not a preference.
//
// main's loginWithGoogle() and its UserIdentity model are deliberately left
// in place: the multi-provider identity table is the better long-term model
// and the two paths still need reconciling. See the note in auth.service.ts.
authRouter.post(
  "/google",
  loginRateLimit,
  requireFlag("google_login_enabled"),
  validate(googleLoginSchema),
  authController.googleLogin
);

// Second leg: the emailed code in exchange for a session. Rate limited like
// login, because a guessable code is a credential. Behind the same flag as
// the first leg — a kill switch that left two thirds of the flow reachable
// would not be a kill switch.
authRouter.post(
  "/google/verify-otp",
  loginRateLimit,
  requireFlag("google_login_enabled"),
  validate(googleVerifyOtpSchema),
  authController.googleVerifyOtp
);

// Re-send, bounded by otpService's own cooldown and hourly cap on top of this.
authRouter.post(
  "/google/resend-otp",
  loginRateLimit,
  requireFlag("google_login_enabled"),
  validate(googleResendOtpSchema),
  authController.googleResendOtp
);

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