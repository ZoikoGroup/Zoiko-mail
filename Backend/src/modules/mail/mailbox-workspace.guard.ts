import type { NextFunction, Request, Response } from "express";
import type { MembershipRole } from "@prisma/client";
import { prisma } from "../../config/prisma.js";
import { AppError } from "../../common/errors/AppError.js";
import { ErrorCodes } from "../../common/errors/errorCodes.js";

const WORKSPACE_NAME: Record<MembershipRole, string> = {
  MEMBER: "Member",
  SUPPORT: "Support",
  ADMIN: "Admin",
  OWNER: "Owner",
};

/** The refusal for a mailbox opened from a workspace it is not assigned to. */
export function mailboxNotInWorkspace(workspace: MembershipRole, address: string, assigned: MembershipRole[]): AppError {
  return new AppError(
    `${address} is not available in the ${WORKSPACE_NAME[workspace]} workspace. ` +
      `It is assigned to: ${assigned.map((scope) => WORKSPACE_NAME[scope]).join(", ")}.`,
    403,
    ErrorCodes.MAILBOX_NOT_IN_WORKSPACE,
    { workspace, assigned, address }
  );
}

/**
 * Refuses the caller's own mail when their personal mailbox is not assigned
 * to the workspace this session was opened for.
 *
 * Runs after `tenantContext`, so the workspace is the session's console as
 * the token records it. Mounted on the routes that read or write the
 * caller's own mail (mail, messages, threads); the admin management routes
 * skip it, because managing mailboxes is not opening one. A caller with no
 * mailbox yet passes — the mailbox is created on first use.
 */
export function requireMailboxInWorkspace(options: { skip?: (req: Request) => boolean } = {}) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (options.skip?.(req)) {
      next();
      return;
    }
    const context = req.tenantContext;
    if (!context) {
      next(new AppError("Authentication required", 401, ErrorCodes.UNAUTHORIZED));
      return;
    }
    prisma.mailbox
      .findFirst({
        where: { tenantId: context.tenantId, membershipId: context.membershipId },
        select: { address: true, workspaces: true },
      })
      .then((mailbox) => {
        if (mailbox && !mailbox.workspaces.includes(context.workspace)) {
          next(mailboxNotInWorkspace(context.workspace, mailbox.address, mailbox.workspaces));
          return;
        }
        next();
      })
      .catch(next);
  };
}
