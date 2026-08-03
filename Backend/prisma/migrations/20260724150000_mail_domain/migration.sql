CREATE TYPE "MessageStatus" AS ENUM ('DRAFT', 'SENT');
CREATE TYPE "RecipientType" AS ENUM ('TO', 'CC', 'BCC');
CREATE TYPE "DeliveryStatus" AS ENUM ('PENDING', 'DELIVERED', 'QUEUED', 'FAILED');
CREATE TYPE "MailFolder" AS ENUM ('DRAFTS', 'INBOX', 'SENT', 'TRASH');

CREATE TABLE "mailboxes" (
  "id" UUID NOT NULL,
  "tenant_id" UUID NOT NULL,
  "membership_id" UUID NOT NULL,
  "address" TEXT NOT NULL,
  "storage_used" BIGINT NOT NULL DEFAULT 0,
  "storage_limit" BIGINT NOT NULL DEFAULT 1073741824,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "mailboxes_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "email_messages" (
  "id" UUID NOT NULL,
  "tenant_id" UUID NOT NULL,
  "author_user_id" UUID NOT NULL,
  "subject" TEXT NOT NULL,
  "text_body" TEXT,
  "html_body" TEXT,
  "status" "MessageStatus" NOT NULL DEFAULT 'DRAFT',
  "sent_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "email_messages_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "message_recipients" (
  "id" UUID NOT NULL,
  "tenant_id" UUID NOT NULL,
  "message_id" UUID NOT NULL,
  "email" TEXT NOT NULL,
  "type" "RecipientType" NOT NULL,
  "delivery_status" "DeliveryStatus" NOT NULL DEFAULT 'PENDING',
  "recipient_membership_id" UUID,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "message_recipients_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "mailbox_messages" (
  "id" UUID NOT NULL,
  "tenant_id" UUID NOT NULL,
  "mailbox_id" UUID NOT NULL,
  "message_id" UUID NOT NULL,
  "folder" "MailFolder" NOT NULL,
  "is_read" BOOLEAN NOT NULL DEFAULT false,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "mailbox_messages_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "message_attachments" (
  "id" UUID NOT NULL,
  "tenant_id" UUID NOT NULL,
  "message_id" UUID NOT NULL,
  "file_name" TEXT NOT NULL,
  "content_type" TEXT NOT NULL,
  "size_bytes" INTEGER NOT NULL,
  "storage_key" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "message_attachments_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "mailboxes_membership_id_key" ON "mailboxes"("membership_id");
CREATE UNIQUE INDEX "mailboxes_tenant_id_address_key" ON "mailboxes"("tenant_id", "address");
CREATE INDEX "mailboxes_tenant_id_membership_id_idx" ON "mailboxes"("tenant_id", "membership_id");
CREATE INDEX "email_messages_tenant_id_author_user_id_created_at_idx" ON "email_messages"("tenant_id", "author_user_id", "created_at");
CREATE UNIQUE INDEX "message_recipients_message_id_email_type_key" ON "message_recipients"("message_id", "email", "type");
CREATE INDEX "message_recipients_tenant_id_email_idx" ON "message_recipients"("tenant_id", "email");
CREATE UNIQUE INDEX "mailbox_messages_mailbox_id_message_id_key" ON "mailbox_messages"("mailbox_id", "message_id");
CREATE INDEX "mailbox_messages_tenant_id_mailbox_id_folder_created_at_idx" ON "mailbox_messages"("tenant_id", "mailbox_id", "folder", "created_at");
CREATE INDEX "message_attachments_tenant_id_message_id_idx" ON "message_attachments"("tenant_id", "message_id");

ALTER TABLE "mailboxes" ADD CONSTRAINT "mailboxes_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "mailboxes" ADD CONSTRAINT "mailboxes_membership_id_fkey" FOREIGN KEY ("membership_id") REFERENCES "tenant_memberships"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "email_messages" ADD CONSTRAINT "email_messages_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "email_messages" ADD CONSTRAINT "email_messages_author_user_id_fkey" FOREIGN KEY ("author_user_id") REFERENCES "app_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "message_recipients" ADD CONSTRAINT "message_recipients_message_id_fkey" FOREIGN KEY ("message_id") REFERENCES "email_messages"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "mailbox_messages" ADD CONSTRAINT "mailbox_messages_mailbox_id_fkey" FOREIGN KEY ("mailbox_id") REFERENCES "mailboxes"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "mailbox_messages" ADD CONSTRAINT "mailbox_messages_message_id_fkey" FOREIGN KEY ("message_id") REFERENCES "email_messages"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "message_attachments" ADD CONSTRAINT "message_attachments_message_id_fkey" FOREIGN KEY ("message_id") REFERENCES "email_messages"("id") ON DELETE CASCADE ON UPDATE CASCADE;
