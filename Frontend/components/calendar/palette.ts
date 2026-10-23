import type { CSSProperties } from "react";
import type { CalendarColor } from "@/lib/calendar-api";

/**
 * Calendar colours. The server stores a key; these are the hues, and the
 * event styles mix them with the surface so the same key reads as a dark
 * tinted block in dark mode and a light one in light mode — the look of the
 * Calendar designs (coloured border, tinted fill, readable text).
 */
export const CALENDAR_HEX: Record<CalendarColor, string> = {
  blue: "#3B7BF6",
  green: "#22B07D",
  purple: "#8B6CF6",
  amber: "#E0A33A",
  teal: "#23B5B5",
  red: "#E5484D",
  slate: "#7C8DA6",
};

export const COLOR_NAME: Record<CalendarColor, string> = {
  blue: "Blue",
  green: "Green",
  purple: "Purple",
  amber: "Amber",
  teal: "Teal",
  red: "Red",
  slate: "Slate",
};

export function hexOf(color: string | undefined): string {
  return CALENDAR_HEX[(color as CalendarColor) ?? "blue"] ?? CALENDAR_HEX.blue;
}

/** A tinted event block in the calendar's colour. */
export function eventBlockStyle(color: string | undefined, faded = false): CSSProperties {
  const hex = hexOf(color);
  return {
    backgroundColor: `color-mix(in srgb, ${hex} ${faded ? 12 : 24}%, var(--surface))`,
    borderColor: `color-mix(in srgb, ${hex} ${faded ? 35 : 62}%, transparent)`,
  };
}

/** The solid swatch (checkboxes, dots, the agenda bar). */
export function swatchStyle(color: string | undefined): CSSProperties {
  return { backgroundColor: hexOf(color) };
}
