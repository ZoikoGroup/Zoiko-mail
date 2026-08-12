/**
 * OpenAPI contract lint — API Specification §22.
 *
 * The spec makes OpenAPI coverage part of Definition of Done, so this runs in CI.
 * Checks are split in two tiers because the document predates the requirement:
 *
 *   errors   structural problems that make the contract wrong or unusable
 *   warnings §22 requirements the existing document does not yet meet
 *            (operationId, examples, 3.1). Promote with --strict once cleared.
 *
 * Run: npm run lint:openapi        (errors fail the build)
 *      npm run lint:openapi -- --strict   (warnings fail too)
 */
import { openApiDocument } from "../src/config/openapi.js";

const strict = process.argv.includes("--strict");

const errors: string[] = [];
const warnings: string[] = [];

type Operation = {
  tags?: string[];
  summary?: string;
  operationId?: string;
  responses?: Record<string, unknown>;
  requestBody?: { content?: Record<string, { schema?: unknown; example?: unknown }> };
};

const METHODS = ["get", "post", "put", "patch", "delete", "head", "options"] as const;

function main(): void {
  const doc = openApiDocument as unknown as {
    openapi?: string;
    info?: { title?: string; version?: string };
    paths?: Record<string, Record<string, Operation>>;
    tags?: Array<{ name: string }>;
    components?: { securitySchemes?: Record<string, unknown> };
  };

  // ── Document level ──────────────────────────────────────────────────
  if (!doc.openapi) errors.push("missing `openapi` version field");
  else if (!/^3\.(0|1)\./.test(doc.openapi)) errors.push(`unsupported openapi version ${doc.openapi}`);
  else if (!doc.openapi.startsWith("3.1")) warnings.push(`§22 expects OpenAPI 3.1; document declares ${doc.openapi}`);

  if (!doc.info?.title) errors.push("missing `info.title`");
  if (!doc.info?.version) errors.push("missing `info.version`");
  if (!doc.paths || Object.keys(doc.paths).length === 0) errors.push("document declares no paths");

  const declaredTags = new Set((doc.tags ?? []).map((tag) => tag.name));
  const seenOperationIds = new Set<string>();

  // ── Operation level ─────────────────────────────────────────────────
  for (const [path, pathItem] of Object.entries(doc.paths ?? {})) {
    if (!path.startsWith("/")) errors.push(`path must start with "/": ${path}`);

    const operations = METHODS.filter((method) => pathItem[method]).map(
      (method) => [method, pathItem[method]!] as const
    );

    if (operations.length === 0) errors.push(`${path}: no operations defined`);

    for (const [method, operation] of operations) {
      const where = `${method.toUpperCase()} ${path}`;

      if (!operation.responses || Object.keys(operation.responses).length === 0) {
        errors.push(`${where}: no responses documented`);
      }

      if (!operation.summary) errors.push(`${where}: missing summary`);

      for (const tag of operation.tags ?? []) {
        if (!declaredTags.has(tag)) errors.push(`${where}: uses undeclared tag "${tag}"`);
      }

      if (!operation.operationId) {
        warnings.push(`${where}: missing operationId (§22 SDK generation)`);
      } else if (seenOperationIds.has(operation.operationId)) {
        errors.push(`${where}: duplicate operationId "${operation.operationId}"`);
      } else {
        seenOperationIds.add(operation.operationId);
      }

      // §22: "Every endpoint must document common error codes."
      const codes = Object.keys(operation.responses ?? {});
      const mutating = method !== "get" && method !== "head" && method !== "options";
      if (mutating && !codes.some((code) => code.startsWith("4"))) {
        warnings.push(`${where}: documents no 4xx response`);
      }

      // §22: "Every request/response must include valid examples."
      if (operation.requestBody) {
        const media = Object.values(operation.requestBody.content ?? {});
        if (media.length === 0) errors.push(`${where}: requestBody has no content`);
        else if (!media.some((entry) => entry.example !== undefined)) {
          warnings.push(`${where}: requestBody has no example`);
        }
      }
    }
  }

  // ── Security schemes ────────────────────────────────────────────────
  if (!doc.components?.securitySchemes || Object.keys(doc.components.securitySchemes).length === 0) {
    warnings.push("no securitySchemes declared (§22 requires bearer auth to be modeled)");
  }

  // ── Report ──────────────────────────────────────────────────────────
  const pathCount = Object.keys(doc.paths ?? {}).length;
  const operationCount = Object.values(doc.paths ?? {}).reduce(
    (total, item) => total + METHODS.filter((method) => item[method]).length,
    0
  );

  process.stdout.write(`OpenAPI lint — ${pathCount} paths, ${operationCount} operations\n`);

  for (const warning of warnings) process.stdout.write(`  warn   ${warning}\n`);
  for (const error of errors) process.stdout.write(`  error  ${error}\n`);

  const warnSummary = warnings.length > 0 ? `, ${warnings.length} warning(s)` : "";

  if (errors.length > 0) {
    process.stdout.write(`\nFAILED — ${errors.length} error(s)${warnSummary}\n`);
    process.exit(1);
  }

  if (strict && warnings.length > 0) {
    process.stdout.write(`\nFAILED (strict) — ${warnings.length} warning(s)\n`);
    process.exit(1);
  }

  process.stdout.write(`\nOK — no errors${warnSummary}\n`);
}

main();
