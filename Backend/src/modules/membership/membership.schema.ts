import { z } from "zod";

export const membershipIdParamsSchema = z.object({
  membershipId: z.string().uuid(),
});

/** A person's name, as typed. Trimmed so " Priya " does not reach a letter. */
const personName = z.string().trim().min(1).max(80);

export const addMemberSchema = z.object({
  email: z.string().email().transform((value) => value.toLowerCase()),
  role: z.enum(["OWNER", "ADMIN", "MEMBER", "SUPPORT"]),
});

/**
 * Inviting someone asks for their name as well as their address, so the
 * letter can greet them and the placeholder account carries a real name
 * instead of the local part of an email.
 *
 * Optional rather than required: this endpoint is also called by tests and by
 * flows that only know an address, and an invitation without a name is still
 * a valid invitation — the letter greets them plainly instead.
 */
export const createInvitationSchema = addMemberSchema.extend({
  firstName: personName.optional(),
  lastName: personName.optional(),
  /**
   * The letter body, if the admin edited the draft before sending.
   *
   * Plain text, one string per paragraph — never HTML. The mailer escapes it
   * on the way into the email, so an edited body cannot inject markup into a
   * message sent under the workspace's name.
   */
  letterBody: z.array(z.string().trim().min(1).max(2000)).min(1).max(12).optional(),
});

/** Draft the letter for review without inviting anyone or sending anything. */
export const previewInvitationSchema = z.object({
  email: z.string().email().transform((value) => value.toLowerCase()),
  role: z.enum(["OWNER", "ADMIN", "MEMBER", "SUPPORT"]),
  firstName: personName.optional(),
  lastName: personName.optional(),
});

export const acceptInvitationSchema = z
  .object({
    invitationToken: z.string().min(32).max(512).optional(),
    membershipId: z.string().uuid().optional(),
  })
  .refine((v) => v.invitationToken || v.membershipId, {
    message: "Either invitationToken or membershipId is required",
  });

export const updateMemberSchema = z
  .object({
    role: z.enum(["OWNER", "ADMIN", "MEMBER", "SUPPORT"]).optional(),
    status: z.enum(["ACTIVE", "SUSPENDED"]).optional(),
  })
  .refine((value) => value.role !== undefined || value.status !== undefined, {
    message: "At least one of role or status is required",
  });

export type AddMemberInput = z.infer<typeof addMemberSchema>;
export type UpdateMemberInput = z.infer<typeof updateMemberSchema>;
export type CreateInvitationInput = z.infer<typeof createInvitationSchema>;
export type PreviewInvitationInput = z.infer<typeof previewInvitationSchema>;
export type AcceptInvitationInput = z.infer<typeof acceptInvitationSchema>;
