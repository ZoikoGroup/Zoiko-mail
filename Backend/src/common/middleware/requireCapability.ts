import type { Request, Response, NextFunction } from "express";
import { AppError } from "../errors/AppError.js";
import { ErrorCodes } from "../errors/errorCodes.js";
import { resolveCapability, type CapabilityContext } from "../capabilities/index.js";
import { verifyStepUpToken } from "../../modules/auth/auth.service.js";

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
 * Step-up is real now (Security §5, AC-003): the caller re-enters their
 * password at `POST /auth/step-up` and sends the short-lived token back as
 * `x-step-up-token`. This used to be hardcoded false, which meant every
 * STEP_UP capability — data export, MFA reset — resolved to a denial that
 * nothing could clear, so no route could be gated on one without locking out
 * the people who legitimately held it.
 *
 * Second-approver identity and support-grant state are still unsatisfied
 * here. They are reported honestly rather than assumed, so a TWO_PERSON
 * capability (tenant deletion, ownership transfer) still resolves closed.
 */
function contextFrom(req: Request): CapabilityContext {
  const tenant = req.tenantContext;
  return {
    role: tenant?.role ?? null,
    // tenantContext only attaches for an ACTIVE membership, so reaching here
    // with a context at all means the membership is usable.
    membershipActive: Boolean(tenant),
    // Bound to this user and this tenant inside the verifier, so a step-up
    // taken in one workspace cannot authorise an action in another.
    stepUpSatisfied: tenant
      ? verifyStepUpToken(req.header("x-step-up-token"), tenant.userId, tenant.tenantId)
      : false,
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


/**
 * Require a capability chosen from the request itself.
 *
 * Some actions are only high-risk in one of their shapes. RBAC §2 wants
 * step-up for "Change AI policy" and "Enable AI on restricted mailbox", but
 * both arrive on endpoints that also serve routine work: the same
 * POST /policies writes a retention policy, and the same PATCH on a mailbox
 * sets a storage quota. Gating the whole route on the strict capability would
 * demand a fresh password for the routine half; gating it on the lenient one
 * is the gap this closes.
 *
 * Returning null from `pick` means the request is not the risky shape, and the
 * route's own base gate — declared before this one — is the whole check.
 */
export function requireCapabilityWhen(
  pick: (req: Request) => string | null
) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const capability = pick(req);
    if (!capability) {
      next();
      return;
    }

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
