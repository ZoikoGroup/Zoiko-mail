-- Drop the empty-array default on thread_participants.roles.
--
-- Two reasons, and they agree. Semantically, a thread participant with no
-- roles says somebody was involved but not how, which is the thing §6.8
-- exists to record — every writer knows the role, so none of them should be
-- able to omit it. Mechanically, Prisma does not model a list default, so
-- leaving it in place reported as permanent drift and would have failed
-- `migrate diff --exit-code` on every run from here on.
ALTER TABLE "thread_participants" ALTER COLUMN "roles" DROP DEFAULT;
