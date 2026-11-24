import { Prisma } from "@prisma/client";
import { prisma } from "../../config/prisma.js";
import { AppError } from "../../common/errors/AppError.js";
import { ErrorCodes } from "../../common/errors/errorCodes.js";
import { auditService } from "../audit/audit.service.js";
import { securityAlertService } from "../security-alert/security-alert.service.js";

/**
 * Aliases and forwarding rules — Data Model §6.17, §6.18, Security §9.
 *
 * PRD §11.2 lists both as controlled-pilot Must-Have and neither existed in
 * any form. Both hang off a mailbox and are managed by an operator; §9 puts
 * them under "Admin/Owner can manage" and singles forwarding out with
 * "forwarding creation must be audited", because forwarding is how mail
 * quietly leaves an organisation.
 */

interface ActorContext {
  tenantId: string;
  userId: string;
  requestId?: string;
  ipAddress?: string | null;
  userAgent?: string | null;
}

const aliasSelect = {
  id: true,
  address: true,
  status: true,
  mailboxId: true,
  createdAt: true,
} satisfies Prisma.AliasSelect;

const forwardingSelect = {
  id: true,
  forwardToAddress: true,
  keepCopy: true,
  status: true,
  mailboxId: true,
  createdAt: true,
} satisfies Prisma.ForwardingRuleSelect;

export class AliasService {
  /** The mailbox, confirmed to be in this workspace. */
  private async mailbox(tenantId: string, mailboxId: string) {
    const mailbox = await prisma.mailbox.findFirst({
      where: { id: mailboxId, tenantId },
      select: { id: true, address: true },
    });
    if (!mailbox) throw new AppError("Mailbox not found", 404, ErrorCodes.NOT_FOUND);
    return mailbox;
  }

  async list(tenantId: string, mailboxId: string) {
    await this.mailbox(tenantId, mailboxId);
    const [aliases, forwarding] = await Promise.all([
      prisma.alias.findMany({
        where: { tenantId, mailboxId },
        select: aliasSelect,
        orderBy: { address: "asc" },
      }),
      prisma.forwardingRule.findMany({
        where: { tenantId, mailboxId },
        select: forwardingSelect,
        orderBy: { forwardToAddress: "asc" },
      }),
    ]);
    return { aliases, forwarding };
  }

  async createAlias(
    tenantId: string,
    mailboxId: string,
    address: string,
    context: ActorContext
  ) {
    const mailbox = await this.mailbox(tenantId, mailboxId);
    const normalized = address.trim().toLowerCase();

    // An alias that collides with a real mailbox address would make routing
    // ambiguous in the other direction, which the alias-only unique index
    // cannot see.
    const mailboxClash = await prisma.mailbox.findFirst({
      where: { tenantId, address: normalized },
      select: { id: true },
    });
    if (mailboxClash) {
      throw new AppError(
        "That address already belongs to a mailbox",
        409,
        ErrorCodes.CONFLICT
      );
    }

    const alias = await prisma.alias
      .create({
        data: { tenantId, mailboxId, address: normalized },
        select: aliasSelect,
      })
      .catch((error: unknown) => {
        // Unique violation. Deliberately does not say whether the alias
        // exists in this workspace or another: the index is global, and
        // confirming an address is in use elsewhere would leak across
        // tenants.
        if (
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === "P2002"
        ) {
          throw new AppError("That alias address is already in use", 409, ErrorCodes.CONFLICT);
        }
        throw error;
      });

    await auditService.record({
      tenantId,
      actorUserId: context.userId,
      eventType: "MAILBOX_ALIAS_CREATED",
      targetType: "Mailbox",
      targetId: mailboxId,
      requestId: context.requestId,
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
      metadata: { mailbox: mailbox.address, alias: alias.address },
    });

    return alias;
  }

  async deleteAlias(
    tenantId: string,
    mailboxId: string,
    aliasId: string,
    context: ActorContext
  ) {
    const mailbox = await this.mailbox(tenantId, mailboxId);
    const alias = await prisma.alias.findFirst({
      where: { id: aliasId, tenantId, mailboxId },
      select: { id: true, address: true },
    });
    if (!alias) throw new AppError("Alias not found", 404, ErrorCodes.NOT_FOUND);

    await prisma.alias.delete({ where: { id: alias.id } });

    await auditService.record({
      tenantId,
      actorUserId: context.userId,
      eventType: "MAILBOX_ALIAS_REMOVED",
      targetType: "Mailbox",
      targetId: mailboxId,
      requestId: context.requestId,
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
      metadata: { mailbox: mailbox.address, alias: alias.address },
    });

    return { removed: true };
  }

  async createForwarding(
    tenantId: string,
    mailboxId: string,
    input: { forwardToAddress: string; keepCopy?: boolean },
    context: ActorContext
  ) {
    const mailbox = await this.mailbox(tenantId, mailboxId);
    const destination = input.forwardToAddress.trim().toLowerCase();

    // Forwarding a mailbox to itself is a loop, and the uniqueness index
    // would not catch it.
    if (destination === mailbox.address.toLowerCase()) {
      throw new AppError(
        "A mailbox cannot forward to itself",
        422,
        ErrorCodes.VALIDATION_ERROR
      );
    }

    const external = await this.isOutsideWorkspace(tenantId, destination);

    // The rule, its audit row and — for an outside destination — its security
    // alert commit together: a forwarding rule nobody was told about is the
    // exact thing S2 §06 / ZMT-19 exists to prevent.
    const rule = await prisma
      .$transaction(async (tx) => {
        const created = await tx.forwardingRule.create({
          data: {
            tenantId,
            mailboxId,
            forwardToAddress: destination,
            keepCopy: input.keepCopy ?? true,
          },
          select: forwardingSelect,
        });

        // Security §9 singles this out: "forwarding creation must be audited".
        await auditService.record({
          tenantId,
          actorUserId: context.userId,
          eventType: "MAILBOX_FORWARDING_CREATED",
          targetType: "Mailbox",
          targetId: mailboxId,
          requestId: context.requestId,
          ipAddress: context.ipAddress,
          userAgent: context.userAgent,
          metadata: {
            mailbox: mailbox.address,
            forwardTo: created.forwardToAddress,
            keepCopy: created.keepCopy,
            external,
          },
        }, tx);

        if (external) {
          await securityAlertService.recordExternalForwarding(
            tenantId,
            {
              ruleId: created.id,
              mailboxId,
              mailboxAddress: mailbox.address,
              destination: created.forwardToAddress,
              keepCopy: created.keepCopy,
            },
            {
              actorUserId: context.userId,
              requestId: context.requestId,
              ipAddress: context.ipAddress,
              userAgent: context.userAgent,
            },
            tx
          );
        }
        return created;
      })
      .catch((error: unknown) => {
        if (
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === "P2002"
        ) {
          throw new AppError(
            "That forwarding destination is already configured",
            409,
            ErrorCodes.CONFLICT
          );
        }
        throw error;
      });

    return rule;
  }

  /**
   * Whether an address leaves the organisation: not a domain this workspace
   * has verified, and not one of its own mailboxes or aliases. A domain the
   * workspace merely added does not count — adding an unverified domain is
   * something an attacker holding an admin session could do first.
   */
  private async isOutsideWorkspace(tenantId: string, address: string): Promise<boolean> {
    const domain = address.slice(address.lastIndexOf("@") + 1);
    const [verifiedDomain, mailbox, alias] = await Promise.all([
      prisma.mailDomain.findFirst({
        where: { tenantId, domainName: { equals: domain, mode: "insensitive" }, verificationStatus: "VERIFIED" },
        select: { id: true },
      }),
      prisma.mailbox.findFirst({
        where: { tenantId, address: { equals: address, mode: "insensitive" }, deletionRequestedAt: null },
        select: { id: true },
      }),
      prisma.alias.findFirst({
        where: { tenantId, address: { equals: address, mode: "insensitive" }, status: "ACTIVE" },
        select: { id: true },
      }),
    ]);
    return !verifiedDomain && !mailbox && !alias;
  }

  async deleteForwarding(
    tenantId: string,
    mailboxId: string,
    ruleId: string,
    context: ActorContext
  ) {
    const mailbox = await this.mailbox(tenantId, mailboxId);
    const rule = await prisma.forwardingRule.findFirst({
      where: { id: ruleId, tenantId, mailboxId },
      select: { id: true, forwardToAddress: true },
    });
    if (!rule) throw new AppError("Forwarding rule not found", 404, ErrorCodes.NOT_FOUND);

    await prisma.forwardingRule.delete({ where: { id: rule.id } });

    await auditService.record({
      tenantId,
      actorUserId: context.userId,
      eventType: "MAILBOX_FORWARDING_REMOVED",
      targetType: "Mailbox",
      targetId: mailboxId,
      requestId: context.requestId,
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
      metadata: { mailbox: mailbox.address, forwardTo: rule.forwardToAddress },
    });

    return { removed: true };
  }
}

export const aliasService = new AliasService();
