import { describe, expect, it } from "vitest";
import { envSchema } from "../src/config/env.js";

/**
 * TLS on the outbound mail provider connection, enforced per protocol.
 *
 * Security §16 requires TLS for provider traffic and Infrastructure §8 sets
 * TLS 1.2 as the floor. A local mail container has no certificate, so a
 * plaintext loopback hop is allowed for development — but the exemption has
 * to be per protocol, and for a while it was not:
 *
 *   SMTP_HOST !== "localhost" && IMAP_HOST !== "localhost" && (...)
 *
 * That skips the check for *both* protocols the moment *either* host is
 * localhost. The third test is that case, and it is the reason this file
 * exists: the shape merges cleanly into main and weakens the invariant in
 * silence, so it needs a test rather than a reviewer noticing an `&&`.
 */

/** A valid environment with the mail provider on, before TLS is varied. */
function providerEnv(overrides: Record<string, string> = {}) {
  return {
    ...process.env,
    MAIL_PROVIDER_ENABLED: "true",
    MAIL_PROVIDER_USERNAME: "mailer",
    MAIL_PROVIDER_PASSWORD: "mailer-password",
    MAIL_PROVIDER_FROM_ADDRESS: "mail@zoikomail.com",
    MAIL_PROVIDER_TENANT_ID: "00000000-0000-4000-8000-000000000001",
    MAIL_PROVIDER_MEMBERSHIP_ID: "00000000-0000-4000-8000-000000000002",
    IMAP_HOST: "imap.secureserver.net",
    SMTP_HOST: "smtpout.secureserver.net",
    IMAP_SECURE: "true",
    SMTP_SECURE: "true",
    ...overrides,
  };
}

/** The paths that failed validation, e.g. ["IMAP_SECURE"]. */
function issuePaths(env: Record<string, unknown>): string[] {
  const result = envSchema.safeParse(env);
  return result.success ? [] : result.error.issues.map((i) => i.path.join("."));
}

describe("provider TLS is required per protocol", () => {
  it("accepts TLS on both", () => {
    expect(issuePaths(providerEnv())).toEqual([]);
  });

  it("refuses plaintext IMAP to a remote host", () => {
    expect(issuePaths(providerEnv({ IMAP_SECURE: "false" }))).toContain("IMAP_SECURE");
  });

  it("refuses plaintext SMTP to a remote host", () => {
    expect(issuePaths(providerEnv({ SMTP_SECURE: "false" }))).toContain("SMTP_SECURE");
  });

  it("still refuses plaintext IMAP when only SMTP is on loopback", () => {
    // The regression. A developer points SMTP at a local container and leaves
    // IMAP on the real server with TLS off; the combined `&&` accepted it.
    const paths = issuePaths(
      providerEnv({
        SMTP_HOST: "localhost",
        SMTP_SECURE: "false",
        IMAP_HOST: "imap.secureserver.net",
        IMAP_SECURE: "false",
      })
    );
    expect(paths).toContain("IMAP_SECURE");
    // SMTP is genuinely exempt here — it is talking to loopback.
    expect(paths).not.toContain("SMTP_SECURE");
  });

  it("still refuses plaintext SMTP when only IMAP is on loopback", () => {
    const paths = issuePaths(
      providerEnv({
        IMAP_HOST: "127.0.0.1",
        IMAP_SECURE: "false",
        SMTP_HOST: "smtpout.secureserver.net",
        SMTP_SECURE: "false",
      })
    );
    expect(paths).toContain("SMTP_SECURE");
    expect(paths).not.toContain("IMAP_SECURE");
  });

  it("allows a fully local stack, which is what the exemption is for", () => {
    for (const host of ["localhost", "127.0.0.1", "::1"]) {
      expect(
        issuePaths(
          providerEnv({
            IMAP_HOST: host,
            SMTP_HOST: host,
            IMAP_SECURE: "false",
            SMTP_SECURE: "false",
          })
        )
      ).toEqual([]);
    }
  });

  it("does not police TLS when the provider is switched off", () => {
    // Nothing connects, so there is no transport to secure.
    expect(
      issuePaths({
        ...process.env,
        MAIL_PROVIDER_ENABLED: "false",
        IMAP_SECURE: "false",
        SMTP_SECURE: "false",
      })
    ).toEqual([]);
  });
});
