-- P1 (ZM-05): bind every refresh-token row to the sign-in it belongs to, so a
-- single session can be revoked and every request can check its session is
-- still live; record why a row was revoked, so a deliberately ended session is
-- not mistaken for a stolen token.
ALTER TABLE "refresh_tokens" ADD COLUMN "session_id" TEXT;
ALTER TABLE "refresh_tokens" ADD COLUMN "revoked_reason" TEXT;
CREATE INDEX "refresh_tokens_session_id_idx" ON "refresh_tokens"("session_id");

-- P1 (ZMT-19, A08): high-risk mailbox changes raise security alerts.
ALTER TYPE "SecurityAlertType" ADD VALUE IF NOT EXISTS 'FORWARDING_EXTERNAL';
ALTER TYPE "SecurityAlertType" ADD VALUE IF NOT EXISTS 'MAILBOX_ACCESS_GRANTED';
