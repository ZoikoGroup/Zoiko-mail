import { describe, expect, it } from "vitest";
import pino from "pino";
import { redactedFields } from "../src/config/logger.js";

/**
 * Rebuilds a logger with the production redaction list but writing to a buffer,
 * because the real logger is silent under NODE_ENV=test.
 */
function captureLog(payload: Record<string, unknown>): string {
  const lines: string[] = [];
  const stream = {
    write(chunk: string) {
      lines.push(chunk);
    },
  };
  const paths = redactedFields.flatMap((leaf) => [leaf, `*.${leaf}`, `*.*.${leaf}`]);
  const testLogger = pino(
    { level: "info", redact: { paths, censor: "[REDACTED]" } },
    stream as unknown as pino.DestinationStream
  );
  testLogger.info(payload, "test");
  return lines.join("");
}

describe("log redaction — Infrastructure §10, Data Model §9", () => {
  it("covers credentials, message content and provider payloads", () => {
    for (const field of ["password", "accessToken", "apiKey", "otpCode", "body", "sourceExcerpt", "rawPayload"]) {
      expect(redactedFields).toContain(field);
    }
  });

  it("redacts secrets at the top level", () => {
    const output = captureLog({ password: "hunter2", accessToken: "eyJhbGci" });
    expect(output).not.toContain("hunter2");
    expect(output).not.toContain("eyJhbGci");
    expect(output).toContain("[REDACTED]");
  });

  it("redacts message bodies so full email content never reaches logs", () => {
    const output = captureLog({ message: { subject: "Invoice 4402", body: "Bank details: 12345678" } });
    expect(output).not.toContain("Bank details");
    // Subject is C2 metadata and is allowed through.
    expect(output).toContain("Invoice 4402");
  });

  it("redacts two levels down", () => {
    const output = captureLog({ outer: { inner: { privateKey: "-----BEGIN KEY-----" } } });
    expect(output).not.toContain("BEGIN KEY");
  });

  it("keeps identifiers that support and audit need", () => {
    const output = captureLog({ requestId: "req-1", tenantId: "ten-1", secretRef: "provider-oauth" });
    expect(output).toContain("req-1");
    expect(output).toContain("ten-1");
    // The reference name is safe; only the value is sensitive.
    expect(output).toContain("provider-oauth");
  });
});
