import { env } from "../../config/env.js";
import { logger } from "../../config/logger.js";
import { getSecret, invalidateSecret } from "../../common/secrets/secrets.js";
import {
  JMAP_CORE,
  STALWART_CAPABILITY,
  StalwartError,
  type CreateHostedAccountInput,
  type HostedAccount,
  type HostedDomain,
  type MailHostingProvider,
  type StalwartErrorCode,
} from "./stalwart.types.js";

type Invocation = [string, Record<string, unknown>, string];

interface SessionInfo {
  apiUrl: string;
  /** The account management calls run against, when the session names one. */
  accountId?: string;
  expiresAt: number;
}

const SESSION_TTL_MS = 10 * 60 * 1000;

/** JMAP SetError types that mean "that thing is already there". */
const DUPLICATE_TYPES = /alreadyExists|primaryKey|duplicate|conflict/i;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function fail(message: string, code: StalwartErrorCode, retryable: boolean, httpStatus?: number, jmapType?: string): never {
  throw new StalwartError(message, code, retryable, httpStatus, jmapType);
}

export interface StalwartClientOptions {
  /** Test seam. Production uses the global fetch. */
  fetch?: typeof fetch;
  /** Test seam. Production reads the key from the secret store. */
  token?: () => Promise<string>;
  baseUrl?: string;
  enabled?: boolean;
}

/**
 * Server-to-server client for Stalwart's JMAP management API (v0.16+).
 *
 * Every call carries the API key as a Bearer token; the key is read from the
 * secret store, never from the request, and never leaves this module. The
 * browser never talks to Stalwart.
 *
 * Errors are reduced to `StalwartError` with a code the provisioning flow can
 * act on. Response bodies are not copied into messages or logs: a provider
 * error can echo request data, and a mailbox address with a password beside it
 * is exactly what must not reach a log line.
 */
export class StalwartClient implements MailHostingProvider {
  readonly name = "STALWART" as const;
  private session: SessionInfo | null = null;

  constructor(private readonly options: StalwartClientOptions = {}) {}

  private get baseUrl(): string | undefined {
    return (this.options.baseUrl ?? env.STALWART_BASE_URL)?.replace(/\/+$/, "");
  }

  isConfigured(): boolean {
    return (this.options.enabled ?? env.STALWART_ENABLED) && Boolean(this.baseUrl);
  }

  private async token(): Promise<string> {
    if (this.options.token) return this.options.token();
    try {
      return await getSecret(env.STALWART_API_TOKEN_REF, { purpose: "Stalwart management API" });
    } catch {
      fail("The Stalwart API key is not available in the secret store", "NOT_CONFIGURED", false);
    }
  }

  private async http(url: string, init: { method: "GET" | "POST"; body?: unknown }): Promise<unknown> {
    if (!this.isConfigured()) fail("Stalwart is not configured", "NOT_CONFIGURED", false);
    const doFetch = this.options.fetch ?? fetch;
    let response: Response;
    try {
      response = await doFetch(url, {
        method: init.method,
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${await this.token()}`,
          ...(init.body !== undefined ? { "Content-Type": "application/json" } : {}),
        },
        body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
        redirect: "error",
        signal: AbortSignal.timeout(env.STALWART_TIMEOUT_MS),
      });
    } catch (error) {
      if (error instanceof StalwartError) throw error;
      const timedOut = error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
      // A timeout is ambiguous for a write: the server may have applied it.
      // The caller reconciles before retrying, so it is marked retryable.
      if (timedOut) fail("Stalwart did not respond in time", "TIMEOUT", true);
      fail("Stalwart could not be reached", "UNREACHABLE", true);
    }

    const text = await response.text();
    let body: unknown = null;
    if (text) {
      try {
        body = JSON.parse(text);
      } catch {
        body = null;
      }
    }

    if (response.status === 401) {
      // A rotated key: drop the cached copy so the next attempt re-reads it.
      invalidateSecret(env.STALWART_API_TOKEN_REF);
      this.session = null;
      fail("Stalwart rejected the API key", "AUTH_FAILED", false, 401);
    }
    if (response.status === 403) fail("The Stalwart API key lacks the required permission", "FORBIDDEN", false, 403);
    if (response.status === 429) fail("Stalwart is rate limiting requests", "RATE_LIMITED", true, 429);
    if (response.status >= 500) fail("Stalwart is unavailable", "UNAVAILABLE", true, response.status);
    if (!response.ok) {
      const type = isRecord(body) && typeof body.type === "string" ? body.type : undefined;
      if (type?.endsWith(":unknownCapability")) {
        fail("This Stalwart server does not offer the JMAP management capability", "NOT_SUPPORTED", false, response.status, type);
      }
      fail("Stalwart refused the request", "INVALID_REQUEST", false, response.status, type);
    }
    if (body === null) fail("Stalwart returned a response that is not JSON", "UNEXPECTED_RESPONSE", true, response.status);
    return body;
  }

  /**
   * The JMAP session: where to send method calls, and which account they run
   * against. Read rather than assumed, which is what RFC 8620 §2 asks of a
   * client and what settles the `accountId` question without guessing.
   */
  private async resolveSession(): Promise<SessionInfo> {
    if (this.session && this.session.expiresAt > Date.now()) return this.session;
    const base = this.baseUrl!;
    const body = await this.http(`${base}/jmap/session`, { method: "GET" });
    if (!isRecord(body) || !isRecord(body.capabilities)) {
      fail("Stalwart returned an unexpected session object", "UNEXPECTED_RESPONSE", true);
    }
    if (!(STALWART_CAPABILITY in body.capabilities)) {
      fail(
        "The Stalwart session does not include the management capability; check the server version and the API key's permissions",
        "NOT_SUPPORTED",
        false
      );
    }
    // Only follow an apiUrl on the configured origin. The session is server
    // input, and the Authorization header goes wherever apiUrl points.
    let apiUrl = `${base}/jmap/`;
    if (typeof body.apiUrl === "string") {
      try {
        if (new URL(body.apiUrl).origin === new URL(base).origin) apiUrl = body.apiUrl;
      } catch {
        // Keep the default.
      }
    }
    const primary = isRecord(body.primaryAccounts) ? body.primaryAccounts[STALWART_CAPABILITY] : undefined;
    this.session = {
      apiUrl,
      accountId: typeof primary === "string" ? primary : undefined,
      expiresAt: Date.now() + SESSION_TTL_MS,
    };
    return this.session;
  }

  private async call(invocations: Invocation[]): Promise<Map<string, [string, Record<string, unknown>]>> {
    const session = await this.resolveSession();
    const methodCalls = invocations.map(([method, args, id]) => [
      method,
      session.accountId && !("accountId" in args) ? { accountId: session.accountId, ...args } : args,
      id,
    ]);
    const body = await this.http(session.apiUrl, {
      method: "POST",
      body: { using: [JMAP_CORE, STALWART_CAPABILITY], methodCalls },
    });
    if (!isRecord(body) || !Array.isArray(body.methodResponses)) {
      fail("Stalwart returned an unexpected JMAP response", "UNEXPECTED_RESPONSE", true);
    }
    const responses = new Map<string, [string, Record<string, unknown>]>();
    for (const entry of body.methodResponses) {
      if (!Array.isArray(entry) || typeof entry[0] !== "string" || !isRecord(entry[1]) || typeof entry[2] !== "string") {
        fail("Stalwart returned a malformed method response", "UNEXPECTED_RESPONSE", true);
      }
      const [name, args, id] = entry as [string, Record<string, unknown>, string];
      if (name === "error") {
        const type = typeof args.type === "string" ? args.type : "unknown";
        if (type === "forbidden") fail("The Stalwart API key lacks the required permission", "FORBIDDEN", false, undefined, type);
        if (type === "unknownMethod") fail("This Stalwart server does not support the management method", "NOT_SUPPORTED", false, undefined, type);
        if (type === "serverUnavailable" || type === "serverFail") fail("Stalwart could not complete the request", "UNAVAILABLE", true, undefined, type);
        fail("Stalwart rejected the request", "INVALID_REQUEST", false, undefined, type);
      }
      responses.set(id, [name, args]);
    }
    return responses;
  }

  private static list(response: [string, Record<string, unknown>] | undefined): Record<string, unknown>[] {
    if (!response || !Array.isArray(response[1].list)) {
      fail("Stalwart returned an unexpected get response", "UNEXPECTED_RESPONSE", true);
    }
    return response[1].list.filter(isRecord);
  }

  /** The created object's id, or a mapped error from `notCreated`. */
  private static created(response: [string, Record<string, unknown>] | undefined, key: string): string {
    if (!response) fail("Stalwart returned no set response", "UNEXPECTED_RESPONSE", true);
    const args = response[1];
    const created = isRecord(args.created) ? args.created[key] : undefined;
    if (isRecord(created) && typeof created.id === "string") return created.id;
    const notCreated = isRecord(args.notCreated) ? args.notCreated[key] : undefined;
    if (isRecord(notCreated)) {
      const type = typeof notCreated.type === "string" ? notCreated.type : "unknown";
      if (DUPLICATE_TYPES.test(type)) fail("That object already exists in Stalwart", "ALREADY_EXISTS", false, undefined, type);
      if (type === "forbidden") fail("The Stalwart API key lacks the required permission", "FORBIDDEN", false, undefined, type);
      fail("Stalwart refused to create the object", "INVALID_REQUEST", false, undefined, type);
    }
    fail("Stalwart did not confirm the object was created", "UNEXPECTED_RESPONSE", true);
  }

  private static toAccount(raw: Record<string, unknown>): HostedAccount {
    if (typeof raw.id !== "string" || typeof raw.name !== "string" || typeof raw.domainId !== "string") {
      fail("Stalwart returned an account without its identifying fields", "UNEXPECTED_RESPONSE", true);
    }
    const quota = isRecord(raw.quotas) ? raw.quotas.maxDiskQuota : undefined;
    return {
      id: raw.id,
      name: raw.name,
      domainId: raw.domainId,
      emailAddress: typeof raw.emailAddress === "string" ? raw.emailAddress : null,
      description: typeof raw.description === "string" ? raw.description : null,
      diskQuotaBytes: typeof quota === "number" ? quota : null,
    };
  }

  async findDomain(domainName: string): Promise<HostedDomain | null> {
    const wanted = domainName.toLowerCase();
    const responses = await this.call([
      ["x:Domain/query", { filter: { name: wanted } }, "q"],
      ["x:Domain/get", { "#ids": { resultOf: "q", name: "x:Domain/query", path: "/ids" }, properties: ["name"] }, "g"],
    ]);
    // The `name` filter is a text search, so a match is confirmed exactly here.
    const match = StalwartClient.list(responses.get("g")).find(
      (domain) => typeof domain.name === "string" && domain.name.toLowerCase() === wanted && typeof domain.id === "string"
    );
    return match ? { id: match.id as string, name: match.name as string } : null;
  }

  /**
   * Register a domain, with every management mode set to Manual.
   *
   * Manual DNS: the customer's DNS is the customer's, and Zoiko already tells
   * them what to publish. Manual certificates: TLS for mail.zoikomail.com is
   * configured on the server, not per customer domain. Manual DKIM: Zoiko
   * generates and publishes the domain's DKIM key itself (dkim.service.ts);
   * a second, Stalwart-generated key would not match what was published.
   */
  async createDomain(domainName: string): Promise<HostedDomain> {
    const name = domainName.toLowerCase();
    const responses = await this.call([
      [
        "x:Domain/set",
        {
          create: {
            d: {
              name,
              aliases: {},
              certificateManagement: { "@type": "Manual" },
              dkimManagement: { "@type": "Manual" },
              dnsManagement: { "@type": "Manual" },
              subAddressing: { "@type": "Enabled" },
            },
          },
        },
        "s",
      ],
    ]);
    const id = StalwartClient.created(responses.get("s"), "d");
    logger.info({ provider: "stalwart", domain: name }, "Stalwart domain created");
    return { id, name };
  }

  async findAccount(name: string, domainId: string): Promise<HostedAccount | null> {
    const wanted = name.toLowerCase();
    const responses = await this.call([
      ["x:Account/query", { filter: { name: wanted, domainId } }, "q"],
      [
        "x:Account/get",
        {
          "#ids": { resultOf: "q", name: "x:Account/query", path: "/ids" },
          properties: ["name", "domainId", "emailAddress", "description", "quotas"],
        },
        "g",
      ],
    ]);
    const match = StalwartClient.list(responses.get("g")).find(
      (account) =>
        typeof account.name === "string" && account.name.toLowerCase() === wanted && account.domainId === domainId
    );
    return match ? StalwartClient.toAccount(match) : null;
  }

  async getAccount(id: string): Promise<HostedAccount | null> {
    const responses = await this.call([
      ["x:Account/get", { ids: [id], properties: ["name", "domainId", "emailAddress", "description", "quotas"] }, "g"],
    ]);
    const match = StalwartClient.list(responses.get("g")).find((account) => account.id === id);
    return match ? StalwartClient.toAccount(match) : null;
  }

  async createAccount(input: CreateHostedAccountInput): Promise<HostedAccount> {
    const responses = await this.call([
      [
        "x:Account/set",
        {
          create: {
            a: {
              "@type": "User",
              name: input.name.toLowerCase(),
              domainId: input.domainId,
              credentials: [{ "@type": "Password", secret: input.secret }],
              roles: { "@type": "User" },
              permissions: { "@type": "Inherit" },
              quotas: { maxDiskQuota: input.diskQuotaBytes },
              encryptionAtRest: { "@type": "Disabled" },
              description: input.description,
            },
          },
        },
        "s",
      ],
    ]);
    const id = StalwartClient.created(responses.get("s"), "a");
    // Read back rather than trusting the create response: success is reported
    // only for an account the server will actually show us.
    const account = await this.getAccount(id);
    if (!account) fail("Stalwart reported the account created but cannot find it", "UNEXPECTED_RESPONSE", true);
    logger.info({ provider: "stalwart", accountId: id }, "Stalwart account created");
    return account;
  }

  async probe() {
    try {
      this.session = null;
      await this.resolveSession();
      return { reachable: true, authenticated: true, managementCapability: true };
    } catch (error) {
      if (!(error instanceof StalwartError)) throw error;
      return {
        reachable: !["UNREACHABLE", "TIMEOUT", "NOT_CONFIGURED"].includes(error.code),
        authenticated: !["AUTH_FAILED", "UNREACHABLE", "TIMEOUT", "NOT_CONFIGURED"].includes(error.code),
        managementCapability: false,
      };
    }
  }
}

export const stalwartClient = new StalwartClient();
