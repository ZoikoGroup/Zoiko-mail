#!/usr/bin/env node
/**
 * Every `var(--token)` the UI uses must be defined in globals.css.
 *
 * An undefined custom property does not error, warn, or fall back to
 * anything — it resolves to nothing, and the declaration is dropped. So
 * `bg-[var(--s1)]` on a dropdown renders it fully transparent, with the page
 * showing straight through it, and nothing in the build or the type checker
 * says a word.
 *
 * That is exactly how it was found: a profile menu shipped see-through, and
 * the audit that followed turned up four undefined tokens across six files,
 * most of them older than the menu — a missing `--line` on a border, a
 * missing `--err` on an error colour. Each one silently drops the style it
 * was meant to apply, which reads as a design choice rather than a bug.
 *
 * Cheap to check, invisible to review, so it is checked here.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const CSS = "Frontend/app/globals.css";
const ROOTS = ["Frontend/app", "Frontend/components"];

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) out.push(...walk(path));
    else if (/\.tsx?$/.test(entry)) out.push(path);
  }
  return out;
}

/**
 * Tokens from globals.css, plus any a file defines for itself.
 *
 * The support console carries its own scoped palette inside a template
 * literal — `--violet` lives under `.support-workspace` and is never global.
 * A check that flagged those would be wrong twice a week, and a check that is
 * wrong twice a week gets switched off. Only genuinely undefined ones count.
 */
const defined = new Set(
  [...readFileSync(CSS, "utf8").matchAll(/^\s*(--[a-z0-9-]+)\s*:/gim)].map((m) => m[1])
);

function localTokens(source) {
  return new Set([...source.matchAll(/(--[a-z0-9-]+)\s*:/g)].map((m) => m[1]));
}

const missing = new Map();
for (const root of ROOTS) {
  for (const file of walk(root)) {
    const source = readFileSync(file, "utf8");
    const local = localTokens(source);
    for (const [, token] of source.matchAll(/var\((--[a-z0-9-]+)\)/g)) {
      if (defined.has(token) || local.has(token)) continue;
      // A comment naming a token is documentation, not a use of it.
      if (new RegExp(`\\*.*${token}`).test(source) && !new RegExp(`\\[[^\\]]*var\\(${token}\\)`).test(source)) {
        continue;
      }
      if (!missing.has(token)) missing.set(token, new Set());
      missing.get(token).add(file.replace(/\\/g, "/"));
    }
  }
}

if (missing.size === 0) {
  console.log(`CSS tokens OK (${defined.size} defined)`);
  process.exit(0);
}

console.error("Undefined CSS custom properties — these render as nothing:\n");
for (const [token, files] of [...missing].sort()) {
  console.error(`  ${token}`);
  for (const file of [...files].sort()) console.error(`      ${file}`);
}
console.error(`\nDefine them in ${CSS}, or use one that exists.`);
process.exit(1);
