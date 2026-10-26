-- AI assistant (Alet): a member's own conversations.

-- CreateEnum
CREATE TYPE "AssistantRole" AS ENUM ('USER', 'ASSISTANT');

-- CreateTable
CREATE TABLE "assistant_conversations" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "membership_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "assistant_conversations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assistant_messages" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "conversation_id" UUID NOT NULL,
    "role" "AssistantRole" NOT NULL,
    "content" TEXT NOT NULL,
    "model" TEXT,
    "prompt_tokens" INTEGER,
    "completion_tokens" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "assistant_messages_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "assistant_conversations_tenant_id_membership_id_updated_at_idx" ON "assistant_conversations"("tenant_id", "membership_id", "updated_at");

-- CreateIndex
CREATE INDEX "assistant_messages_conversation_id_created_at_idx" ON "assistant_messages"("conversation_id", "created_at");

-- AddForeignKey
ALTER TABLE "assistant_conversations" ADD CONSTRAINT "assistant_conversations_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assistant_conversations" ADD CONSTRAINT "assistant_conversations_membership_id_fkey" FOREIGN KEY ("membership_id") REFERENCES "tenant_memberships"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assistant_messages" ADD CONSTRAINT "assistant_messages_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assistant_messages" ADD CONSTRAINT "assistant_messages_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "assistant_conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Same row-level isolation as the rest of the tenant data (AC-004).
ALTER TABLE "assistant_conversations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "assistant_conversations" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "assistant_conversations_tenant_isolation" ON "assistant_conversations";
CREATE POLICY "assistant_conversations_tenant_isolation" ON "assistant_conversations"
  USING (zoiko_cross_tenant() OR tenant_id = zoiko_current_tenant())
  WITH CHECK (zoiko_cross_tenant() OR tenant_id = zoiko_current_tenant());

ALTER TABLE "assistant_messages" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "assistant_messages" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "assistant_messages_tenant_isolation" ON "assistant_messages";
CREATE POLICY "assistant_messages_tenant_isolation" ON "assistant_messages"
  USING (zoiko_cross_tenant() OR tenant_id = zoiko_current_tenant())
  WITH CHECK (zoiko_cross_tenant() OR tenant_id = zoiko_current_tenant());

GRANT SELECT, INSERT, UPDATE, DELETE ON "assistant_conversations" TO zoiko_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON "assistant_messages" TO zoiko_app;
