import { prisma } from "../../config/prisma.js";
import { withCrossTenant } from "../../config/tenantScope.js";
import { AppError } from "../../common/errors/AppError.js";
import { ErrorCodes } from "../../common/errors/errorCodes.js";

/**
 * Whether another workspace already has a claim on an email address.
 *
 * An account (AppUser) is global, but a mailbox address belongs to the
 * workspace that owns its domain. Without this check, an Owner or Admin of
 * any workspace — and anyone can create one — could invite
 * `john@victim.example`, set the password on that shared identity with their
 * own link, and then take up the victim workspace's pending mailbox as
 * "john". So the questions below cross workspaces on purpose, which is why
 * they run unscoped (withCrossTenant): the answer is only "yes" or "no", and
 * nothing about the other workspace is returned to the caller.
 */
export type AddressClaim =
  /** A workspace other than this one has verified the address's domain. */
  | "DOMAIN"
  /** A mailbox with this address exists in another workspace. */
  | "MAILBOX"
  /** The account behind the address belongs to another workspace and not this one. */
  | "ACCOUNT";

function domainOf(email: string): string {
  return email.slice(email.lastIndexOf("@") + 1).toLowerCase();
}

/**
 * The first claim another workspace holds on `email`, or null.
 *
 * `includeAccount` adds the membership test, used by Create Email: there the
 * address is about to become a mailbox of this workspace, so an account that
 * already lives in a different workspace (and not this one) must not quietly
 * receive it.
 */
export async function claimElsewhere(
  email: string,
  tenantId: string,
  options: { includeAccount?: boolean } = {}
): Promise<AddressClaim | null> {
  const address = email.trim().toLowerCase();
  return withCrossTenant(async () => {
    const domain = await prisma.mailDomain.findFirst({
      where: {
        domainName: { equals: domainOf(address), mode: "insensitive" },
        verificationStatus: "VERIFIED",
        tenantId: { not: tenantId },
      },
      select: { id: true },
    });
    if (domain) return "DOMAIN";

    const mailbox = await prisma.mailbox.findFirst({
      where: { address: { equals: address, mode: "insensitive" }, tenantId: { not: tenantId } },
      select: { id: true },
    });
    if (mailbox) return "MAILBOX";

    if (options.includeAccount) {
      const user = await prisma.appUser.findUnique({
        where: { email: address },
        select: { memberships: { where: { status: { not: "REMOVED" } }, select: { tenantId: true } } },
      });
      const tenants = user?.memberships.map((m) => m.tenantId) ?? [];
      if (tenants.length > 0 && !tenants.includes(tenantId)) return "ACCOUNT";
    }
    return null;
  });
}

/** The refusal for an address another workspace has a claim on. Says what to do, not who. */
export function addressManagedElsewhere(email: string): AppError {
  return new AppError(
    `${email} is managed by another organisation on Zoiko Mail, so it cannot be invited or given a mailbox here.`,
    409,
    ErrorCodes.CONFLICT,
    { reason: "ADDRESS_MANAGED_ELSEWHERE" }
  );
}

/**
 * Whether `email` is the address of a mailbox in any workspace.
 *
 * Such an address is set up only through the setup link its administrator
 * issues; self-registration must not claim (and so lock out) the account
 * waiting behind it.
 */
export async function isMailboxAddress(email: string): Promise<boolean> {
  const address = email.trim().toLowerCase();
  const mailbox = await withCrossTenant(() =>
    prisma.mailbox.findFirst({
      where: { address: { equals: address, mode: "insensitive" } },
      select: { id: true },
    })
  );
  return mailbox !== null;
}
