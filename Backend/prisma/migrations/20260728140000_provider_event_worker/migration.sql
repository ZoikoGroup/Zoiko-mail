ALTER TYPE "ProviderEventStatus" ADD VALUE 'RETRY';
ALTER TYPE "ProviderEventStatus" ADD VALUE 'DEAD_LETTER';

ALTER TABLE "provider_events"
ADD COLUMN "attempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "max_attempts" INTEGER NOT NULL DEFAULT 5,
ADD COLUMN "run_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN "locked_at" TIMESTAMP(3);

CREATE INDEX "provider_events_processing_status_run_at_idx"
ON "provider_events"("processing_status", "run_at");
