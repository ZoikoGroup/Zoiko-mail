-- Marketing fields for the Plan rows: a one-line positioning statement and
-- the per-plan feature list rendered on the billing page.
ALTER TABLE "plans" ADD COLUMN "tagline" TEXT;

ALTER TABLE "plans" ADD COLUMN "features" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];