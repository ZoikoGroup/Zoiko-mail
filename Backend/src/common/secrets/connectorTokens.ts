import type { ConnectorProvider } from "@prisma/client";
import { AppError } from "../errors/AppError.js";
import { ErrorCodes } from "../errors/errorCodes.js";
import { deleteSecret, getSecret, setSecret, type SecretAccessContext } from "./secrets.js";

/**
 * Deterministic Secret Manager ref for a connected account's OAuth token blob.
 *
 * The value stored at this ref is a compact JSON object carrying
 * `{ accessToken, refreshToken? }`. Keeping both tokens under one ref mirrors
 * how they were previously stored on the account row and lets refresh write
 * them back in a single secret version.
 *
 * Rules enforced here (Security §15):
 *   - never log or return token values (we only ever surface the ref),
 *   - every access is logged by ref name + purpose via the secret store.
 */

export interface ConnectorTokenPayload {
  accessToken: string;
  refreshToken?: string;
}

/** Deterministic, slug-safe ref: `connector-oauth/<provider>/<accountId>`. */
export function tokenSecretRef(provider: ConnectorProvider, providerAccountId: string): string {
  const slug = providerAccountId.replace(/[^a-zA-Z0-9_-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 128);
  return `connector-oauth/${provider.toLowerCase()}/${slug || "account"}`;
}

export function storeConnectorTokens(
  provider: ConnectorProvider,
  providerAccountId: string,
  payload: ConnectorTokenPayload,
  context: SecretAccessContext
): Promise<string> {
  const ref = tokenSecretRef(provider, providerAccountId);
  return setSecret(ref, JSON.stringify(payload), {
    ...context,
    purpose: `${context.purpose} (access + refresh token write)`,
  }).then(() => ref);
}

export async function readConnectorTokens(
  provider: ConnectorProvider,
  providerAccountId: string,
  ref: string | null | undefined,
  context: SecretAccessContext
): Promise<ConnectorTokenPayload | undefined> {
  if (!ref) return undefined;
  let value: string;
  try {
    value = await getSecret(ref, {
      ...context,
      purpose: `${context.purpose} (connector token read)`,
    });
  } catch (error) {
    // A missing provider token is a recoverable state (reauthorization needed),
    // not a server fault. `getSecret` throws exactly one such marker error; any
    // other failure (auth, permission) must keep propagating.
    if (error instanceof AppError && error.code === ErrorCodes.INTERNAL_ERROR && error.message.startsWith("Secret not available")) {
      return undefined;
    }
    throw error;
  }
  try {
    const parsed = JSON.parse(value) as Partial<ConnectorTokenPayload>;
    if (typeof parsed.accessToken !== "string") return undefined;
    return {
      accessToken: parsed.accessToken,
      refreshToken: typeof parsed.refreshToken === "string" ? parsed.refreshToken : undefined,
    };
  } catch {
    return undefined;
  }
}

export function deleteConnectorTokens(
  provider: ConnectorProvider,
  providerAccountId: string,
  ref: string | null | undefined,
  context: SecretAccessContext
): Promise<void> {
  const target = ref ?? tokenSecretRef(provider, providerAccountId);
  return deleteSecret(target, {
    ...context,
    purpose: `${context.purpose} (connector token delete on disconnect)`,
  });
}