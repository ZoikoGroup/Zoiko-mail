import type { CSSProperties } from "react";
import type { EventResponse } from "@/lib/calendar-api";

/** How each answer reads in an attendee list. */
export const RESPONSE_LABEL: Record<EventResponse, string> = {
  NEEDS_ACTION: "Awaiting reply",
  ACCEPTED: "Accepted",
  TENTATIVE: "Tentative",
  DECLINED: "Declined",
};

/** How my own answer reads on an invitation in a list. */
export const PILL_LABEL: Record<EventResponse, string> = {
  NEEDS_ACTION: "Needs RSVP",
  ACCEPTED: "Accepted",
  TENTATIVE: "Tentative",
  DECLINED: "Declined",
};

/** One colour per answer, used for text, bars, dots and pills alike. */
export const RESPONSE_HEX: Record<EventResponse, string> = {
  NEEDS_ACTION: "#E0A33A",
  ACCEPTED: "#22B07D",
  TENTATIVE: "#A78BFA",
  DECLINED: "#E5484D",
};

/** A tinted pill in the answer's colour. */
export function pillStyle(response: EventResponse): CSSProperties {
  const hex = RESPONSE_HEX[response];
  return {
    color: hex,
    backgroundColor: `color-mix(in srgb, ${hex} 16%, transparent)`,
    borderColor: `color-mix(in srgb, ${hex} 45%, transparent)`,
  };
}
