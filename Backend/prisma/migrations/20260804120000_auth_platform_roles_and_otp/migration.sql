-- Auth system: platform role dimension, extended lifecycle statuses, email OTP.
-- Non-destructive: only adds enum values, columns, and one table.
-- Note: MembershipRole 'SUPPORT' is intentionally retained (Postgres cannot
-- cleanly DROP an enum value) but is deprecated. Support is now a platform
-- concern (PlatformRole + time-boxed SupportAccessGrant), not a membership role.

-- New enum types --------------------------------------------------------------
CREATE TYPE "PlatformRole" AS ENUM ('NONE', 'SUPPORT', 'SUPER_ADMIN');
CREATE TYPE "OtpPurpose" AS ENUM ('EMAIL_VERIFICATION');

-- Extend existing status enums ------------------------------------------------
ALTER TYPE "AppUserStatus" ADD VALUE IF NOT EXISTS 'PENDING_VERIFICATION';
ALTER TYPE "AppUserStatus" ADD VALUE IF NOT EXISTS 'INVITED';
ALTER TYPE "AppUserStatus" ADD VALUE IF NOT EXISTS 'SUSPENDED';
ALTER TYPE "TenantStatus"  ADD VALUE IF NOT EXISTS 'DELETED_PENDING';

-- Identity / auth fields on app_users -----------------------------------------
ALTER TABLE "app_users"
  ADD COLUMN IF NOT EXISTS "platform_role" "PlatformRole" NOT NULL DEFAULT 'NONE',
  ADD COLUMN IF NOT EXISTS "email_verified_at" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "last_login_at" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "failed_login_attempts" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "locked_until" TIMESTAMP(3);

-- Email OTP (registration email-ownership verification) -----------------------
CREATE TABLE IF NOT EXISTS "email_otps" (
  "id"          UUID NOT NULL,
  "user_id"     UUID NOT NULL,
  "purpose"     "OtpPurpose" NOT NULL DEFAULT 'EMAIL_VERIFICATION',
  "code_hash"   TEXT NOT NULL,
  "expires_at"  TIMESTAMP(3) NOT NULL,
  "consumed_at" TIMESTAMP(3),
  "attempts"    INTEGER NOT NULL DEFAULT 0,
  "created_at"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "email_otps_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "email_otps_user_id_purpose_idx"
  ON "email_otps"("user_id", "purpose");

ALTER TABLE "email_otps"
  ADD CONSTRAINT "email_otps_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "app_users"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;