import { describe, expect, it } from "vitest";
import {
  TOTP_STEP_SECONDS,
  base32Decode,
  base32Encode,
  generateTotpSecret,
  hotp,
  totp,
  totpUri,
  verifyTotp,
} from "../src/modules/auth/totp.js";

/**
 * TOTP, checked against the RFC test vectors.
 *
 * The algorithm is implemented in this repository rather than pulled from a
 * package, so it has to be proved rather than trusted. RFC 4226 and RFC 6238
 * both publish vectors for the shared ASCII secret "12345678901234567890",
 * and those vectors are the whole point of this file: if the HMAC, the
 * big-endian counter or the dynamic truncation were wrong, every line below
 * would fail.
 */

/** The RFC secret, base32-encoded as an authenticator app would hold it. */
const RFC_SECRET = base32Encode(Buffer.from("12345678901234567890", "ascii"));

describe("base32", () => {
  it("round-trips arbitrary bytes", () => {
    const original = Buffer.from([0x00, 0x7f, 0x80, 0xff, 0x10, 0x2a, 0x5c]);
    expect(base32Decode(base32Encode(original)).equals(original)).toBe(true);
  });

  it("encodes the RFC secret the way authenticator apps show it", () => {
    expect(RFC_SECRET).toBe("GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ");
  });

  it("tolerates padding, spacing and lower case", () => {
    // People retype secrets by hand, and apps disagree about padding. None of
    // that carries information.
    const spaced = "gezd gnbv gy3t qojq gezd gnbv gy3t qojq====";
    expect(base32Decode(spaced).equals(base32Decode(RFC_SECRET))).toBe(true);
  });

  it("refuses a character that is not in the alphabet", () => {
    expect(() => base32Decode("GEZD1NBV")).toThrow(/invalid base32/i);
  });
});

describe("HOTP against the RFC 4226 vectors", () => {
  // Appendix D of RFC 4226, counters 0 through 9.
  const expected = [
    "755224", "287082", "359152", "969429", "338314",
    "254676", "287922", "162583", "399871", "520489",
  ];

  it.each(expected.map((code, counter) => ({ counter, code })))(
    "counter $counter gives $code",
    ({ counter, code }) => {
      expect(hotp(Buffer.from("12345678901234567890", "ascii"), counter)).toBe(code);
    }
  );
});

describe("TOTP against the RFC 6238 vectors", () => {
  // Appendix B of RFC 6238, the SHA-1 rows, at eight digits.
  const vectors = [
    { seconds: 59, code: "94287082" },
    { seconds: 1111111109, code: "07081804" },
    { seconds: 1111111111, code: "14050471" },
    { seconds: 1234567890, code: "89005924" },
    { seconds: 2000000000, code: "69279037" },
  ];

  it.each(vectors)("$seconds gives $code", ({ seconds, code }) => {
    expect(totp(RFC_SECRET, new Date(seconds * 1000), 8)).toBe(code);
  });
});

describe("verification", () => {
  const secret = generateTotpSecret();
  const now = new Date("2026-09-10T12:00:00.000Z");

  it("accepts the current code", () => {
    expect(verifyTotp(secret, totp(secret, now), now)).not.toBeNull();
  });

  it("accepts one step either side, for a phone with a slightly wrong clock", () => {
    const before = new Date(now.getTime() - TOTP_STEP_SECONDS * 1000);
    const after = new Date(now.getTime() + TOTP_STEP_SECONDS * 1000);
    expect(verifyTotp(secret, totp(secret, before), now)).not.toBeNull();
    expect(verifyTotp(secret, totp(secret, after), now)).not.toBeNull();
  });

  it("refuses a code two steps old", () => {
    // A wider window would multiply the codes an attacker may guess at any
    // moment, which is the only thing standing between six digits and a
    // brute-force.
    const stale = new Date(now.getTime() - 2 * TOTP_STEP_SECONDS * 1000);
    expect(verifyTotp(secret, totp(secret, stale), now)).toBeNull();
  });

  it("refuses another secret's code", () => {
    expect(verifyTotp(secret, totp(generateTotpSecret(), now), now)).toBeNull();
  });

  it("refuses anything that is not digits", () => {
    expect(verifyTotp(secret, "abcdef", now)).toBeNull();
    expect(verifyTotp(secret, "", now)).toBeNull();
    expect(verifyTotp(secret, "12 34 56", now)).toBeNull();
  });

  it("reports which step matched, so a code can be spent", () => {
    const match = verifyTotp(secret, totp(secret, now), now);
    // RFC 6238 §5.2 asks that a code be accepted only once; the caller needs
    // the step to remember which one was used.
    expect(match?.step).toBe(Math.floor(now.getTime() / 1000 / TOTP_STEP_SECONDS));
  });
});

describe("the enrolment URI", () => {
  it("carries the parameters an authenticator app reads", () => {
    const uri = totpUri({
      secret: RFC_SECRET,
      accountName: "ada@acme.test",
      issuer: "Zoiko Mail",
    });

    expect(uri.startsWith("otpauth://totp/Zoiko%20Mail:ada%40acme.test?")).toBe(true);
    expect(uri).toContain(`secret=${RFC_SECRET}`);
    expect(uri).toContain("digits=6");
    expect(uri).toContain("period=30");
  });
});
