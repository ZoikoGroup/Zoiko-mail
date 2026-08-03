import type { MembershipRole, PolicyStatus, PolicyType, Prisma } from "@prisma/client";
import { prisma } from "../../config/prisma.js";
import { AppError } from "../../common/errors/AppError.js";
import { ErrorCodes } from "../../common/errors/errorCodes.js";
import { auditService } from "../audit/audit.service.js";
import { policyRulesSchema, type CreatePolicyInput, type EvaluatePolicyInput, type PolicyRules } from "./policy.schema.js";

interface Context {
  tenantId: string;
  userId: string;
  role: MembershipRole;
  requestId?: string;
  ipAddress?: string | null;
  userAgent?: string | null;
}

function readField(context: Record<string, unknown>, path: string): unknown {
  return path.split(".").reduce<unknown>((value, part) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
    return (value as Record<string, unknown>)[part];
  }, context);
}

function matches(actual: unknown, operator: PolicyRules["conditions"][number]["operator"], expected: unknown): boolean {
  if (operator === "EQUALS") return actual === expected;
  if (operator === "NOT_EQUALS") return actual !== expected;
  if (operator === "IN") return Array.isArray(expected) && expected.includes(actual as never);
  if (typeof actual !== "number" || typeof expected !== "number") return false;
  if (operator === "GREATER_THAN") return actual > expected;
  if (operator === "GREATER_THAN_OR_EQUAL") return actual >= expected;
  if (operator === "LESS_THAN") return actual < expected;
  return actual <= expected;
}

export class PolicyService {
  async list(tenantId: string, filters: { type?: PolicyType; status?: PolicyStatus }) {
    return prisma.tenantPolicy.findMany({
      where: { tenantId, type: filters.type, status: filters.status },
      orderBy: [{ type: "asc" }, { version: "desc" }],
    });
  }

  async get(tenantId: string, policyId: string) {
    const policy = await prisma.tenantPolicy.findFirst({ where: { id: policyId, tenantId } });
    if (!policy) throw new AppError("Policy not found", 404, ErrorCodes.NOT_FOUND);
    return policy;
  }

  async create(input: CreatePolicyInput, context: Context) {
    return prisma.$transaction(async (tx) => {
      const latest = await tx.tenantPolicy.aggregate({
        where: { tenantId: context.tenantId, type: input.type },
        _max: { version: true },
      });
      const policy = await tx.tenantPolicy.create({
        data: {
          tenantId: context.tenantId,
          type: input.type,
          name: input.name,
          description: input.description,
          version: (latest._max.version ?? 0) + 1,
          rules: input.rules as Prisma.InputJsonValue,
          createdByUserId: context.userId,
        },
      });
      await this.audit(tx, context, "POLICY_CREATED", policy.id, { type: policy.type, version: policy.version });
      return policy;
    });
  }

  async activate(policyId: string, context: Context) {
    return prisma.$transaction(async (tx) => {
      const target = await tx.tenantPolicy.findFirst({
        where: { id: policyId, tenantId: context.tenantId },
      });
      if (!target) throw new AppError("Policy not found", 404, ErrorCodes.NOT_FOUND);
      if (target.status === "ACTIVE") return target;

      await tx.tenantPolicy.updateMany({
        where: { tenantId: context.tenantId, type: target.type, status: "ACTIVE" },
        data: { status: "ARCHIVED" },
      });
      const policy = await tx.tenantPolicy.update({
        where: { id: target.id },
        data: { status: "ACTIVE", activatedAt: new Date() },
      });
      await this.audit(tx, context, "POLICY_ACTIVATED", policy.id, { type: policy.type, version: policy.version });
      return policy;
    });
  }

  async evaluate(input: EvaluatePolicyInput, context: Context) {
    const policy = await prisma.tenantPolicy.findFirst({
      where: { tenantId: context.tenantId, type: input.type, status: "ACTIVE" },
      orderBy: { version: "desc" },
    });
    if (!policy) {
      return { effect: "DENY" as const, reason: "NO_ACTIVE_POLICY", policyId: null, version: null };
    }

    const rules = policyRulesSchema.parse(policy.rules);
    const index = rules.conditions.findIndex((condition) =>
      matches(readField(input.context, condition.field), condition.operator, condition.value)
    );
    const effect = index >= 0 ? rules.conditions[index]!.effect : rules.defaultEffect;
    return {
      effect,
      reason: index >= 0 ? "CONDITION_MATCHED" : "DEFAULT_EFFECT",
      matchedConditionIndex: index >= 0 ? index : null,
      policyId: policy.id,
      version: policy.version,
      type: policy.type,
    };
  }

  private async audit(tx: Prisma.TransactionClient, context: Context, eventType: string, targetId: string, metadata: Prisma.InputJsonValue) {
    await auditService.record({
      tenantId: context.tenantId,
      actorUserId: context.userId,
      eventType,
      targetType: "TenantPolicy",
      targetId,
      requestId: context.requestId,
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
      metadata,
    }, tx);
  }
}

export const policyService = new PolicyService();
