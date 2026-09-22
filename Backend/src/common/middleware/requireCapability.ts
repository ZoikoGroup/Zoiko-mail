import type { Request, Response, NextFunction } from "express";
import { AppError } from "../errors/AppError.js";
import { ErrorCodes } from "../errors/errorCodes.js";
import { resolveCapability, type CapabilityContext } from "../capabilities/index.js";
import { verifyStepUpToken } from "../../modules/auth/auth.service.js";
import { prisma } from "../../config/prisma.js";

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
 * Support-grant state is real too. It was hardcoded false, which made every
 * GRANT capability resolve closed no matter what the workspace owner had
 * approved — so `support.workspace.investigate`, `support.mailbox.reset` and
 * `mail.other.read` were unusable by construction, and the one path the matrix
 * opens to a Support member led nowhere. Runbook §7 wants that path to exist
 * and to be time-bound; it can only be both if the grant is actually read.
 *
 * The lookup is skipped for every role that holds no GRANT capability, which
 * is every role but SUPPORT, so the common request pays nothing for it.
 *
 * Second-approver identity is still unsatisfied here. It is reported honestly
 * rather than assumed, so a TWO_PERSON capability (tenant deletion, ownership
 * transfer) still resolves closed — there is no approval workflow behind it
 * yet, and pretending otherwise would be worse than refusing.
 */
async function contextFrom(req: Request): Promise<CapabilityContext> {
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
    hasActiveSupportGrant: tenant ? await hasLiveGrant(tenant) : false,
  };
}

/**
 * An unrevoked, unexpired grant for this member in this workspace.
 *
 * Only SUPPORT holds a GRANT capability, so no other role is worth a query.
 * Checked per request rather than cached: the point of an expiry is that it
 * takes effect on its own, and the point of a revocation is that it takes
 * effect at once.
 */
export async function hasLiveGrant(tenant: {
  role: string;
  tenantId: string;
  membershipId: string;
}): Promise<boolean> {
  if (tenant.role !== "SUPPORT") return false;
  const grant = await prisma.supportAccessGrant.findFirst({
    where: {
      tenantId: tenant.tenantId,
      supportMembershipId: tenant.membershipId,
      revokedAt: null,
      expiresAt: { gt: new Date() },
    },
    select: { id: true },
  });
  return grant !== null;
}


/**
 * What to tell the person, rather than what to tell the developer.
 *
 * "This action requires the support.console.read capability" names an
 * internal identifier and no next step. The resolver already says *why* it
 * refused, so the refusal can say what would clear it — which for a Support
 * seat is somebody else approving a grant, not anything they can do
 * themselves. The capability name stays in `details` for the console to gate
 * on; it just stops being the sentence a human reads.
 */
function denialMessage(capability: string, reason: string): string {
  switch (reason) {
    case "REQUIRES_SUPPORT_GRANT":
      return "This workspace needs an approved support access grant. Ask the workspace owner to approve one, and note that it expires on its own.";
    case "REQUIRES_STEP_UP":
      return "Confirm your password to continue — this action needs a fresh sign-in.";
    case "REQUIRES_SECOND_APPROVER":
      return "This action needs a second approver before it can run.";
    default:
      return `This action requires the ${capability} capability`;
  }
}

export function requireCapability(capability: string) {
  return async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
    if (!req.tenantContext) {
      next(new AppError("Tenant context required", 403, ErrorCodes.FORBIDDEN));
      return;
    }

    let decision;
    try {
      decision = resolveCapability(capability, await contextFrom(req));
    } catch (error) {
      next(error);
      return;
    }
    if (decision.allowed) {
      next();
      return;
    }

    next(
      new AppError(
        denialMessage(capability, decision.reason),
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
  return async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
    const capability = pick(req);
    if (!capability) {
      next();
      return;
    }

    if (!req.tenantContext) {
      next(new AppError("Tenant context required", 403, ErrorCodes.FORBIDDEN));
      return;
    }

    let decision;
    try {
      decision = resolveCapability(capability, await contextFrom(req));
    } catch (error) {
      next(error);
      return;
    }
    if (decision.allowed) {
      next();
      return;
    }

    next(
      new AppError(
        denialMessage(capability, decision.reason),
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
 * The resolver context for the current request, for services that need it.
 *
 * Async since the support-grant lookup became real — a caller that wants the
 * same decision the middleware makes has to wait for the same inputs.
 */
export function capabilityContext(req: Request): Promise<CapabilityContext> {
  return contextFrom(req);
}
