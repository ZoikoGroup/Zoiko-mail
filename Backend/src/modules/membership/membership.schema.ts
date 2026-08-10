import { z } from "zod";

export const membershipIdParamsSchema = z.object({
  membershipId: z.string().uuid(),
});

export const addMemberSchema = z.object({
  email: z.string().email().transform((value) => value.toLowerCase()),
  role: z.enum(["OWNER", "ADMIN", "MEMBER", "SUPPORT"]),
});

export const createInvitationSchema = addMemberSchema;

export const acceptInvitationSchema = z.object({
  invitationToken: z.string().min(32).max(512),
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
export type AcceptInvitationInput = z.infer<typeof acceptInvitationSchema>;
