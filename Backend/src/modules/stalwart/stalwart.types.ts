/**
 * The slice of Stalwart's management API this backend relies on.
 *
 * Stalwart v0.16 removed the REST management API (`/api/principal`) and moved
 * every management object onto JMAP under the `urn:stalwart:jmap` capability.
 * Verified against the deployed server (`/api/principal` answers 404,
 * `/jmap/session` answers 200) and the published object reference:
 *
 *   https://stalw.art/docs/ref/object/account/
 *   https://stalw.art/docs/ref/object/domain/
 *
 * Only properties named in that reference appear here. Anything not listed
 * there is deliberately absent rather than guessed.
 */

export const JMAP_CORE = "urn:ietf:params:jmap:core";
export const STALWART_CAPABILITY = "urn:stalwart:jmap";
/** RFC 8621. Only used to count an account's mail before it is destroyed. */
export const JMAP_MAIL = "urn:ietf:params:jmap:mail";

/** Errors the provider can raise, in terms the provisioning flow can act on. */
export type StalwartErrorCode =
  | "NOT_CONFIGURED"
  | "AUTH_FAILED"
  | "FORBIDDEN"
  | "TIMEOUT"
  | "UNREACHABLE"
  | "RATE_LIMITED"
  | "UNAVAILABLE"
  | "ALREADY_EXISTS"
  | "DOMAIN_MISSING"
  | "INVALID_REQUEST"
  | "NOT_SUPPORTED"
  | "UNEXPECTED_RESPONSE"
  /**
   * The number of messages in an account could not be established reliably:
   * the key may not read that account's mail, or the answer was missing,
   * malformed or about another account. Callers must treat this as "not known
   * to be empty" and refuse — never as zero.
   */
  | "COUNT_UNAVAILABLE";

/**
 * A failure talking to Stalwart.
 *
 * The message is written for operators and never carries the response body,
 * the request, or the credential. `jmapType` is the JMAP error type string
 * (for example `invalidProperties`), which is safe to record.
 */
export class StalwartError extends Error {
  constructor(
    message: string,
    public readonly code: StalwartErrorCode,
    public readonly retryable: boolean,
    public readonly httpStatus?: number,
    public readonly jmapType?: string
  ) {
    super(message);
    this.name = "StalwartError";
  }
}

export interface HostedDomain {
  id: string;
  name: string;
}

export interface HostedAccount {
  id: string;
  name: string;
  domainId: string;
  emailAddress: string | null;
  description: string | null;
  /** `quotas.maxDiskQuota` as the server reports it, when it reports one. */
  diskQuotaBytes: number | null;
}

export interface CreateHostedAccountInput {
  /** Local part only; Stalwart derives the address from name + domain. */
  name: string;
  domainId: string;
  /** Initial password credential. Never logged or persisted by the client. */
  secret: string;
  diskQuotaBytes: number;
  description: string;
}

/** What destroying an account found. Both mean the account is gone. */
export type DeleteAccountResult = "DELETED" | "ALREADY_ABSENT";

/**
 * What the provisioning flow needs from a mail host.
 *
 * Kept narrow on purpose: a different host would implement this and nothing
 * above it would change.
 */
export interface MailHostingProvider {
  readonly name: "STALWART";
  isConfigured(): boolean;
  findDomain(domainName: string): Promise<HostedDomain | null>;
  createDomain(domainName: string): Promise<HostedDomain>;
  findAccount(name: string, domainId: string): Promise<HostedAccount | null>;
  getAccount(id: string): Promise<HostedAccount | null>;
  /**
   * The number of messages the account holds, or a thrown `StalwartError`.
   * Never returns a guess: any doubt about the answer throws COUNT_UNAVAILABLE.
   */
  countMessages(accountId: string): Promise<number>;
  /**
   * Destroy an account. "Not found" is success (it is already gone), and a
   * destroyed account is read back to confirm it is absent before returning.
   */
  deleteAccount(id: string): Promise<DeleteAccountResult>;
  createAccount(input: CreateHostedAccountInput): Promise<HostedAccount>;
  /** Replace the account's sign-in password (IMAP, SMTP submission, JMAP). */
  setAccountPassword(id: string, secret: string): Promise<void>;
  /** Authenticated session check: credentials valid and management capability present. */
  probe(): Promise<{ reachable: boolean; authenticated: boolean; managementCapability: boolean }>;
}
