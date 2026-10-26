-- AlterTable
ALTER TABLE "commitments" ADD COLUMN     "reminder_at" TIMESTAMP(3),
ADD COLUMN     "reminder_sent_at" TIMESTAMP(3),
ADD COLUMN     "team_mailbox_id" UUID;

-- CreateIndex
CREATE INDEX "commitments_tenant_id_team_mailbox_id_status_due_at_idx" ON "commitments"("tenant_id", "team_mailbox_id", "status", "due_at");

-- CreateIndex
CREATE INDEX "commitments_reminder_at_idx" ON "commitments"("reminder_at");

-- AddForeignKey
ALTER TABLE "commitments" ADD CONSTRAINT "commitments_team_mailbox_id_fkey" FOREIGN KEY ("team_mailbox_id") REFERENCES "mailboxes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

