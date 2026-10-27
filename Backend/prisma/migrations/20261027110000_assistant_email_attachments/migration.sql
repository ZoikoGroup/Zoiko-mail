-- AI assistant: an email attached from Mail ("Summarize with Alet").

-- AlterEnum
ALTER TYPE "AssistantAttachmentKind" ADD VALUE 'EMAIL';

-- AlterTable
ALTER TABLE "assistant_attachments" ADD COLUMN     "source_mailbox_id" UUID,
ADD COLUMN     "source_message_id" UUID;
