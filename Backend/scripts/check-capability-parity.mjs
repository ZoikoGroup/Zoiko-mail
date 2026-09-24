#!/usr/bin/env node
/**
 * The frontend keeps a hand-written union of every capability, because the
 * type has to exist at compile time and the server's matrix does not.
 *
 * Hand-written copies drift. This one drifted to 10 missing capabilities and
 * two that had been deleted from the backend months earlier — which shows up
 * as a control the UI never offers, or one it offers and the API refuses.
 * Neither failure is visible in a screenshot, so it is checked here instead.
 */
import { readFileSync } from "node:fs";

const backend = readFileSync("Backend/src/common/capabilities/capabilities.ts", "utf8");
const frontend = readFileSync("Frontend/lib/admin-capabilities.ts", "utf8");

const be = new Set([...backend.matchAll(/^ {2}"([a-z][\w.-]+)"/gm)].map((m) => m[1]));

const start = frontend.indexOf("export type Capability =");
const end = frontend.indexOf("export interface CapabilityState");
if (start < 0 || end < 0) {
  console.error("Could not find the Capability union in admin-capabilities.ts");
  process.exit(1);
}
const fe = new Set([...frontend.slice(start, end).matchAll(/"([a-z][\w.-]+)"/g)].map((m) => m[1]));

const missing = [...be].filter((c) => !fe.has(c));
const stale = [...fe].filter((c) => !be.has(c));

if (missing.length === 0 && stale.length === 0) {
  console.log(`capability parity OK (${be.size} capabilities)`);
  process.exit(0);
}
if (missing.length) console.error("Missing from the frontend union:\n  " + missing.join("\n  "));
if (stale.length) console.error("In the frontend union but gone from the backend:\n  " + stale.join("\n  "));
process.exit(1);
