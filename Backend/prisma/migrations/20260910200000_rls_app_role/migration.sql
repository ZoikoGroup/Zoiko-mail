-- A role the row-level policies actually apply to — AC-004, Security §8.1.
--
-- The previous migration enabled and FORCEd RLS on the eight high-sensitivity
-- tables, and it was completely inert: the runtime connects as a superuser,
-- and a superuser bypasses row-level security no matter what any policy says.
-- Enabled, forced, and ignored — a control that reports as present and stops
-- nothing.
--
-- Rather than change the attributes of the role the deployment already uses
-- (which would also break migrations, since those legitimately need to create
-- types and triggers), the application switches into this one for the
-- duration of each statement it scopes. `SET LOCAL ROLE` is transaction-local,
-- so it reverts at commit alongside the tenant setting itself, and a superuser
-- is permitted to assume any role.
--
-- NOLOGIN on purpose: nothing should ever connect as this role directly. It
-- exists to be assumed, so its only privileges are the ones the application
-- needs while it holds tenant data in its hands.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'zoiko_app') THEN
    CREATE ROLE zoiko_app NOLOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;
  ELSE
    -- Idempotent, and it re-asserts the two attributes that matter if someone
    -- has granted them since.
    ALTER ROLE zoiko_app NOSUPERUSER NOBYPASSRLS;
  END IF;
END
$$;

GRANT USAGE ON SCHEMA public TO zoiko_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO zoiko_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO zoiko_app;

-- Tables added by later migrations are created by the owner, not by this
-- role, so they need the same grant without anybody remembering to write it.
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO zoiko_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO zoiko_app;
