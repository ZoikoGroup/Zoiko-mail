import { createHash, randomBytes } from "node:crypto";

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function generateOpaqueToken(): string {
  return randomBytes(48).toString("base64url");
}

/**
 * A token for a link people copy and paste: 128 random bits, 22 characters.
 * Still far beyond guessing, and these links also expire, work once, and are
 * checked behind a rate limit.
 */
export function generateLinkToken(): string {
  return randomBytes(16).toString("base64url");
}
