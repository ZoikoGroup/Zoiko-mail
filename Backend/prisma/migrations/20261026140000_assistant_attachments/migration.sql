-- AI assistant: files attached to questions.

-- CreateEnum
CREATE TYPE "AssistantAttachmentKind" AS ENUM ('DOCUMENT', 'IMAGE');

-- CreateTable
CREATE TABLE "assistant_attachments" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "membership_id" UUID NOT NULL,
    "conversation_id" UUID,
    "message_id" UUID,
    "kind" "AssistantAttachmentKind" NOT NULL,
    "file_name" TEXT NOT NULL,
    "content_type" TEXT NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "extracted_text" TEXT,
    "page_count" INTEGER,
    "truncated" BOOLEAN NOT NULL DEFAULT false,
    "storage_key" TEXT,
    "expires_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "assistant_attachments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "assistant_attachments_tenant_id_membership_id_expires_at_idx" ON "assistant_attachments"("tenant_id", "membership_id", "expires_at");

-- CreateIndex
CREATE INDEX "assistant_attachments_message_id_idx" ON "assistant_attachments"("message_id");

-- AddForeignKey
ALTER TABLE "assistant_attachments" ADD CONSTRAINT "assistant_attachments_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assistant_attachments" ADD CONSTRAINT "assistant_attachments_membership_id_fkey" FOREIGN KEY ("membership_id") REFERENCES "tenant_memberships"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assistant_attachments" ADD CONSTRAINT "assistant_attachments_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "assistant_conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assistant_attachments" ADD CONSTRAINT "assistant_attachments_message_id_fkey" FOREIGN KEY ("message_id") REFERENCES "assistant_messages"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Same row-level isolation as the rest of the tenant data (AC-004).
ALTER TABLE "assistant_attachments" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "assistant_attachments" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "assistant_attachments_tenant_isolation" ON "assistant_attachments";
CREATE POLICY "assistant_attachments_tenant_isolation" ON "assistant_attachments"
  USING (zoiko_cross_tenant() OR tenant_id = zoiko_current_tenant())
  WITH CHECK (zoiko_cross_tenant() OR tenant_id = zoiko_current_tenant());

GRANT SELECT, INSERT, UPDATE, DELETE ON "assistant_attachments" TO zoiko_app;
