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
  logoutSchema,
  refreshSchema,
  registerSchema,
} from "./auth.schema.js";
import * as authController from "./auth.controller.js";

const authRouter = Router();

authRouter.post(
  "/register",
  registerRateLimit,
  validate(registerSchema),
  authController.register
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
