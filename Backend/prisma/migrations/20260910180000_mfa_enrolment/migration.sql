-- Multi-factor authentication — AC-002, Security §5.
--
-- "MFA is enforced for Owners, Admins and Support actors." Nothing in the
-- product had a second factor at all: no secret, no enrolment, no challenge.
-- The admin dashboard even carried a hardcoded MFA_SUPPORTED = false so it
-- would stop reporting a control that did not exist.
--
-- The secret is stored as AES-256-GCM ciphertext rather than plaintext. A
-- TOTP secret is not a hash: whoever reads it can mint valid codes forever,
-- which makes it closer to a password in the clear than to password_hash
-- beside it.
--
-- mfa_last_used_step exists because RFC 6238 §5.2 asks that a code be
-- accepted only once. Without it, a code observed in transit stays valid for
-- the rest of its ninety-second window.
ALTER TABLE "app_users"
  ADD COLUMN "mfa_secret"          TEXT,
  ADD COLUMN "mfa_enrolled_at"     TIMESTAMP(3),
  ADD COLUMN "mfa_last_used_step"  INTEGER;

-- Single-use recovery codes, hashed the way passwords are.
--
-- Required rather than optional: enforcing MFA without a recovery path turns
-- a lost phone into a lost workspace, and the Security specification is
-- explicit that recovery "must be auditable and must not allow support staff
-- to bypass MFA without a security-admin approved exception" — which presumes
-- a recovery mechanism the user holds themselves.
CREATE TABLE "mfa_recovery_codes" (
  "id"         UUID NOT NULL,
  "user_id"    UUID NOT NULL,
  "code_hash"  TEXT NOT NULL,
  "used_at"    TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "mfa_recovery_codes_pkey" PRIMARY KEY ("id")
);

-- Unused codes for one account, which is the only lookup the challenge makes.
CREATE INDEX "mfa_recovery_codes_user_id_used_at_idx"
  ON "mfa_recovery_codes"("user_id", "used_at");

ALTER TABLE "mfa_recovery_codes"
  ADD CONSTRAINT "mfa_recovery_codes_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "app_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
