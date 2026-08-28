import { apiRequest } from "./api-client";

export type ConnectorProvider = "GMAIL" | "MICROSOFT_365";
export type ConnectorStatus =
  | "PENDING"
  | "ACTIVE"
  | "ERROR"
  | "DISCONNECTED"
  | string;

export interface Connector {
  id: string;
  provider: ConnectorProvider;
  email: string;
  scopes: string[];
  status: ConnectorStatus;
  watchExpiresAt: string | null;
  lastSyncedAt: string | null;
  lastErrorCode: string | null;
  disconnectedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateConnectorInput {
  provider: ConnectorProvider;
  providerAccountId: string;
  email: string;
  scopes: string[];
}

// The backend only accepts these exact read-only scopes; we derive them from
// the chosen provider so the form can't send an invalid scope.
export const READONLY_SCOPES: Record<ConnectorProvider, string[]> = {
  GMAIL: ["https://www.googleapis.com/auth/gmail.readonly"],
  MICROSOFT_365: ["Mail.Read"],
};

// ---- member endpoints -----------------------------------------------------
export async function listConnectors(): Promise<Connector[]> {
  const data = await apiRequest<{ accounts: Connector[] }>("/connectors");
  return data.accounts ?? [];
}

export async function createConnector(input: CreateConnectorInput): Promise<Connector> {
  return apiRequest<Connector>("/connectors", { method: "POST", body: input });
}

export async function disconnectConnector(accountId: string): Promise<void> {
  await apiRequest(`/connectors/${accountId}`, { method: "DELETE" });
}

// ---- OAuth endpoints -------------------------------------------------------
export async function getGoogleAuthUrl(): Promise<{ url: string }> {
  return apiRequest<{ url: string }>("/connectors/auth/google");
}

// ---- admin endpoints (OWNER/ADMIN) ----------------------------------------
// Response shapes not yet confirmed, so these return `unknown` and the UI reads
// them defensively. Tighten the types once the real responses are captured.
export async function getConnectorHealth(): Promise<unknown> {
  return apiRequest<unknown>("/connectors/health");
}

export async function listDeadLetter(): Promise<unknown> {
  return apiRequest<unknown>("/connectors/dead-letter");
}

export async function replayDeadLetter(eventId: string): Promise<void> {
  await apiRequest(`/connectors/dead-letter/${eventId}/replay`, { method: "POST" });
}