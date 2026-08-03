CREATE TABLE "mail_labels" (
  "id" UUID NOT NULL,
  "tenant_id" UUID NOT NULL,
  "mailbox_id" UUID NOT NULL,
  "name" TEXT NOT NULL,
  "normalized_name" TEXT NOT NULL,
  "color" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "mail_labels_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "mailbox_message_labels" (
  "tenant_id" UUID NOT NULL,
  "mailbox_message_id" UUID NOT NULL,
  "label_id" UUID NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "mailbox_message_labels_pkey" PRIMARY KEY ("mailbox_message_id", "label_id")
);

CREATE UNIQUE INDEX "mail_labels_mailbox_id_normalized_name_key"
ON "mail_labels"("mailbox_id", "normalized_name");
CREATE INDEX "mail_labels_tenant_id_mailbox_id_idx"
ON "mail_labels"("tenant_id", "mailbox_id");
CREATE INDEX "mailbox_message_labels_tenant_id_label_id_idx"
ON "mailbox_message_labels"("tenant_id", "label_id");

ALTER TABLE "mail_labels"
ADD CONSTRAINT "mail_labels_tenant_id_fkey"
FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "mail_labels"
ADD CONSTRAINT "mail_labels_mailbox_id_fkey"
FOREIGN KEY ("mailbox_id") REFERENCES "mailboxes"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "mailbox_message_labels"
ADD CONSTRAINT "mailbox_message_labels_tenant_id_fkey"
FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "mailbox_message_labels"
ADD CONSTRAINT "mailbox_message_labels_mailbox_message_id_fkey"
FOREIGN KEY ("mailbox_message_id") REFERENCES "mailbox_messages"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "mailbox_message_labels"
ADD CONSTRAINT "mailbox_message_labels_label_id_fkey"
FOREIGN KEY ("label_id") REFERENCES "mail_labels"("id") ON DELETE CASCADE ON UPDATE CASCADE;
