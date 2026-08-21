/**
 * Admin workspace primitive. Composes the tokens and .zoiko-* classes that
 * already exist in app/globals.css rather than introducing a second styling
 * vocabulary.
 */

import type { ReactNode } from "react";
import type { Tone } from "./types";

/* ── pill ──────────────────────────────────────────────────────────────── */

export function Pill({ tone = "nu", children }: { tone?: Tone; children: ReactNode }) {
  return <span className={`zoiko-pill ${tone}`}>{children}</span>;
}
