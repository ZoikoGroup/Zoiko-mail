import { writeFile, readFile, unlink, mkdir, rename } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { SecretManagerServiceClient } from "@google-cloud/secret-manager";
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

/**
 * Secret storage behind one internal interface — Security §15, Infrastructure
 * §11 and §22 (Zoiko Cloud portability boundary).
 *
 * `get` is required everywhere. `set`/`delete` are required wherever the
 * application *writes* provider credentials (OAuth tokens for connectors).
 * A store that only reads (the original env-based store) is upgraded to a
 * writable store for local development so connector flows work without GCP.
 */
export interface SecretStore {
  readonly name: string;
  get(ref: string): Promise<string | undefined>;
  set?(ref: string, value: string): Promise<void>;
  delete?(ref: string): Promise<void>;
}

/**
 * A SecretStore that can write is the minimum a connector needs: OAuth tokens
 * must be persisted securely, and the whole point of this sprint is to keep
 * them out of the database. Local development without GCP uses a file-backed
 * store behind the same interface so the rest of the app never branches on
 * the backing store.
 */
export interface WritableSecretStore extends SecretStore {
  set(ref: string, value: string): Promise<void>;
  delete(ref: string): Promise<void>;
}

function isWritable(store: SecretStore): store is WritableSecretStore {
  return typeof store.set === "function" && typeof store.delete === "function";
}

function refToFileName(ref: string): string {
  // Secret refs are already slug-shaped (lowercase, digits, dashes), but a
  // provider account id could in principle inject path separators. Normalise
  // to a safe file name defensively.
  return `${ref.replace(/[^a-zA-Z0-9_-]+/g, "_").replace(/^_+|_+$/g, "")}.secret`;
}

/**
 * Local and CI store. Reads `SECRET_<UPPER_SNAKE_REF>` from the environment so
 * developers never need production credentials (Security §15: "Never production
 * secrets. Never committed.").
 *
 * For connector writes in local development this store is superseded by
 * `EnvWritableSecretStore` (see below); this plain class stays read-only and is
 * what tests and non-connector reads use.
 */
export class EnvSecretStore implements SecretStore {
  readonly name = "env";

  async get(ref: string): Promise<string | undefined> {
    const key = `SECRET_${ref.replace(/[^A-Za-z0-9]+/g, "_").toUpperCase()}`;
    return process.env[key];
  }
}

/**
 * File-backed writable store for local development when `SECRET_STORE=env`.
 *
 * Persists secrets to `SECRET_FILE_DIR` (default `.secrets/` under the backend
 * working directory) — a gitignored directory — so OAuth tokens survive a
 * process restart exactly as they would in the real Secret Manager. The file
 * contents are the raw secret value (like GCP), so the same access rules apply:
 * never log the value, only the ref.
 *
 * The file is written to a temp name and atomically renamed to avoid a torn
 * write if the process dies mid-write. Reads and deletes are plain.
 */
export class EnvWritableSecretStore implements WritableSecretStore {
  readonly name = "env-file";

  private directory(): string {
    return env.SECRET_FILE_DIR;
  }

  private async ensureDirectory(): Promise<void> {
    const dir = this.directory();
    if (!existsSync(dir)) {
      await mkdir(dir, { recursive: true });
    }
  }

  async get(ref: string): Promise<string | undefined> {
    const file = resolve(this.directory(), refToFileName(ref));
    try {
      return await readFile(file, "utf8");
    } catch {
      return undefined;
    }
  }

  async set(ref: string, value: string): Promise<void> {
    await this.ensureDirectory();
    const file = resolve(this.directory(), refToFileName(ref));
    const tmp = resolve(this.directory(), `${refToFileName(ref)}.${randomUUID()}.tmp`);
    await writeFile(tmp, value, "utf8");
    try {
      await rename(tmp, file);
    } catch (error) {
      await unlink(tmp).catch(() => undefined);
      throw error;
    }
  }

  async delete(ref: string): Promise<void> {
    const file = resolve(this.directory(), refToFileName(ref));
    await unlink(file).catch(() => undefined);
  }
}

/**
 * Production store backed by Google Cloud Secret Manager.
 *
 * Uses the official `@google-cloud/secret-manager` SDK. `set` creates the
 * secret if it does not exist and adds a version otherwise; `delete` removes
 * the whole secret. The `parent` (GCP project) is resolved from
 * `SECRET_MANAGER_PROJECT` env or the ADC default project.
 */
export class GcpSecretManagerStore implements WritableSecretStore {
  readonly name = "gcp-secret-manager";

  private client: SecretManagerServiceClient | null = null;

  private getClient(): SecretManagerServiceClient {
    this.client ??= new SecretManagerServiceClient();
    return this.client;
  }

  private parent(): string {
    if (env.SECRET_MANAGER_PROJECT) return `projects/${env.SECRET_MANAGER_PROJECT}`;
    // ADC can supply the default project; if neither is present, fail loudly
    // with a helpful message rather than guessing.
    return `projects/${process.env.GOOGLE_CLOUD_PROJECT ?? ""}`;
  }

  private secretName(ref: string): string {
    const parent = this.parent();
    // A missing ADC/GOOGLE_CLOUD_PROJECT default leaves `projects/` — a
    // malformed parent the SDK rejects. Catch that early with a clear error.
    if (!parent || parent.endsWith("/")) {
      throw new AppError(
        "GCP Secret Manager is not configured: set SECRET_MANAGER_PROJECT (or GOOGLE_CLOUD_PROJECT / ADC) and provide GOOGLE_APPLICATION_CREDENTIALS.",
        500,
        ErrorCodes.INTERNAL_ERROR
      );
    }
    const slug = ref.replace(/[^a-zA-Z0-9_-]+/g, "-").replace(/^-+|-+$/g, "").toLowerCase();
    return `${parent}/secrets/${slug}`;
  }

  async get(ref: string): Promise<string | undefined> {
    const client = this.getClient();
    try {
      const [version] = await client.accessSecretVersion({
        name: `${this.secretName(ref)}/versions/latest`,
      });
      const value = version.payload?.data?.toString();
      return value && value.length > 0 ? value : undefined;
    } catch (error) {
      // Distinguish "secret missing" (safe to treat as undefined) from
      // authentication/authorization failures (must surface).
      const code = (error as { code?: number })?.code;
      if (code === 5 /* NOT_FOUND */ || code === 404) return undefined;
      throw error;
    }
  }

  async set(ref: string, value: string): Promise<void> {
    const client = this.getClient();
    const name = this.secretName(ref);
    // Create the secret if it does not exist (NOT_FOUND), then add a version.
    try {
      await client.createSecret({
        parent: this.parent(),
        secretId: name.split("/").pop()!,
        secret: {},
      });
    } catch (error) {
      const code = (error as { code?: number })?.code;
      if (code !== 6 /* ALREADY_EXISTS */ && code !== 409) throw error;
    }
    await client.addSecretVersion({
      parent: name,
      payload: { data: Buffer.from(value, "utf8") },
    });
  }

  async delete(ref: string): Promise<void> {
    const client = this.getClient();
    try {
      await client.deleteSecret({ name: this.secretName(ref) });
    } catch (error) {
      const code = (error as { code?: number })?.code;
      if (code !== 5 /* NOT_FOUND */ && code !== 404) throw error;
    }
  }
}

/**
 * Local and CI store. Reads `SECRET_<UPPER_SNAKE_REF>` from the environment so
 * developers never need production credentials (Security §15: "Never production
 * secrets. Never committed.").
 */

let store: SecretStore = env.SECRET_STORE === "gcp" ? new GcpSecretManagerStore() : new EnvWritableSecretStore();

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

/**
 * Writes a secret value to the backing store and refreshes the local cache.
 * Never include the value in logs, errors, or API responses.
 *
 * Used for provider OAuth tokens, which must live outside the database.
 */
export async function setSecret(ref: string, value: string, context: SecretAccessContext): Promise<void> {
  if (!isWritable(store)) {
    throw new AppError(
      `Secret store "${store.name}" does not support writing secrets`,
      500,
      ErrorCodes.INTERNAL_ERROR
    );
  }
  await store.set(ref, value);
  cache.set(ref, { value, expiresAt: Date.now() + env.SECRET_CACHE_TTL_MS });
  logger.info(
    {
      secretRef: ref,
      secretSource: store.name,
      purpose: context.purpose,
      tenantId: context.tenantId,
      requestId: context.requestId,
    },
    "Secret written"
  );
}

/**
 * Deletes a secret value (and the store's backing record) and clears the cache
 * entry. Used on connector disconnect to revoke/clear provider credentials.
 * The ref name is safe to log; the value never is.
 */
export async function deleteSecret(ref: string, context: SecretAccessContext): Promise<void> {
  if (!isWritable(store)) {
    throw new AppError(
      `Secret store "${store.name}" does not support deleting secrets`,
      500,
      ErrorCodes.INTERNAL_ERROR
    );
  }
  await store.delete(ref);
  cache.delete(ref);
  logger.info(
    {
      secretRef: ref,
      secretSource: store.name,
      purpose: context.purpose,
      tenantId: context.tenantId,
      requestId: context.requestId,
    },
    "Secret deleted"
  );
}

export function logSecretAccess(ref: string, context: SecretAccessContext, source: string): void {
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
