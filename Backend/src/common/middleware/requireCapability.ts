import type { Request, Response, NextFunction } from "express";
import { AppError } from "../errors/AppError.js";
import { ErrorCodes } from "../errors/errorCodes.js";
import { resolveCapability, type CapabilityContext } from "../capabilities/index.js";

/**
 * Capability enforcement — Security §7.2, evaluation step 6.
 *
 * Runs after `tenantContext`, which reads the role from the membership row on
 * every request rather than from the token, so a demotion takes effect on the
 * caller's next call. This middleware turns that role into a capability
 * decision; `requireRole` answers a different and much blunter question.
 *
 * The denial carries the resolver's reason and the roles that do hold the
 * capability. That payload is the whole point: the admin workspace is denied
 * fourteen of twenty-eight capabilities, so a bare 403 would leave the UI
 * unable to say anything more useful than "no".
 */

/**
 * Builds the resolver's inputs from the request.
 *
 * Step-up satisfaction, second-approver identity and support-grant state are
 * evaluation steps 8–10 and do not exist yet. They are reported here as
 * unsatisfied rather than assumed, which means a capability held only as
 * STEP_UP, TWO_PERSON or GRANT is currently denied — correctly, since nothing
 * can satisfy those conditions. No route is gated on such a capability for
 * that reason; doing so would lock out a caller who legitimately holds it.
 */
function contextFrom(req: Request): CapabilityContext {
  const tenant = req.tenantContext;
  return {
    role: tenant?.role ?? null,
    // tenantContext only attaches for an ACTIVE membership, so reaching here
    // with a context at all means the membership is usable.
    membershipActive: Boolean(tenant),
    stepUpSatisfied: false,
    secondApproverUserId: null,
    hasActiveSupportGrant: false,
  };
}

export function requireCapability(capability: string) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.tenantContext) {
      next(new AppError("Tenant context required", 403, ErrorCodes.FORBIDDEN));
      return;
    }

    const decision = resolveCapability(capability, contextFrom(req));
    if (decision.allowed) {
      next();
      return;
    }

    next(
      new AppError(
        `This action requires the ${capability} capability`,
        403,
        ErrorCodes.FORBIDDEN,
        {
          capability: decision.capability,
          reason: decision.reason,
          heldBy: decision.heldBy,
          requiresStepUp: decision.requiresStepUp,
          requiresSecondApprover: decision.requiresSecondApprover,
          requiresSupportGrant: decision.requiresSupportGrant,
        }
      )
    );
  };
}

/** The resolver context for the current request, for services that need it. */
export function capabilityContext(req: Request): CapabilityContext {
  return contextFrom(req);
}
