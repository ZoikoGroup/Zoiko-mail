import type { DnsRecordPurpose, DnsRecordState, DomainLifecycleStatus } from "@prisma/client";
import { isDefinitiveFailure } from "./dns.verifier.js";

/**
 * The domain state machine, kept free of I/O so every transition is testable.
 *
 *   PENDING_VERIFICATION ──all required pass──▶ VERIFIED ──activate──▶ ACTIVE
 *          │                                       ▲  (or automatically)   │
 *          └─ownership absent past deadline─▶ FAILED                       │
 *                                                                          │
 *   ACTIVE ──required record fails N checks in a row, outside grace──▶ DEGRADED
 *   DEGRADED ──records pass again──▶ ACTIVE   (sending resumes by itself)
 *
 * Two rules carry most of the weight:
 *
 *  - A resolver failure is never a reason to change state. Only a definitive
 *    answer (missing, wrong, conflicting) counts.
 *  - A sending domain is suspended only after `threshold` consecutive
 *    definitive failures, and never inside a grace window. One bad check —
 *    a record being edited, a propagation race — must not stop a
 *    workspace's mail.
 */

/** The records sending depends on. MX decides receiving, not sending. */
export const SENDING_PURPOSES: ReadonlySet<DnsRecordPurpose> = new Set(["OWNERSHIP", "SPF", "DKIM", "DMARC"]);

export interface RecordVerdict {
  purpose: DnsRecordPurpose;
  required: boolean;
  state: DnsRecordState;
}

export interface Readiness {
  ownershipVerified: boolean;
  /** Every required sending record verified. */
  sendReady: boolean;
  /** Every required record, including MX when receiving, verified. */
  fullyReady: boolean;
  /** At least one required record is definitively wrong. */
  definitiveFailure: boolean;
  /** Required records that are not verified, by purpose. */
  blocking: DnsRecordPurpose[];
}

export function readiness(records: RecordVerdict[]): Readiness {
  const required = records.filter((record) => record.required);
  const ownership = required.find((record) => record.purpose === "OWNERSHIP");
  const sending = required.filter((record) => SENDING_PURPOSES.has(record.purpose));
  const hasDkim = sending.some((record) => record.purpose === "DKIM");
  const blocking = [...new Set(required.filter((record) => record.state !== "VERIFIED").map((record) => record.purpose))];
  return {
    ownershipVerified: ownership?.state === "VERIFIED",
    // No active DKIM key means nothing can sign, whatever else passes.
    sendReady: hasDkim && sending.length > 0 && sending.every((record) => record.state === "VERIFIED"),
    fullyReady: required.length > 0 && required.every((record) => record.state === "VERIFIED") && hasDkim,
    definitiveFailure: required.some((record) => isDefinitiveFailure(record.state)),
    blocking,
  };
}

export type LifecycleEvent =
  | "VERIFIED"
  | "AUTO_ACTIVATED"
  | "AT_RISK"
  | "SUSPENDED"
  | "RESUMED"
  | "VERIFICATION_FAILED"
  | "VERIFICATION_LOST";

export interface TransitionInput {
  status: DomainLifecycleStatus;
  sendingEnabled: boolean;
  /** Sending was switched off by the synchronizer, not by a person. */
  suspendedByDns: boolean;
  autoActivateSending: boolean;
  consecutiveFailures: number;
  readiness: Readiness;
  now: Date;
  graceUntil: Date | null;
  verificationDeadlineAt: Date | null;
  threshold: number;
}

export interface TransitionResult {
  status: DomainLifecycleStatus;
  sendingEnabled: boolean;
  consecutiveFailures: number;
  events: LifecycleEvent[];
}

export function transition(input: TransitionInput): TransitionResult {
  const { readiness: ready, now } = input;
  const inGrace = input.graceUntil !== null && input.graceUntil > now;

  if (input.sendingEnabled) {
    if (ready.sendReady) return { status: "ACTIVE", sendingEnabled: true, consecutiveFailures: 0, events: [] };
    if (!ready.definitiveFailure) {
      // Only lookup errors: no evidence either way, so nothing changes.
      return { status: "ACTIVE", sendingEnabled: true, consecutiveFailures: input.consecutiveFailures, events: [] };
    }
    const failures = input.consecutiveFailures + 1;
    if (inGrace || failures < input.threshold) {
      return { status: "ACTIVE", sendingEnabled: true, consecutiveFailures: failures, events: ["AT_RISK"] };
    }
    return { status: "DEGRADED", sendingEnabled: false, consecutiveFailures: failures, events: ["SUSPENDED"] };
  }

  if (input.suspendedByDns) {
    if (ready.sendReady) return { status: "ACTIVE", sendingEnabled: true, consecutiveFailures: 0, events: ["RESUMED"] };
    return {
      status: "DEGRADED",
      sendingEnabled: false,
      consecutiveFailures: ready.definitiveFailure ? input.consecutiveFailures + 1 : input.consecutiveFailures,
      events: [],
    };
  }

  if (ready.sendReady) {
    if (input.autoActivateSending) {
      return { status: "ACTIVE", sendingEnabled: true, consecutiveFailures: 0, events: input.status === "VERIFIED" ? ["AUTO_ACTIVATED"] : ["VERIFIED", "AUTO_ACTIVATED"] };
    }
    return { status: "VERIFIED", sendingEnabled: false, consecutiveFailures: 0, events: input.status === "VERIFIED" ? [] : ["VERIFIED"] };
  }

  const failures = ready.definitiveFailure ? input.consecutiveFailures + 1 : input.consecutiveFailures;
  const pastDeadline = input.verificationDeadlineAt !== null && input.verificationDeadlineAt <= now;
  if (!ready.ownershipVerified && pastDeadline && ready.definitiveFailure) {
    return { status: "FAILED", sendingEnabled: false, consecutiveFailures: failures, events: input.status === "FAILED" ? [] : ["VERIFICATION_FAILED"] };
  }
  if (input.status === "FAILED" && !ready.ownershipVerified) {
    return { status: "FAILED", sendingEnabled: false, consecutiveFailures: failures, events: [] };
  }
  return {
    status: "PENDING_VERIFICATION",
    sendingEnabled: false,
    consecutiveFailures: failures,
    events: input.status === "VERIFIED" && ready.definitiveFailure ? ["VERIFICATION_LOST"] : [],
  };
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

export interface ScheduleInput {
  status: DomainLifecycleStatus;
  fullyReady: boolean;
  /** Some records could not be looked up this time. */
  lookupErrors: boolean;
  /** A DKIM rotation is waiting for its new record. */
  rotationPending: boolean;
  createdAt: Date;
  now: Date;
  verifiedIntervalMs: number;
}

/**
 * When to look again. Fast while an owner is actively publishing records —
 * that is when they are watching the screen — and slow once a domain is
 * healthy, where a check is only a guard against later breakage.
 */
export function nextCheckDelayMs(input: ScheduleInput): number {
  if (input.lookupErrors) return 5 * MINUTE;
  if (input.rotationPending) return 10 * MINUTE;
  switch (input.status) {
    case "ACTIVE":
    case "VERIFIED":
      return input.fullyReady ? input.verifiedIntervalMs : 10 * MINUTE;
    case "DEGRADED":
      return 10 * MINUTE;
    case "FAILED":
      return 24 * HOUR;
    case "PENDING_VERIFICATION": {
      const age = input.now.getTime() - input.createdAt.getTime();
      if (age < HOUR) return 2 * MINUTE;
      if (age < 24 * HOUR) return 10 * MINUTE;
      return HOUR;
    }
  }
}
