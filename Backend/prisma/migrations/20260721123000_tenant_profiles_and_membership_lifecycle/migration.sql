ALTER TYPE "MembershipStatus" ADD VALUE IF NOT EXISTS 'INVITED';
ALTER TYPE "MembershipStatus" ADD VALUE IF NOT EXISTS 'REMOVED';

ALTER TABLE "tenants"
  ADD COLUMN IF NOT EXISTS "timezone" TEXT DEFAULT 'UTC',
  ADD COLUMN IF NOT EXISTS "language" TEXT DEFAULT 'en',
  ADD COLUMN IF NOT EXISTS "logo_url" TEXT,
  ADD COLUMN IF NOT EXISTS "allowed_domains" TEXT[] DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN IF NOT EXISTS "password_policy" JSONB,
  ADD COLUMN IF NOT EXISTS "member_limit" INTEGER,
  ADD COLUMN IF NOT EXISTS "ai_settings" JSONB,
  ADD COLUMN IF NOT EXISTS "settings" JSONB;

ALTER TABLE "app_users"
  ADD COLUMN IF NOT EXISTS "avatar_url" TEXT,
  ADD COLUMN IF NOT EXISTS "phone_number" TEXT,
  ADD COLUMN IF NOT EXISTS "timezone" TEXT DEFAULT 'UTC',
  ADD COLUMN IF NOT EXISTS "language" TEXT DEFAULT 'en';

ALTER TABLE "tenant_memberships"
  ADD COLUMN IF NOT EXISTS "invite_token" TEXT,
  ADD COLUMN IF NOT EXISTS "invite_expires_at" TIMESTAMP(3);

CREATE UNIQUE INDEX IF NOT EXISTS "tenant_memberships_invite_token_key"
  ON "tenant_memberships"("invite_token");
CREATE INDEX IF NOT EXISTS "tenant_memberships_invite_token_idx"
  ON "tenant_memberships"("invite_token");
