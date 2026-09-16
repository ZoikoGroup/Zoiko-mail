import { z } from "zod";

export const createGroupSchema = z.object({
  name: z.string().trim().min(1).max(120),
  address: z.string().trim().toLowerCase().email().max(320),
  kind: z.enum(["SHARED", "DISTRIBUTION"]).default("DISTRIBUTION"),
});
export const groupIdParamsSchema = z.object({ groupId: z.string().uuid() });
export const updateGroupSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  kind: z.enum(["SHARED", "DISTRIBUTION"]).optional(),
  status: z.enum(["ACTIVE", "SUSPENDED"]).optional(),
});
export const addGroupMemberSchema = z.object({ membershipId: z.string().uuid() });
export const groupMemberParamsSchema = z.object({
  groupId: z.string().uuid(),
  membershipId: z.string().uuid(),
});