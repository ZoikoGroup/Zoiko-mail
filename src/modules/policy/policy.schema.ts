import { z } from "zod";

export const policyTypeSchema = z.enum(["AI", "SENDING", "RETENTION", "DELETION", "ABUSE"]);
const effectSchema = z.enum(["ALLOW", "DENY"]);
const scalarSchema = z.union([z.string(), z.number(), z.boolean()]);

export const policyRulesSchema = z.object({
  defaultEffect: effectSchema,
  conditions: z.array(
    z.object({
      field: z.string().regex(/^[a-zA-Z][a-zA-Z0-9_.]{0,99}$/),
      operator: z.enum(["EQUALS", "NOT_EQUALS", "IN", "GREATER_THAN", "GREATER_THAN_OR_EQUAL", "LESS_THAN", "LESS_THAN_OR_EQUAL"]),
      value: z.union([scalarSchema, z.array(scalarSchema).min(1).max(100)]),
      effect: effectSchema,
    })
  ).max(50).default([]),
});

export const createPolicySchema = z.object({
  type: policyTypeSchema,
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(500).nullable().optional(),
  rules: policyRulesSchema,
});

export const policyIdParamsSchema = z.object({ policyId: z.string().uuid() });
export const listPoliciesSchema = z.object({
  type: policyTypeSchema.optional(),
  status: z.enum(["DRAFT", "ACTIVE", "ARCHIVED"]).optional(),
});
export const evaluatePolicySchema = z.object({
  type: policyTypeSchema,
  context: z.record(z.string(), z.unknown()),
});
export const retentionPreviewSchema = z.object({
  asOf: z.coerce.date().refine((value) => value.getTime() <= Date.now(), "asOf cannot be in the future")
    .default(() => new Date()),
});
export const retentionExecuteSchema = retentionPreviewSchema.extend({
  confirmation: z.literal("DELETE_ELIGIBLE_MESSAGES"),
});

export type CreatePolicyInput = z.infer<typeof createPolicySchema>;
export type EvaluatePolicyInput = z.infer<typeof evaluatePolicySchema>;
export type PolicyRules = z.infer<typeof policyRulesSchema>;
