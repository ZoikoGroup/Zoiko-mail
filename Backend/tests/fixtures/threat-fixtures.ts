import { crc32, deflateRawSync } from "node:zlib";
import { randomBytes } from "node:crypto";

/**
 * Vendor-neutral threat fixtures for the Mail security acceptance tests
 * (Security Foundation Handoff ZM-SEC-HO-001 §14, ZMT-01..ZMT-09; Master
 * Architecture ZS-ZM-ENG-003 §13, A01..A05).
 *
 * P0 builds these before any scanner is chosen (decision D-02) so the same
 * inputs can be run against today's pipeline as a baseline and, unchanged,
 * against the scanner once it exists. Nothing here is real malware: the
 * "malware" sample is the industry EICAR test string, which every engine
 * detects by agreement and which does nothing.
 *
 * Everything is generated in memory at run time. The EICAR string is
 * assembled from pieces so that no file in the repository carries it whole,
 * which would otherwise get the source file itself quarantined by the
 * developer's own antivirus.
 */

// ── EICAR ─────────────────────────────────────────────────────────────────

/** The 68-byte EICAR anti-malware test file. SHA-256 275a021b…51fd0f. */
export function eicar(): Buffer {
  const head = "X5O!P%@AP[4\\PZX54(P^)7CC)7}$";
  const middle = String.fromCharCode(69, 73, 67, 65, 82) + "-STANDARD-ANTIVIRUS-TEST-FILE!";
  const tail = "$H+H*";
  return Buffer.from(head + middle + tail, "ascii");
}

export const EICAR_SHA256 = "275a021bbfb6489e54d471899f7db9d1663fc695ec2fe2a2c4538aabf651fd0f";

// ── ZIP archives ───────────────────────────────────────────────────────────

export interface ZipEntryInput {
  name: string;
  data: Buffer;
  /** Deflate the data (method 8) instead of storing it (method 0). */
  deflate?: boolean;
  /** Encrypt with traditional PKWARE ZipCrypto under this password. */
  password?: string;
}

const DOS_DATE_1980_01_01 = (0 << 9) | (1 << 5) | 1;

/**
 * A spec-conformant ZIP (APPNOTE 6.3.x) built from scratch, so fixtures do not
 * depend on an archiving library behaving the way a test needs. Supports
 * stored and deflated entries and traditional ZipCrypto, which is what a
 * "password-protected zip" from an ordinary sender is.
 */
export function zip(entries: ZipEntryInput[]): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;

  for (const entry of entries) {
    const name = Buffer.from(entry.name, "utf8");
    const checksum = crc32(entry.data) >>> 0;
    const method = entry.deflate ? 8 : 0;
    let body = entry.deflate ? deflateRawSync(entry.data) : entry.data;
    let flags = 0x0800; // UTF-8 names
    if (entry.password !== undefined) {
      body = zipCryptoEncrypt(body, entry.password, checksum);
      flags |= 0x0001;
    }

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(flags, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(0, 10);
    local.writeUInt16LE(DOS_DATE_1980_01_01, 12);
    local.writeUInt32LE(checksum, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(entry.data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    locals.push(local, name, body);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(flags, 8);
    central.writeUInt16LE(method, 10);
    central.writeUInt16LE(0, 12);
    central.writeUInt16LE(DOS_DATE_1980_01_01, 14);
    central.writeUInt32LE(checksum, 16);
    central.writeUInt32LE(body.length, 20);
    central.writeUInt32LE(entry.data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, name);

    offset += local.length + name.length + body.length;
  }

  const directory = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, end]);
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

const crcByte = (crc: number, byte: number) => (CRC_TABLE[(crc ^ byte) & 0xff]! ^ (crc >>> 8)) >>> 0;

/** Traditional PKWARE encryption (APPNOTE §6.1): 12-byte header, then the data. */
function zipCryptoEncrypt(data: Buffer, password: string, checksum: number): Buffer {
  const keys = [0x12345678, 0x23456789, 0x34567890];
  const update = (byte: number) => {
    keys[0] = crcByte(keys[0]!, byte);
    keys[1] = (Math.imul((keys[1]! + (keys[0]! & 0xff)) >>> 0, 134775813) + 1) >>> 0;
    keys[2] = crcByte(keys[2]!, keys[1]! >>> 24);
  };
  const stream = () => {
    const temp = (keys[2]! | 2) & 0xffff;
    return (Math.imul(temp, temp ^ 1) >>> 8) & 0xff;
  };
  for (const byte of Buffer.from(password, "utf8")) update(byte);

  const header = randomBytes(12);
  header[11] = checksum >>> 24; // the check byte readers verify the password against
  const plain = Buffer.concat([header, data]);
  const out = Buffer.alloc(plain.length);
  for (let i = 0; i < plain.length; i++) {
    const p = plain[i]!;
    out[i] = p ^ stream();
    update(p);
  }
  return out;
}

/** ZMT-05: a password-protected archive, the canonical UNSCANNABLE input. */
export function passwordProtectedZip(password = "invoice-2026"): Buffer {
  return zip([{ name: "invoice.pdf", data: Buffer.from("%PDF-1.4\n% encrypted invoice fixture\n"), deflate: true, password }]);
}

/**
 * ZMT-06: a decompression bomb. `expandedBytes` of zeros deflate to roughly a
 * thousandth of that, so the archive is small on the wire and large on
 * expansion. The default (32 MiB) is enough to prove a ratio limit without
 * making the test itself heavy.
 */
export function zipBomb(expandedBytes = 32 * 1024 * 1024): Buffer {
  return zip([{ name: "data.bin", data: Buffer.alloc(expandedBytes), deflate: true }]);
}

/** An archive carrying the EICAR file, for engines that must look inside archives. */
export function eicarInZip(): Buffer {
  return zip([{ name: "eicar.com", data: eicar() }]);
}

// ── MIME messages ──────────────────────────────────────────────────────────

export interface FixtureAttachment {
  filename: string;
  contentType: string;
  content: Buffer;
}

export interface FixtureMessage {
  from: string;
  to: string;
  subject: string;
  messageId: string;
  text?: string;
  /** Extra header lines, written verbatim before the MIME headers. */
  headers?: string[];
  attachments?: FixtureAttachment[];
}

const wrap76 = (base64: string) => base64.replace(/.{1,76}/g, (line) => `${line}\r\n`);

/** An RFC 5322 / 2045 message with base64 attachments, CRLF line endings. */
export function mimeMessage(input: FixtureMessage): Buffer {
  const boundary = `zoiko-fixture-${randomBytes(8).toString("hex")}`;
  const head = [
    `From: ${input.from}`,
    `To: ${input.to}`,
    `Subject: ${input.subject}`,
    `Message-ID: ${input.messageId}`,
    "Date: Mon, 23 Nov 2026 10:00:00 +0000",
    ...(input.headers ?? []),
    "MIME-Version: 1.0",
  ];
  const text = input.text ?? "Fixture body.";
  if (!input.attachments?.length) {
    return Buffer.from([...head, "Content-Type: text/plain; charset=utf-8", "", text, ""].join("\r\n"));
  }
  const parts = [
    [`--${boundary}`, "Content-Type: text/plain; charset=utf-8", "", text].join("\r\n"),
    ...input.attachments.map((file) =>
      [
        `--${boundary}`,
        `Content-Type: ${file.contentType}; name="${file.filename}"`,
        `Content-Disposition: attachment; filename="${file.filename}"`,
        "Content-Transfer-Encoding: base64",
        "",
        wrap76(file.content.toString("base64")),
      ].join("\r\n")
    ),
  ];
  return Buffer.from(
    [...head, `Content-Type: multipart/mixed; boundary="${boundary}"`, "", ...parts, `--${boundary}--`, ""].join("\r\n")
  );
}

/**
 * ZMT-06: `depth` messages, each attached inside the one before
 * (message/rfc822 within multipart/mixed). Parsers that recurse without a
 * limit exhaust the stack or memory on inputs like this.
 */
export function nestedMessage(depth: number, base: Pick<FixtureMessage, "from" | "to" | "messageId" | "headers">): Buffer {
  let inner = Buffer.from(["Subject: innermost", "Content-Type: text/plain", "", "core", ""].join("\r\n"));
  for (let level = depth; level > 0; level--) {
    const boundary = `nest-${level}`;
    inner = Buffer.from(
      [
        `Subject: level ${level}`,
        "MIME-Version: 1.0",
        `Content-Type: multipart/mixed; boundary="${boundary}"`,
        "",
        `--${boundary}`,
        "Content-Type: message/rfc822",
        "",
        inner.toString("latin1"),
        `--${boundary}--`,
        "",
      ].join("\r\n"),
      "latin1"
    );
  }
  const head = [`From: ${base.from}`, `To: ${base.to}`, `Message-ID: ${base.messageId}`, ...(base.headers ?? [])];
  return Buffer.concat([Buffer.from(head.join("\r\n") + "\r\n", "latin1"), inner]);
}

/**
 * ZMT-08: verdict and authentication headers a sender can write into its own
 * message. Only results from the verified ingress may count; these must not.
 */
export const FORGED_VERDICT_HEADERS = [
  "X-SES-Spam-Verdict: PASS",
  "X-SES-Virus-Verdict: PASS",
  "X-Zoiko-Security-Verdict: CLEAN",
  "X-Spam-Status: No, score=-100",
  "Authentication-Results: mx.zoikomail.com; spf=pass smtp.mailfrom=bank.test; dkim=pass header.d=bank.test; dmarc=pass header.from=bank.test",
  "Received-SPF: pass (zoikomail.com: domain of bank.test designates 203.0.113.7 as permitted sender)",
];
