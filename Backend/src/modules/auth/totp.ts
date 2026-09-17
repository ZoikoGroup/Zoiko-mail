import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Time-based one-time passwords — RFC 6238, over RFC 4226 HOTP.
 *
 * Written rather than taken from a package because the algorithm is forty
 * lines and the RFC ships test vectors, so it can be proved correct here
 * instead of trusted: see tests/totp.test.ts, which checks the published
 * vectors for both HOTP counters and TOTP timestamps.
 *
 * The Security specification points at NIST SP 800-63B for authenticator
 * assurance, and a TOTP authenticator app is the "single-factor OTP device"
 * that document describes. What matters for correctness here is small: HMAC
 * over the big-endian counter, dynamic truncation, and a verification window
 * that tolerates clock skew without widening the guessing surface.
 */

/** RFC 6238 default: a new code every 30 seconds. */
export const TOTP_STEP_SECONDS = 30;

/** Six digits, which is what every authenticator app shows. */
export const TOTP_DIGITS = 6;

/**
 * How many steps either side of now are accepted.
 *
 * One step, so a code is valid for at most ninety seconds across the whole
 * window. Zero would fail anyone whose phone clock is a few seconds off;
 * larger multiplies the number of codes an attacker may guess at any moment.
 */
export const TOTP_WINDOW_STEPS = 1;

const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

/** RFC 4648 base32, unpadded — the encoding every authenticator app expects. */
export function base32Encode(data: Buffer): string {
  let bits = 0;
  let value = 0;
  let output = "";
  for (const byte of data) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) output += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  return output;
}

export function base32Decode(encoded: string): Buffer {
  // Padding and casing vary between apps and between people typing a secret
  // in by hand; neither carries information, so both are normalised away.
  const normalized = encoded.replace(/=+$/, "").replace(/\s+/g, "").toUpperCase();
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];
  for (const character of normalized) {
    const index = BASE32_ALPHABET.indexOf(character);
    if (index === -1) throw new Error("Invalid base32 character in secret");
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

/**
 * A fresh secret.
 *
 * Twenty bytes, which is the length RFC 4226 recommends and what the shared
 * secret in the RFC test vectors is.
 */
export function generateTotpSecret(bytes = 20): string {
  return base32Encode(randomBytes(bytes));
}

/** RFC 4226 HOTP: HMAC-SHA1 over the counter, then dynamic truncation. */
export function hotp(secret: Buffer, counter: number, digits = TOTP_DIGITS): string {
  const message = Buffer.alloc(8);
  // Big-endian 64-bit counter. Written as two 32-bit halves because a JS
  // number cannot hold the top bits exactly, and the low half is all that
  // moves for the next few million years.
  message.writeUInt32BE(Math.floor(counter / 2 ** 32), 0);
  message.writeUInt32BE(counter % 2 ** 32, 4);

  const digest = createHmac("sha1", secret).update(message).digest();
  const offset = digest[digest.length - 1]! & 0x0f;
  const binary =
    ((digest[offset]! & 0x7f) << 24) |
    ((digest[offset + 1]! & 0xff) << 16) |
    ((digest[offset + 2]! & 0xff) << 8) |
    (digest[offset + 3]! & 0xff);

  return String(binary % 10 ** digits).padStart(digits, "0");
}

/** The code for a moment in time. */
export function totp(
  base32Secret: string,
  at: Date = new Date(),
  digits = TOTP_DIGITS,
  stepSeconds = TOTP_STEP_SECONDS
): string {
  const counter = Math.floor(at.getTime() / 1000 / stepSeconds);
  return hotp(base32Decode(base32Secret), counter, digits);
}

/** Constant-time comparison, so a wrong code leaks nothing about how wrong. */
function equals(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

/**
 * Whether a submitted code is valid for a secret right now.
 *
 * Returns the step it matched, or null. The step is returned rather than a
 * boolean so a caller can refuse a code that has already been used —
 * replaying the same code inside its own window is otherwise possible, and
 * RFC 6238 §5.2 asks implementations to accept a given code only once.
 */
export function verifyTotp(
  base32Secret: string,
  code: string,
  at: Date = new Date(),
  windowSteps = TOTP_WINDOW_STEPS
): { step: number } | null {
  const submitted = code.replace(/\s+/g, "");
  if (!/^\d+$/.test(submitted)) return null;

  const secret = base32Decode(base32Secret);
  const currentStep = Math.floor(at.getTime() / 1000 / TOTP_STEP_SECONDS);
  for (let offset = -windowSteps; offset <= windowSteps; offset += 1) {
    const step = currentStep + offset;
    if (equals(submitted, hotp(secret, step, submitted.length))) return { step };
  }
  return null;
}

/**
 * The URI an authenticator app scans.
 *
 * The issuer appears twice by convention — once as a label prefix and once as
 * a parameter — because apps disagree about which one they read.
 */
export function totpUri(options: {
  secret: string;
  accountName: string;
  issuer: string;
}): string {
  const label = `${encodeURIComponent(options.issuer)}:${encodeURIComponent(options.accountName)}`;
  const parameters = new URLSearchParams({
    secret: options.secret,
    issuer: options.issuer,
    algorithm: "SHA1",
    digits: String(TOTP_DIGITS),
    period: String(TOTP_STEP_SECONDS),
  });
  return `otpauth://totp/${label}?${parameters.toString()}`;
}
