/**
 * Password policy — Phase 3.
 *
 * One description of what a password is allowed to be, shared by every place
 * the user can set one (register, change password, reset password) and by the
 * endpoint that tells the UI what to show. The rules sit NIST-800-63B-family:
 * length over arbitrary complexity, but with a floor above "password123" and
 * no acceptance of a password that is really the user's email or current
 * password wearing a different coat.
 *
 * The policy object is stable JSON-shaped so the API can serve it as-is and a
 * form can render requirements without a client-side transcription.
 */

import { AppError } from "../errors/AppError.js";
import { ErrorCodes } from "../errors/errorCodes.js";

export interface PasswordPolicy {
  minLength: number;
  maxLength: number;
  /** Minimum number of the four character classes a password must draw on. */
  minClasses: number;
  /** Character classes a password may draw on. */
  classes: Array<{ id: string; label: string; test: string }>;
  /** A literal "must not equal" list — short, memorable, real-world bad. */
  forbidden: string[];
}

export const PASSWORD_POLICY: PasswordPolicy = {
  minLength: 8,
  maxLength: 128,
  minClasses: 3,
  classes: [
    { id: "lowercase", label: "lowercase letter", test: "a-z" },
    { id: "uppercase", label: "uppercase letter", test: "A-Z" },
    { id: "digit", label: "number", test: "0-9" },
    { id: "symbol", label: "symbol", test: "!@#$%^&*()-_=+[]{};:,.<>?/~" },
  ],
  forbidden: [
    "password",
    "password1",
    "password123",
    "12345678",
    "123456789",
    "qwerty123",
    "qwertyuiop",
    "letmein",
    "welcome1",
    "iloveyou",
    "abc123",
    "admin123",
    "zoiko123",
    "zoikomail",
  ],
};

/** Normalises a candidate so the forbidden list matches case-insensitively. */
function normalize(value: string): string {
  return value.trim().toLowerCase();
}

const RE_SEQUENCE = /(0123456789)|(abcdefghijklmnopqrstuvwxyz)/;
const RE_IGNORABLE = /[\s"'`\\/]/;

export interface PasswordValidationOptions {
  /** The account's email, so the password cannot double as the login. */
  email?: string;
  /** The current password, so a change cannot just re-enter it. */
  currentPassword?: string;
}

export type PasswordValidation =
  | { valid: true }
  | { valid: false; errors: string[] };

/**
 * Validates a candidate password against the policy.
 *
 * Returns structured errors rather than throwing so a schema or a service can
 * choose how to surface them; every caller that has one adds it to the z.string
 * refinement they already apply.
 */
export function validatePassword(
  password: string,
  opts: PasswordValidationOptions = {}
): PasswordValidation {
  const errors: string[] = [];

  if (password.length < PASSWORD_POLICY.minLength) {
    errors.push(`Password must be at least ${PASSWORD_POLICY.minLength} characters`);
  }
  if (password.length > PASSWORD_POLICY.maxLength) {
    errors.push(`Password must be no longer than ${PASSWORD_POLICY.maxLength} characters`);
  }

  const present = PASSWORD_POLICY.classes.filter(({ test }) =>
    new RegExp(`[${test}]`).test(password)
  );
  if (present.length < PASSWORD_POLICY.minClasses) {
    errors.push(
      `Password must include at least ${PASSWORD_POLICY.minClasses} of: ${PASSWORD_POLICY.classes
        .map((c) => c.label)
        .join(", ")}`
    );
  }

  if (new RegExp(`(.)\\1{2,}`).test(password)) {
    errors.push("Password must not repeat a character three or more times in a row");
  }
  if (RE_SEQUENCE.test(normalize(password))) {
    errors.push("Password must not be a simple sequence of letters or numbers");
  }
  if (RE_IGNORABLE.test(password)) {
    errors.push("Password must not contain spaces or quote/backslash characters");
  }

  const normalized = normalize(password);
  if (PASSWORD_POLICY.forbidden.includes(normalized)) {
    errors.push("Password is too easy to guess");
  }

  if (opts.email) {
    const local = opts.email.split("@")[0]?.toLowerCase();
    if (local && normalized.includes(local) && local.length >= 3) {
      errors.push("Password must not contain your email address");
    }
  }
  if (opts.currentPassword && password === opts.currentPassword) {
    errors.push("New password must be different from the current password");
  }

  return errors.length === 0 ? { valid: true } : { valid: false, errors };
}

/** The subset of the policy the client needs to render requirements. */
export function publicPasswordPolicy(): PasswordPolicy {
  return PASSWORD_POLICY;
}

/**
 * Validates and throws an AppError on the first failing rule.
 *
 * The schema already sets a floor (minLength 8); this adds the rules that
 * cannot be expressed in one z.string — class mix, sequences, reuse of the
 * login or current password. Throwing here keeps every entry point's error
 * identical rather than leaving each caller to pick its own wording.
 */
export function enforcePasswordPolicy(
  password: string,
  opts: PasswordValidationOptions = {}
): void {
  const result = validatePassword(password, opts);
  if (result.valid) return;
  throw new AppError(result.errors.join("; "), 400, ErrorCodes.VALIDATION_ERROR);
}