ALTER TYPE "MessageStatus" ADD VALUE 'SCHEDULED';
ALTER TYPE "MessageStatus" ADD VALUE 'SENDING';
ALTER TYPE "MessageStatus" ADD VALUE 'FAILED';

ALTER TABLE "email_messages"
ADD COLUMN "scheduled_at" TIMESTAMP(3),
ADD COLUMN "schedule_attempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "schedule_last_error" TEXT;

CREATE INDEX "email_messages_status_scheduled_at_idx"
ON "email_messages"("status", "scheduled_at");
