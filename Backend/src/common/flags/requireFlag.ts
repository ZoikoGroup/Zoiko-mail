import type { NextFunction, Request, Response } from "express";
import { assertFlagEnabled, type FlagName, type FlagScope } from "./flags.js";

/**
 * Evaluation step 9 of the permission pipeline (Security §7.2): the feature gate.
 *
 * Mount after tenantContext so the tenant scope is available. Track B routes use
 * this to ship built-but-disabled, which is what makes the gated-hosted-mail
 * position implementable rather than a promise.
 */
export function requireFlag(
  name: FlagName,
  scopeFrom: (req: Request) => FlagScope = (req) => ({ tenantId: req.tenantContext?.tenantId })
) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    try {
      assertFlagEnabled(name, scopeFrom(req));
      next();
    } catch (error) {
      next(error);
    }
  };
}
