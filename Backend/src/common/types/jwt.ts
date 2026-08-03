import type { MembershipRole } from "@prisma/client";

export type TokenType = "access" | "refresh";

export interface AccessTokenPayload {
  sub: string;
  tenantId: string;
  membershipId: string;
  role: MembershipRole;
  type: "access";
}

export interface RefreshTokenPayload {
  sub: string;
  tenantId: string;
  membershipId: string;
  role: MembershipRole;
  type: "refresh";
  jti: string;
}

export interface AuthContext {
  sub: string;
  tenantId: string;
  membershipId: string;
  role: MembershipRole;
  type: TokenType;
}

export interface TenantContextData {
  tenantId: string;
  userId: string;
  membershipId: string;
  role: MembershipRole;
  tenant: {
    id: string;
    name: string;
    status: string;
    planCode: string;
  };
  user: {
    id: string;
    email: string;
    displayName: string;
    status: string;
  };
}

declare global {
  namespace Express {
    interface Request {
      requestId: string;
      auth?: AuthContext;
      tenantContext?: TenantContextData;
    }
  }
}

export {};
