import type { Commitment } from "./types";

// In a real build these hit the Zoiko Mail API with:
//   Authorization: Bearer <zoiko_access_token>
//   X-Zoiko-Tenant-ID: <tenantId>
//   Idempotency-Key: <uuid>   (on every mutation)
// Here they hit the local mock route so the starter runs with no backend.

const BASE = "/api";

export async function fetchCommitments(tenantId: string): Promise<Commitment[]> {
  const res = await fetch(`${BASE}/commitments`, {
    headers: { "X-Zoiko-Tenant-ID": tenantId },
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`Failed to load commitments (${res.status})`);
  return res.json();
}

// Placeholder for the async-AI draft job:
//   POST /ai-actions/draft-reply -> 202 + ai_action_id
//   then poll GET /ai-actions/{id} until status === "succeeded"
export async function generateDraft(_commitmentId: string): Promise<string> {
  await new Promise((r) => setTimeout(r, 1400)); // mimic the poll delay
  return "AI-drafted reply text would arrive here after polling the job.";
}
