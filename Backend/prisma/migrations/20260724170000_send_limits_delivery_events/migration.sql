CREATE TYPE "DeliveryEventType" AS ENUM ('QUEUED', 'DELIVERED', 'FAILED', 'BOUNCED', 'COMPLAINED');

ALTER TABLE "mailboxes"
ADD COLUMN "send_window_started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN "send_recipient_count" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "send_suspended_at" TIMESTAMP(3),
ADD COLUMN "send_suspension_reason" TEXT;

CREATE TABLE "delivery_events" (
  "id" UUID NOT NULL,
  "tenant_id" UUID NOT NULL,
  "message_id" UUID NOT NULL,
  "recipient_id" UUID,
  "type" "DeliveryEventType" NOT NULL,
  "provider_event_id" TEXT,
  "failure_code" TEXT,
  "failure_reason" TEXT,
  "metadata" JSONB,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "delivery_events_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "delivery_events_tenant_id_message_id_created_at_idx"
ON "delivery_events"("tenant_id", "message_id", "created_at");
CREATE INDEX "delivery_events_tenant_id_type_created_at_idx"
ON "delivery_events"("tenant_id", "type", "created_at");

ALTER TABLE "delivery_events"
ADD CONSTRAINT "delivery_events_message_id_fkey"
FOREIGN KEY ("message_id") REFERENCES "email_messages"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
