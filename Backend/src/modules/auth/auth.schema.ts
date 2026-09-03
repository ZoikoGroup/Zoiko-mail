import { z } from "zod";

export const registerSchema = z.object({
  email: z.string().email().transform((value) => value.toLowerCase()),
  password: z
    .string()
    .min(8, "Password must be at least 8 characters")
    .max(128),
  displayName: z.string().trim().min(1).max(120),
});

export const createWorkspaceSchema = z.object({
  tenantName: z.string().trim().min(1).max(120),
  planCode: z.string().trim().min(1).max(64).default("starter"),
});

export const loginSchema = z.object({
  email: z.string().email().transform((value) => value.toLowerCase()),
  password: z.string().min(1),
  tenantId: z.string().uuid().optional(),
});

/** Google login schema. */
export const googleLoginSchema = z.object({
  idToken: z.string().min(1),
});

/** Second leg of Google sign-in: the code, plus the token that identifies who. */
export const googleVerifyOtpSchema = z.object({
  pendingToken: z.string().min(10),
  code: z.string().trim().min(4).max(10),
  tenantId: z.string().uuid().optional(),
});

export const googleResendOtpSchema = z.object({
  pendingToken: z.string().min(10),
});

export const refreshSchema = z.object({
  refreshToken: z.string().min(1),
});

export const logoutSchema = z.object({
  refreshToken: z.string().min(1),
});

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(8, "Password must be at least 8 characters").max(128),
});

export const forgotPasswordSchema = z.object({
  email: z.string().email().transform((value) => value.toLowerCase()),
});

export const resetPasswordSchema = z.object({
  email: z.string().email().transform((value) => value.toLowerCase()),
  code: z.string().regex(/^\d{4,10}$/, "Code must be 4–10 digits"),
  newPassword: z.string().min(8, "Password must be at least 8 characters").max(128),
});

// POST /auth/select-workspace body: pick a tenant from the WORKSPACE_SELECTION
// response using the short-lived selection token issued by /auth/login.
export const selectWorkspaceSchema = z.object({
  selectionToken: z.string().min(1),
  tenantId: z.string().uuid(),
});

// POST /auth/join-workspace body: accept a pending invitation for the newly
// registered (and now email-verified) user, authenticated by pending token.
export const joinWorkspaceSchema = z.object({
  membershipId: z.string().uuid(),
});

export type RegisterInput = z.infer<typeof registerSchema>;
export type CreateWorkspaceInput = z.infer<typeof createWorkspaceSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type RefreshInput = z.infer<typeof refreshSchema>;
export type LogoutInput = z.infer<typeof logoutSchema>;
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;
export type ForgotPasswordInput = z.infer<typeof forgotPasswordSchema>;
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;
export type SelectWorkspaceInput = z.infer<typeof selectWorkspaceSchema>;
export type JoinWorkspaceInput = z.infer<typeof joinWorkspaceSchema>;
export type GoogleLoginInput = z.infer<typeof googleLoginSchema>;
export type GoogleVerifyOtpInput = z.infer<typeof googleVerifyOtpSchema>;
export type GoogleResendOtpInput = z.infer<typeof googleResendOtpSchema>;
