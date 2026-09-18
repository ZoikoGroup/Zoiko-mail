/**
 * The password rules the server enforces, mirrored from
 * Backend/src/common/utils/passwordPolicy.ts so the forms render the same
 * requirements the backend applies. The API used to serve this, and the
 * client fetched it; the endpoint is gone, and the policy is stable, so the
 * client now keeps a copy. Change it only together with the backend.
 */
export const PASSWORD_POLICY = {
  minLength: 8,
  maxLength: 128,
  minClasses: 3,
  classes: [
    { id: "lowercase", label: "lowercase letter", test: "a-z" },
    { id: "uppercase", label: "uppercase letter", test: "A-Z" },
    { id: "digit", label: "number", test: "0-9" },
    { id: "symbol", label: "symbol", test: "!@#$%^&*()-_=+[]{};:,.<>?/~" },
  ],
} as const;