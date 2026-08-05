import { Router } from "express";
import {
  authenticate,
  loginRateLimit,
  refreshRateLimit,
  registerRateLimit,
  tenantContext,
  validate,
} from "../../common/middleware/index.js";
import {
  loginSchema,
  changePasswordSchema,
  createWorkspaceSchema,
  logoutSchema,
  refreshSchema,
  registerSchema,
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

authRouter.post("/login", loginRateLimit, validate(loginSchema), authController.login);

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