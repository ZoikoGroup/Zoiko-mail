-- Make audit_events append-only at the database, not in application code.
--
-- Why at this layer: an audit log that the application can edit is not
-- evidence. Before this migration a plain `UPDATE audit_events SET
-- event_type = '...'` succeeded, so any bug, console session or compromised
-- credential could rewrite history. Application-level guards cannot close
-- that because they are bypassed by definition whenever something goes wrong.
--
-- The one legitimate DELETE is the cascade from `tenant`, which fires when a
-- confirmed tenant deletion runs. That path opts in explicitly by setting
-- `zoiko.audit_purge` inside its own transaction, so a targeted "delete the
-- one row that incriminates me" is still refused while the receipted,
-- counted, whole-tenant erase continues to work.

CREATE OR REPLACE FUNCTION audit_events_reject_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  -- SET LOCAL scopes the opt-in to a single transaction, so it cannot leak
  -- to the next request on a pooled connection.
  IF TG_OP = 'DELETE'
     AND coalesce(current_setting('zoiko.audit_purge', true), 'off') = 'on'
  THEN
    RETURN OLD;
  END IF;

  RAISE EXCEPTION
    'audit_events is append-only; % is not permitted', TG_OP
    USING ERRCODE = '42501';
END;
$$;

DROP TRIGGER IF EXISTS audit_events_no_update ON audit_events;
CREATE TRIGGER audit_events_no_update
  BEFORE UPDATE ON audit_events
  FOR EACH ROW
  EXECUTE FUNCTION audit_events_reject_mutation();

DROP TRIGGER IF EXISTS audit_events_no_delete ON audit_events;
CREATE TRIGGER audit_events_no_delete
  BEFORE DELETE ON audit_events
  FOR EACH ROW
  EXECUTE FUNCTION audit_events_reject_mutation();

-- TRUNCATE bypasses row-level triggers entirely, so it needs its own
-- statement-level guard. There is no legitimate TRUNCATE of this table.
DROP TRIGGER IF EXISTS audit_events_no_truncate ON audit_events;
CREATE TRIGGER audit_events_no_truncate
  BEFORE TRUNCATE ON audit_events
  FOR EACH STATEMENT
  EXECUTE FUNCTION audit_events_reject_mutation();
