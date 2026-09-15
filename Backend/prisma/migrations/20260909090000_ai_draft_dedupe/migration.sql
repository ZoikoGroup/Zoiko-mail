-- AlterTable
-- Source AIAction that produced an AI draft (ZM-BE-009). Unique per tenant so
-- generated drafts are idempotent: one draft per AIAction, no duplicate copies
-- after a job retry or a second confirmed action on the same thread.
ALTER TABLE "email_messages" ADD COLUMN     "source_ai_action_id" UUID;

-- CreateIndex
CREATE UNIQUE INDEX "email_messages_tenant_id_source_ai_action_id_key" ON "email_messages"("tenant_id", "source_ai_action_id");

-- AddForeignKey
ALTER TABLE "email_messages" ADD CONSTRAINT "email_messages_source_ai_action_id_fkey" FOREIGN KEY ("source_ai_action_id") REFERENCES "ai_actions"("id") ON DELETE SET NULL ON UPDATE CASCADE;