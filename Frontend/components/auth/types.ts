export type AuthStep =
  | "login"
  | "register"
  | "verifyOtp"
  | "workspace"
  | "joinWorkspace"
  | "forgotPassword"
  | "resetPassword";