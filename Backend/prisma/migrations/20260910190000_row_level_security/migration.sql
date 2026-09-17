-- Row-level security on the high-sensitivity tables — AC-004, Security §8.1.
--
-- "High-sensitivity tables must use PostgreSQL Row-Level Security as
-- defense-in-depth: message, thread, participant, thread_participant,
-- commitment, ai_action, audit_event where feasible."
--
-- Tenant isolation was enforced in application code alone: every query
-- carries `where: { tenantId }`, and every query has to remember to. That is
-- the layer §8.1 wants a backstop underneath, because the failure it protects
-- against is precisely a query that forgot — or a raw statement that never
-- had one.
--
-- The two tables §8.1 names that do not exist yet, participant and
-- thread_participant, are covered by no policy because they are covered by no
-- schema; the message satellites that do exist are included, since a
-- recipient row or an attachment is the message.
--
-- WHAT THIS IS AND IS NOT
--
-- The policies read a transaction-local setting that the application sets on
-- every statement (see src/config/prisma.ts). Because the runtime connects as
-- the table owner, the tables are FORCEd so the owner is subject too —
-- otherwise the policies would be decorative for the only role that uses
-- them.
--
-- The escape hatch, `zoiko.cross_tenant`, is set by the paths that
-- legitimately span workspaces: the platform support console, the job worker,
-- a test teardown. It is in-band, which means an attacker holding the
-- application's own credentials could set it too. So the honest description
-- of this control is the one §8.1 uses — defence in depth. It turns a missing
-- WHERE clause, or an injection that appends to one, from a cross-tenant leak
-- into an empty result. It does not contain an attacker who already has the
-- connection string and can issue arbitrary SQL. Separating those would need
-- a second database role for the unscoped paths, which is deployment work
-- rather than schema work, and is noted as the next step.
--
-- The default with no setting present is deny: `tenant_id = NULL` is not
-- true, so an unscoped read returns nothing rather than everything. Fail-open
-- would have been no control at all.

CREATE OR REPLACE FUNCTION zoiko_current_tenant()
RETURNS uuid
LANGUAGE sql
STABLE
AS $$
  SELECT nullif(current_setting('zoiko.tenant_id', true), '')::uuid
$$;

CREATE OR REPLACE FUNCTION zoiko_cross_tenant()
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT coalesce(current_setting('zoiko.cross_tenant', true), 'off') = 'on'
$$;

-- message, thread, commitment, ai_action, audit_event — plus the rows that
-- are part of a message rather than merely related to one.
DO $$
DECLARE
  target text;
BEGIN
  FOREACH target IN ARRAY ARRAY[
    'email_messages',
    'message_threads',
    'message_recipients',
    'message_attachments',
    'mailbox_messages',
    'commitments',
    'ai_actions',
    'audit_events'
  ]
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', target);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', target);
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', target || '_tenant_isolation', target);
    EXECUTE format(
      'CREATE POLICY %I ON %I USING (zoiko_cross_tenant() OR tenant_id = zoiko_current_tenant()) WITH CHECK (zoiko_cross_tenant() OR tenant_id = zoiko_current_tenant())',
      target || '_tenant_isolation',
      target
    );
  END LOOP;
END
$$;
