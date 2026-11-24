import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { inflateRawSync } from "node:zlib";
import { simpleParser } from "mailparser";
import {
  EICAR_SHA256,
  FORGED_VERDICT_HEADERS,
  eicar,
  eicarInZip,
  mimeMessage,
  nestedMessage,
  passwordProtectedZip,
  zip,
  zipBomb,
} from "./fixtures/threat-fixtures.js";

/**
 * The fixtures are the measuring stick for every later security test, so they
 * are tested first: a fixture that is not what it claims to be would make a
 * scanner look better or worse than it is. (The ZIP output was also checked
 * against Python's zipfile, an independent reader, when it was written.)
 */

function readEntries(archive: Buffer) {
  const end = archive.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  expect(end).toBeGreaterThan(0);
  const count = archive.readUInt16LE(end + 10);
  let cursor = archive.readUInt32LE(end + 16);
  const entries = [];
  for (let i = 0; i < count; i++) {
    expect(archive.readUInt32LE(cursor)).toBe(0x02014b50);
    const flags = archive.readUInt16LE(cursor + 8);
    const method = archive.readUInt16LE(cursor + 10);
    const crc = archive.readUInt32LE(cursor + 16);
    const compressed = archive.readUInt32LE(cursor + 20);
    const expanded = archive.readUInt32LE(cursor + 24);
    const nameLength = archive.readUInt16LE(cursor + 28);
    const localOffset = archive.readUInt32LE(cursor + 42);
    const name = archive.subarray(cursor + 46, cursor + 46 + nameLength).toString("utf8");
    expect(archive.readUInt32LE(localOffset)).toBe(0x04034b50);
    const dataStart = localOffset + 30 + archive.readUInt16LE(localOffset + 26) + archive.readUInt16LE(localOffset + 28);
    entries.push({ name, flags, method, crc, compressed, expanded, data: archive.subarray(dataStart, dataStart + compressed) });
    cursor += 46 + nameLength;
  }
  return entries;
}

describe("threat fixtures", () => {
  it("EICAR is the exact 68-byte industry test string", () => {
    const sample = eicar();
    expect(sample).toHaveLength(68);
    expect(createHash("sha256").update(sample).digest("hex")).toBe(EICAR_SHA256);
  });

  it("builds a ZIP whose stored and deflated entries read back exactly", () => {
    const entries = readEntries(zip([
      { name: "a.txt", data: Buffer.from("alpha") },
      { name: "b.txt", data: Buffer.from("bravo ".repeat(50)), deflate: true },
    ]));
    expect(entries.map((entry) => entry.name)).toEqual(["a.txt", "b.txt"]);
    expect(entries[0]!.data.toString()).toBe("alpha");
    expect(inflateRawSync(entries[1]!.data).toString()).toBe("bravo ".repeat(50));
  });

  it("marks a password-protected archive as encrypted, with ciphertext that is not the plaintext", () => {
    const [entry] = readEntries(passwordProtectedZip("pw"));
    expect(entry!.flags & 1).toBe(1);
    // 12-byte ZipCrypto header plus the deflated body.
    expect(entry!.compressed).toBeGreaterThan(12);
    expect(() => inflateRawSync(entry!.data.subarray(12))).toThrow();
  });

  it("produces a decompression bomb with a ratio over 500:1, without materialising it twice", () => {
    const expanded = 4 * 1024 * 1024;
    const [entry] = readEntries(zipBomb(expanded));
    expect(entry!.expanded).toBe(expanded);
    expect(entry!.expanded / entry!.compressed).toBeGreaterThan(500);
  });

  it("puts EICAR inside an archive unmodified", () => {
    const [entry] = readEntries(eicarInZip());
    expect(createHash("sha256").update(entry!.data).digest("hex")).toBe(EICAR_SHA256);
  });

  it("builds MIME that a real parser reads back with every attachment and the forged headers intact", async () => {
    const raw = mimeMessage({
      from: "a@outside.test",
      to: "b@zoiko.test",
      subject: "fixture",
      messageId: "<fixture@outside.test>",
      headers: FORGED_VERDICT_HEADERS,
      attachments: [
        { filename: "eicar.com", contentType: "application/octet-stream", content: eicar() },
        { filename: "invoice.zip", contentType: "application/zip", content: passwordProtectedZip() },
      ],
    });
    const parsed = await simpleParser(raw);
    expect(parsed.attachments.map((file) => file.filename)).toEqual(["eicar.com", "invoice.zip"]);
    expect(createHash("sha256").update(parsed.attachments[0]!.content).digest("hex")).toBe(EICAR_SHA256);
    expect(parsed.headers.get("x-ses-virus-verdict")).toBe("PASS");
  });

  it("nests messages to the requested depth", () => {
    const raw = nestedMessage(25, { from: "a@outside.test", to: "b@zoiko.test", messageId: "<n@outside.test>" });
    expect(raw.toString("latin1").match(/Content-Type: message\/rfc822/g)).toHaveLength(25);
  });
});
