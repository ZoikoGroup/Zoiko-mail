import { AppError, ErrorCodes } from "../errors/index.js";
import { env } from "../../config/env.js";

/**
 * Feature flags and kill switches — Infrastructure spec §15.
 *
 * Two properties matter more than the flag list itself:
 *
 *  1. A global "off" is a kill switch. It cannot be re-enabled by a narrower
 *     override, so disabling a capability during an incident is one env change
 *     and a restart — no database write, no deploy.
 *  2. Scope resolution is most-specific-wins *within* an enabled global, so a
 *     single tenant, domain or mailbox can be stopped without affecting others.
 *
 * Global defaults come from the environment. Narrower overrides are supplied by
 * an injected resolver so this module stays free of database dependencies;
 * roadmap item 23 wires it into the permission pipeline as evaluation step 9.
 */

export const FLAGS = [
  "connector_gmail_enabled",
  "connector_m365_enabled",
  "ai_extraction_enabled",
  "ai_drafting_enabled",
  "hosted_mail_pilot_enabled",
  "outbound_sending_enabled",
  "custom_domain_enabled",
  "provider_callbacks_accepting",
  "google_login_enabled",
] as const;

export type FlagName = (typeof FLAGS)[number];

/** Scopes each flag may legitimately be narrowed to. */
const FLAG_SCOPES: Record<FlagName, ReadonlyArray<keyof FlagScope>> = {
  connector_gmail_enabled: ["tenantId"],
  connector_m365_enabled: ["tenantId"],
  ai_extraction_enabled: ["tenantId", "mailboxId"],
  ai_drafting_enabled: ["tenantId", "mailboxId"],
  hosted_mail_pilot_enabled: ["tenantId"],
  outbound_sending_enabled: ["tenantId", "domainId", "mailboxId"],
  custom_domain_enabled: ["tenantId"],
  provider_callbacks_accepting: ["provider"],
  google_login_enabled: ["tenantId"],
};

export interface FlagScope {
  tenantId?: string;
  domainId?: string;
  mailboxId?: string;
  provider?: string;
}

/**
 * Returns false to force-disable at a narrower scope, true to explicitly allow,
 * or undefined to defer to the global default. Never called when the global
 * default is off — a kill switch is not overridable.
 */
export type FlagOverrideResolver = (name: FlagName, scope: FlagScope) => boolean | undefined;

let overrideResolver: FlagOverrideResolver | undefined;

export function setFlagOverrideResolver(resolver: FlagOverrideResolver | undefined): void {
  overrideResolver = resolver;
}

function globalDefault(name: FlagName): boolean {
  switch (name) {
    case "connector_gmail_enabled":
      return env.FLAG_CONNECTOR_GMAIL_ENABLED;
    case "connector_m365_enabled":
      return env.FLAG_CONNECTOR_M365_ENABLED;
    case "ai_extraction_enabled":
      return env.FLAG_AI_EXTRACTION_ENABLED;
    case "ai_drafting_enabled":
      return env.FLAG_AI_DRAFTING_ENABLED;
    case "hosted_mail_pilot_enabled":
      return env.FLAG_HOSTED_MAIL_PILOT_ENABLED;
    case "outbound_sending_enabled":
      return env.FLAG_OUTBOUND_SENDING_ENABLED;
    case "custom_domain_enabled":
      return env.FLAG_CUSTOM_DOMAIN_ENABLED;
    case "provider_callbacks_accepting":
      return env.FLAG_PROVIDER_CALLBACKS_ACCEPTING;
    case "google_login_enabled":
      return env.FLAG_GOOGLE_LOGIN_ENABLED;
  }
}

/** Rejects a scope key the flag does not support, so typos fail loudly. */
function assertScopeSupported(name: FlagName, scope: FlagScope): void {
  const allowed = FLAG_SCOPES[name];
  for (const key of Object.keys(scope) as Array<keyof FlagScope>) {
    if (scope[key] === undefined) continue;
    if (!allowed.includes(key)) {
      throw new AppError(
        `Flag ${name} cannot be scoped by ${key}`,
        500,
        ErrorCodes.INTERNAL_ERROR
      );
    }
  }
}

export function isFlagEnabled(name: FlagName, scope: FlagScope = {}): boolean {
  assertScopeSupported(name, scope);

  // A global off is a kill switch: no narrower scope may re-enable it.
  if (!globalDefault(name)) return false;
  if (!overrideResolver) return true;

  const override = overrideResolver(name, scope);
  return override === undefined ? true : override;
}

/** Throws 403 when the capability is switched off for this scope. */
export function assertFlagEnabled(name: FlagName, scope: FlagScope = {}): void {
  if (isFlagEnabled(name, scope)) return;
  throw new AppError(
    `This capability is currently disabled (${name})`,
    403,
    // Distinct from FORBIDDEN on purpose: the caller has the permission, the
    // capability is switched off. Clients must not treat this as access denied.
    ErrorCodes.FEATURE_DISABLED
  );
}

/** Snapshot for the admin surface and for /me/capabilities nav gating. */
export function flagSnapshot(scope: FlagScope = {}): Record<FlagName, boolean> {
  const snapshot = {} as Record<FlagName, boolean>;
  for (const name of FLAGS) {
    const supported = FLAG_SCOPES[name];
    const narrowed: FlagScope = {};
    for (const key of supported) {
      if (scope[key] !== undefined) narrowed[key] = scope[key];
    }
    snapshot[name] = isFlagEnabled(name, narrowed);
  }
  return snapshot;
}
