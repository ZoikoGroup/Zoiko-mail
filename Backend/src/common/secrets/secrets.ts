import { AppError, ErrorCodes } from "../errors/index.js";
import { env } from "../../config/env.js";
import { logger } from "../../config/logger.js";

/**
 * Secret access behind one internal interface — Security §15, Infrastructure §11
 * and §22 (Zoiko Cloud portability boundary).
 *
 * Business logic calls getSecret(ref) and never a cloud SDK, so migrating from
 * Secret Manager to another vault is a single implementation swap. Two rules are
 * enforced here rather than left to reviewers:
 *
 *  - Secret *values* are never logged, returned in errors, or serialized.
 *  - Every access is logged by reference name (Security §6: "Token access must
 *    be logged"), which is what makes credential-misuse review possible.
 */

export interface SecretStore {
  readonly name: string;
  get(ref: string): Promise<string | undefined>;
}

/**
 * Local and CI store. Reads `SECRET_<UPPER_SNAKE_REF>` from the environment so
 * developers never need production credentials (Security §15: "Never production
 * secrets. Never committed.").
 */
export class EnvSecretStore implements SecretStore {
  readonly name = "env";

  async get(ref: string): Promise<string | undefined> {
    const key = `SECRET_${ref.replace(/[^A-Za-z0-9]+/g, "_").toUpperCase()}`;
    return process.env[key];
  }
}

/**
 * Placeholder for the GCP implementation. Deliberately throws rather than
 * silently falling back to the environment: a production deployment that has not
 * wired the vault must fail loudly, not read secrets from a less protected place.
 */
export class GcpSecretManagerStore implements SecretStore {
  readonly name = "gcp-secret-manager";

  async get(_ref: string): Promise<string | undefined> {
    throw new AppError(
      "GCP Secret Manager store is not wired yet; set SECRET_STORE=env for local development",
      500,
      ErrorCodes.INTERNAL_ERROR
    );
  }
}

let store: SecretStore = env.SECRET_STORE === "gcp" ? new GcpSecretManagerStore() : new EnvSecretStore();

/** Test seam and future DI point. */
export function setSecretStore(next: SecretStore): void {
  store = next;
}

export function activeSecretStoreName(): string {
  return store.name;
}

const cache = new Map<string, { value: string; expiresAt: number }>();

export interface SecretAccessContext {
  /** Why the secret is being read — appears in the access log. */
  purpose: string;
  tenantId?: string;
  requestId?: string;
}

/**
 * Resolves a secret by reference. Never include the returned value in logs,
 * error messages, audit metadata or API responses.
 */
export async function getSecret(ref: string, context: SecretAccessContext): Promise<string> {
  const cached = cache.get(ref);
  const now = Date.now();
  if (cached && cached.expiresAt > now) {
    logSecretAccess(ref, context, "cache");
    return cached.value;
  }

  const value = await store.get(ref);
  if (value === undefined || value === "") {
    // The reference name is safe to surface; the value never is.
    throw new AppError(`Secret not available: ${ref}`, 500, ErrorCodes.INTERNAL_ERROR);
  }

  cache.set(ref, { value, expiresAt: now + env.SECRET_CACHE_TTL_MS });
  logSecretAccess(ref, context, store.name);
  return value;
}

export function invalidateSecret(ref: string): void {
  cache.delete(ref);
}

export function clearSecretCache(): void {
  cache.clear();
}

function logSecretAccess(ref: string, context: SecretAccessContext, source: string): void {
  logger.info(
    {
      secretRef: ref,
      secretSource: source,
      purpose: context.purpose,
      tenantId: context.tenantId,
      requestId: context.requestId,
    },
    "Secret accessed"
  );
}
