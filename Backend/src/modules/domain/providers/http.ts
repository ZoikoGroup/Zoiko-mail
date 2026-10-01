import { env } from "../../../config/env.js";
import { DnsProviderError } from "./types.js";

/**
 * One JSON request to a DNS host's API, with a timeout and an error that
 * carries the provider's own explanation.
 *
 * Base URLs are constants in each adapter, never caller input, so this cannot
 * be pointed at an internal address.
 */
export async function providerRequest<T>(
  url: string,
  init: { method?: string; headers: Record<string, string>; body?: unknown },
  describeError: (status: number, body: unknown) => string
): Promise<{ status: number; body: T }> {
  let response: Response;
  try {
    response = await fetch(url, {
      method: init.method ?? "GET",
      headers: { Accept: "application/json", ...(init.body !== undefined ? { "Content-Type": "application/json" } : {}), ...init.headers },
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
      signal: AbortSignal.timeout(env.DNS_PROVIDER_TIMEOUT_MS),
    });
  } catch (error) {
    const timedOut = error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
    throw new DnsProviderError(timedOut ? "The DNS provider did not respond in time" : "The DNS provider could not be reached");
  }
  const text = await response.text();
  let body: unknown = null;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }
  }
  if (!response.ok) throw new DnsProviderError(describeError(response.status, body), response.status);
  return { status: response.status, body: body as T };
}
