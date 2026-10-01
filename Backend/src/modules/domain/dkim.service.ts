import { generateKeyPair } from "node:crypto";
import { promisify } from "node:util";
import type { Prisma } from "@prisma/client";
import { prisma } from "../../config/prisma.js";
import { env } from "../../config/env.js";
import { logger } from "../../config/logger.js";
import { deleteSecret, getSecret, setSecret } from "../../common/secrets/secrets.js";

const generateKeyPairAsync = promisify(generateKeyPair);

/**
 * DKIM keys for custom domains.
 *
 * The private half never touches the database. It is written to the secret
 * store (Secret Manager in production, a gitignored directory locally) under
 * a ref derived from the domain and selector, and the row keeps only that ref
 * and the public half — which is public by definition, since it is published
 * in DNS. A database dump therefore cannot sign mail as a customer's domain.
 */

export interface GeneratedDkimKey {
  selector: string;
  keyBits: number;
  publicKey: string;
  privateKeySecretRef: string;
}

export function dkimSecretRef(domainId: string, selector: string): string {
  return `domain-dkim/${domainId}/${selector}`;
}

/**
 * A selector that sorts by date and is unique within the domain:
 * zm202609, then zm202609b, zm202609c if the key rotates twice in a month.
 * Dated selectors make it obvious in a DNS dashboard which key is current.
 */
export function nextSelector(existing: string[], now = new Date()): string {
  const stamp = `${env.DNS_DKIM_SELECTOR_PREFIX}${now.getUTCFullYear()}${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
  if (!existing.includes(stamp)) return stamp;
  for (let code = 98; code <= 122; code += 1) {
    const candidate = `${stamp}${String.fromCharCode(code)}`;
    if (!existing.includes(candidate)) return candidate;
  }
  return `${stamp}${Date.now().toString(36)}`;
}

export class DkimService {
  /**
   * Generates a key pair and stores the private half. The caller writes the
   * row; if that fails it must call `discard` so no orphaned secret remains.
   */
  async generate(domainId: string, tenantId: string, existingSelectors: string[]): Promise<GeneratedDkimKey> {
    const keyBits = env.DNS_DKIM_KEY_BITS;
    const { publicKey, privateKey } = await generateKeyPairAsync("rsa", {
      modulusLength: keyBits,
      publicKeyEncoding: { type: "spki", format: "der" },
      privateKeyEncoding: { type: "pkcs8", format: "pem" },
    });
    const selector = nextSelector(existingSelectors);
    const privateKeySecretRef = dkimSecretRef(domainId, selector);
    await setSecret(privateKeySecretRef, privateKey, { purpose: "DKIM private key (generate)", tenantId });
    return {
      selector,
      keyBits,
      // DNS publishes the DER SubjectPublicKeyInfo, base64, as the p= tag.
      publicKey: Buffer.from(publicKey).toString("base64"),
      privateKeySecretRef,
    };
  }

  async discard(secretRef: string, tenantId: string): Promise<void> {
    await deleteSecret(secretRef, { purpose: "DKIM private key (discard)", tenantId }).catch((error: unknown) => {
      logger.warn({ error, secretRef }, "DKIM private key could not be deleted");
    });
  }

  /** Creates a key row inside the caller's transaction. */
  createRow(tx: Prisma.TransactionClient, input: GeneratedDkimKey & { domainId: string; tenantId: string; active: boolean }) {
    return tx.domainDkimKey.create({
      data: {
        tenantId: input.tenantId,
        domainId: input.domainId,
        selector: input.selector,
        keyBits: input.keyBits,
        publicKey: input.publicKey,
        privateKeySecretRef: input.privateKeySecretRef,
        status: input.active ? "ACTIVE" : "PENDING",
        activatedAt: input.active ? new Date() : null,
      },
    });
  }

  /**
   * The key outbound mail from `domainName` should be signed with, or null
   * when the domain is not sending or has no active key. Signing with a key
   * whose record is not published would make DKIM fail outright, which is
   * worse than not signing.
   */
  async signingKeyFor(tenantId: string, domainName: string): Promise<{ domainName: string; keySelector: string; privateKey: string } | null> {
    const key = await prisma.domainDkimKey.findFirst({
      where: {
        tenantId,
        status: "ACTIVE",
        domain: { tenantId, domainName: domainName.toLowerCase(), sendingEnabled: true },
      },
      select: { selector: true, privateKeySecretRef: true },
    });
    if (!key) return null;
    try {
      const privateKey = await getSecret(key.privateKeySecretRef, { purpose: "DKIM signing", tenantId });
      return { domainName: domainName.toLowerCase(), keySelector: key.selector, privateKey };
    } catch (error) {
      // Sending unsigned is recoverable; failing the send over a missing key
      // would turn a secret-store hiccup into lost mail.
      logger.error({ error, tenantId, domainName }, "DKIM private key unavailable; sending unsigned");
      return null;
    }
  }
}

export const dkimService = new DkimService();
