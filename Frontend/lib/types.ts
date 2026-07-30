// Domain types mirroring the Zoiko Mail Data Model spec (Track A).

export type CommitmentType =
  | "commitment"
  | "reply_owed"
  | "approval_request"
  | "deadline"
  | "follow_up";

export type CommitmentStatus =
  | "suggested"
  | "confirmed"
  | "assigned"
  | "snoozed"
  | "overdue"
  | "completed"
  | "dismissed";

export type Priority = "low" | "normal" | "high" | "urgent";

export interface Participant {
  name: string;
  email: string;
}

export interface Commitment {
  id: string;
  type: CommitmentType;
  status: CommitmentStatus;
  priority: Priority;
  title: string;
  owedBy: Participant;
  owedTo: Participant;
  due: string;
  confidence: number; // 0..1, calibrated
  thread: string;
  sender: string;
  excerpt: string;   // source traceability — the exact sentence
  rationale: string; // "why flagged"
}
