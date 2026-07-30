CREATE TABLE "message_threads" (
  "id" UUID NOT NULL,
  "tenant_id" UUID NOT NULL,
  "subject_normalized" TEXT NOT NULL,
  "participants" JSONB NOT NULL,
  "first_message_at" TIMESTAMP(3) NOT NULL,
  "last_message_at" TIMESTAMP(3) NOT NULL,
  "message_count" INTEGER NOT NULL DEFAULT 1,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "message_threads_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "email_messages" ADD COLUMN "thread_id" UUID;

CREATE INDEX "message_threads_tenant_id_last_message_at_idx"
ON "message_threads"("tenant_id", "last_message_at");
CREATE INDEX "email_messages_tenant_id_thread_id_created_at_idx"
ON "email_messages"("tenant_id", "thread_id", "created_at");

ALTER TABLE "message_threads"
ADD CONSTRAINT "message_threads_tenant_id_fkey"
FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "email_messages"
ADD CONSTRAINT "email_messages_thread_id_fkey"
FOREIGN KEY ("thread_id") REFERENCES "message_threads"("id")
ON DELETE SET NULL ON UPDATE CASCADE;
