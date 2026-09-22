-- Drop a database default this schema does not use anywhere else.
--
-- 20260921090000 gave support_access_requests.id a gen_random_uuid() default.
-- Every other table here leaves the id to Prisma's @default(uuid()), so the
-- column drifted from the model the moment it was created — the same class of
-- mismatch that left four tables unmodelled after PR #35, just smaller.
ALTER TABLE "support_access_requests" ALTER COLUMN "id" DROP DEFAULT;
