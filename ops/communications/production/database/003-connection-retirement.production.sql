-- PRODUCTION REVIEW ARTIFACT. UNAPPROVED / UNAPPLIED. Never executed by startup.
-- Target: acquire-app-01 (134.199.155.67), new isolated acquire_communications database only.
-- Operator: communications_admin; no provider actions, account import or send activation.
-- A freshly inspected system identifier must be separately approved and attested before execution.
BEGIN;
DO $production_target$
BEGIN
 IF current_database() <> 'acquire_communications'
 OR current_user <> 'communications_admin' OR session_user <> 'communications_admin'
 OR current_setting('acquire.deployment_target', true) IS DISTINCT FROM 'acquire-app-01/acquire_communications'
 OR coalesce(current_setting('acquire.expected_system_identifier', true),'') !~ '^[0-9]{19,20}$'
 OR (SELECT system_identifier::text FROM pg_catalog.pg_control_system()) IS DISTINCT FROM current_setting('acquire.expected_system_identifier', true) THEN
  RAISE EXCEPTION 'Exact production target and fresh operator system-identifier attestation required';
 END IF;
END $production_target$;
-- BEGIN ORIGINAL PREREQUISITE GUARD
DO $$ BEGIN
  IF current_database() <> 'acquire_communications' OR current_user <> 'communications_admin'
     OR (SELECT system_identifier::text FROM pg_control_system()) <> current_setting('acquire.expected_system_identifier', true)
     OR to_regclass('communications.connection_generations') IS NULL
     OR to_regclass('communications.tenant_reply_barriers') IS NULL
     OR to_regclass('communications.connection_retirements') IS NOT NULL THEN
    RAISE EXCEPTION 'Requires exact existing standalone service target and unapplied retirement schema';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relkind IN ('r','p','v','m','f')) THEN
    RAISE EXCEPTION 'Standalone target must contain no application relations';
  END IF;
  IF (SELECT count(*) FROM pg_roles WHERE rolname IN ('communications_control','communications_scoped')
      AND NOT rolsuper AND NOT rolbypassrls AND NOT rolcanlogin) <> 2 THEN
    RAISE EXCEPTION 'Requires both reviewed restricted service roles';
  END IF;
  IF (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='communications'
      AND c.relkind IN ('r','p') AND c.relrowsecurity AND c.relforcerowsecurity AND c.relname IN (
        'access_grants','physical_accounts','connections','connection_generations','operation_journal','account_leases',
        'quota_buckets','auth_states','identity_aliases','event_cursors','webhook_inbox','events','event_outbox',
        'tenant_reply_barriers','webhook_receipt_routes','reply_review_latches')) <> 16 THEN
    RAISE EXCEPTION 'Requires complete reviewed FORCE RLS baseline';
  END IF;
END $$;

CREATE TABLE communications.connection_retirements (
  id text PRIMARY KEY CHECK (id ~ '^[0-9a-f]{64}$'),
  application_id text NOT NULL, tenant_id text NOT NULL, owner_id text NOT NULL,
  connection_id text NOT NULL, generation integer NOT NULL, account_id text NOT NULL,
  channel text NOT NULL, platform text NOT NULL, backend text NOT NULL CHECK (backend='unipile'),
  operation_key text NOT NULL CHECK (length(operation_key) BETWEEN 1 AND 200),
  record_fingerprint text NOT NULL CHECK (record_fingerprint ~ '^[0-9a-f]{64}$'),
  fingerprint_key_version text NOT NULL CHECK (length(fingerprint_key_version) BETWEEN 1 AND 64),
  encrypted_record text NOT NULL CHECK (length(encrypted_record) BETWEEN 1 AND 65536),
  record_key_version text NOT NULL CHECK (length(record_key_version) BETWEEN 1 AND 64),
  token_hash text NOT NULL CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  state text NOT NULL DEFAULT 'pending' CHECK (state IN ('pending','unknown','rejected','disconnected')),
  prepared_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  finished_at timestamptz,
  encrypted_outcome text CHECK (length(encrypted_outcome) BETWEEN 1 AND 4096),
  outcome_key_version text CHECK (length(outcome_key_version) BETWEEN 1 AND 64),
  UNIQUE(application_id,tenant_id,owner_id,operation_key),
  FOREIGN KEY(connection_id,generation,application_id,tenant_id,owner_id,account_id)
    REFERENCES communications.connection_generations(connection_id,generation,application_id,tenant_id,owner_id,account_id),
  FOREIGN KEY(connection_id,generation,application_id,tenant_id,owner_id,channel,platform,backend)
    REFERENCES communications.connection_generations(connection_id,generation,application_id,tenant_id,owner_id,channel,platform,backend),
  CHECK ((state='pending' AND finished_at IS NULL AND encrypted_outcome IS NULL AND outcome_key_version IS NULL)
    OR (state<>'pending' AND finished_at IS NOT NULL AND finished_at>=prepared_at AND encrypted_outcome IS NOT NULL AND outcome_key_version IS NOT NULL))
);
CREATE UNIQUE INDEX communications_retirement_account_open ON communications.connection_retirements(account_id) WHERE state<>'disconnected';

-- All writers must lock tenant barrier first, then physical account before target rows.
-- BEFORE row triggers cannot reverse a row lock already taken by an uncoordinated writer;
-- such conflicts can deadlock and MUST fail boundedly, never authorize provider work.
CREATE FUNCTION communications.assert_account_retirement_open(physical text) RETURNS void
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,communications AS $$
BEGIN
  PERFORM 1 FROM communications.physical_accounts WHERE id=physical FOR UPDATE;
  IF NOT FOUND OR EXISTS(SELECT 1 FROM communications.connection_retirements WHERE account_id=physical AND state<>'disconnected') THEN
    RAISE EXCEPTION 'Physical account has an unresolved retirement intent';
  END IF;
END $$;

CREATE FUNCTION communications.protect_retirement() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,communications AS $$
DECLARE c communications.connections%ROWTYPE;
BEGIN
  IF TG_OP='UPDATE' THEN
    IF ROW(NEW.id,NEW.application_id,NEW.tenant_id,NEW.owner_id,NEW.connection_id,NEW.generation,NEW.account_id,NEW.channel,NEW.platform,NEW.backend,
      NEW.operation_key,NEW.record_fingerprint,NEW.fingerprint_key_version,NEW.encrypted_record,NEW.record_key_version,NEW.token_hash,NEW.prepared_at)
      IS DISTINCT FROM ROW(OLD.id,OLD.application_id,OLD.tenant_id,OLD.owner_id,OLD.connection_id,OLD.generation,OLD.account_id,OLD.channel,OLD.platform,OLD.backend,
      OLD.operation_key,OLD.record_fingerprint,OLD.fingerprint_key_version,OLD.encrypted_record,OLD.record_key_version,OLD.token_hash,OLD.prepared_at)
      OR OLD.state<>'pending' OR NEW.state NOT IN ('unknown','rejected','disconnected') THEN
      RAISE EXCEPTION 'Retirement identity and terminal outcome are immutable';
    END IF;
    RETURN NEW;
  END IF;
  PERFORM communications.lock_reply_barrier(NEW.application_id,NEW.tenant_id);
  PERFORM communications.assert_account_retirement_open(NEW.account_id);
  SELECT * INTO STRICT c FROM communications.connections WHERE id=NEW.connection_id FOR UPDATE;
  IF NOT c.active OR c.current_generation<>NEW.generation OR c.account_id<>NEW.account_id
    OR ROW(c.application_id,c.tenant_id,c.owner_id,c.channel,c.platform,c.backend) IS DISTINCT FROM
       ROW(NEW.application_id,NEW.tenant_id,NEW.owner_id,NEW.channel,NEW.platform,NEW.backend)
    OR (c.status_observed_at IS NOT NULL AND c.status_observed_at>clock_timestamp())
    OR NEW.state<>'pending' OR NEW.prepared_at>clock_timestamp()
    OR EXISTS(SELECT 1 FROM communications.connection_retirements WHERE connection_id=NEW.connection_id AND generation=NEW.generation)
    OR NOT EXISTS(SELECT 1 FROM communications.access_grants WHERE application_id=NEW.application_id AND tenant_id=NEW.tenant_id AND owner_id=NEW.owner_id AND revoked_at IS NULL AND expires_at>clock_timestamp())
    OR EXISTS(SELECT 1 FROM communications.connections WHERE account_id=NEW.account_id AND id<>NEW.connection_id AND active)
    OR EXISTS(SELECT 1 FROM communications.operation_journal WHERE account_id=NEW.account_id AND state IN ('claimed','dispatching','unknown'))
    OR EXISTS(SELECT 1 FROM communications.account_leases WHERE account_id=NEW.account_id AND expires_at>clock_timestamp())
    OR EXISTS(SELECT 1 FROM communications.auth_states a LEFT JOIN communications.connection_generations g ON g.connection_id=a.reconnect_connection_id AND g.generation=a.reconnect_generation
      WHERE a.consumed_at IS NULL AND a.expires_at>clock_timestamp() AND
        ((a.application_id=NEW.application_id AND a.tenant_id=NEW.tenant_id AND a.owner_id=NEW.owner_id AND a.channel=NEW.channel) OR g.account_id=NEW.account_id)) THEN
    RAISE EXCEPTION 'Current exclusive account authority and settled work are required for retirement';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER communications_retirement_guard BEFORE INSERT OR UPDATE ON communications.connection_retirements FOR EACH ROW EXECUTE FUNCTION communications.protect_retirement();
CREATE TRIGGER communications_retirement_delete_guard BEFORE DELETE ON communications.connection_retirements FOR EACH ROW EXECUTE FUNCTION communications.reject_mutation();

CREATE FUNCTION communications.apply_retirement() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,communications AS $$
BEGIN
  UPDATE communications.connections SET active=false,status='disconnected',status_observed_at=clock_timestamp()
    WHERE id=NEW.connection_id AND current_generation=NEW.generation AND account_id=NEW.account_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Retirement did not deactivate original current generation'; END IF;
  UPDATE communications.event_cursors SET invalidated=true,complete=false,initial_sync_complete=false,lease_token=NULL,lease_until=NULL WHERE account_id=NEW.account_id;
  PERFORM communications.advance_reply_barrier(NEW.application_id,NEW.tenant_id);
  RETURN NEW;
END $$;
CREATE TRIGGER communications_retirement_apply AFTER INSERT ON communications.connection_retirements FOR EACH ROW EXECUTE FUNCTION communications.apply_retirement();

-- Natural grant expiry cannot be locked away. Recheck at the deferred precommit
-- authorization linearization point, after all retirement/cursor/outcome writes.
CREATE FUNCTION communications.guard_retirement_commit() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,communications AS $$
DECLARE expires timestamptz; revoked timestamptz;
BEGIN
  PERFORM communications.lock_reply_barrier(NEW.application_id,NEW.tenant_id);
  PERFORM 1 FROM communications.physical_accounts WHERE id=NEW.account_id AND verified_at IS NOT NULL AND verified_at<=clock_timestamp() FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Verified original physical account required at retirement commit'; END IF;
  PERFORM 1 FROM communications.connections WHERE id=NEW.connection_id AND current_generation=NEW.generation AND account_id=NEW.account_id
    AND application_id=NEW.application_id AND tenant_id=NEW.tenant_id AND owner_id=NEW.owner_id AND channel=NEW.channel AND platform=NEW.platform AND backend=NEW.backend
    AND NOT active AND status='disconnected' FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Original current retired generation required at commit'; END IF;
  SELECT expires_at,revoked_at INTO expires,revoked FROM communications.access_grants
    WHERE application_id=NEW.application_id AND tenant_id=NEW.tenant_id AND owner_id=NEW.owner_id FOR SHARE;
  IF NOT FOUND OR revoked IS NOT NULL OR expires<=clock_timestamp() THEN
    RAISE EXCEPTION 'Current retirement grant expired before commit';
  END IF;
  RETURN NEW;
END $$;
CREATE CONSTRAINT TRIGGER communications_retirement_commit AFTER INSERT OR UPDATE ON communications.connection_retirements
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION communications.guard_retirement_commit();

CREATE FUNCTION communications.guard_retiring_connection() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,communications AS $$
BEGIN
  PERFORM 1 FROM communications.physical_accounts WHERE id=NEW.account_id FOR UPDATE;
  IF TG_OP='UPDATE' AND (NEW.current_generation<>OLD.current_generation OR NEW.account_id<>OLD.account_id) THEN
    PERFORM communications.assert_account_retirement_open(OLD.account_id);
  END IF;
  IF TG_OP='INSERT' OR NEW.active OR (TG_OP='UPDATE' AND (NEW.current_generation<>OLD.current_generation OR NEW.account_id<>OLD.account_id)) THEN
    PERFORM communications.assert_account_retirement_open(NEW.account_id);
  END IF;
  IF EXISTS(SELECT 1 FROM communications.connection_retirements WHERE connection_id=NEW.id AND generation=NEW.current_generation)
    AND (NEW.active OR NEW.status<>'disconnected') THEN
    RAISE EXCEPTION 'A retired generation cannot reactivate or change status';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER communications_retiring_connection BEFORE INSERT OR UPDATE ON communications.connections FOR EACH ROW EXECUTE FUNCTION communications.guard_retiring_connection();

CREATE FUNCTION communications.guard_retiring_generation() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,communications AS $$
BEGIN
  PERFORM communications.assert_account_retirement_open(NEW.account_id);
  RETURN NEW;
END $$;
CREATE TRIGGER communications_retiring_generation BEFORE INSERT ON communications.connection_generations FOR EACH ROW EXECUTE FUNCTION communications.guard_retiring_generation();

CREATE FUNCTION communications.guard_retiring_account_write() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,communications AS $$
BEGIN
  IF TG_TABLE_NAME='operation_journal' THEN
    IF TG_OP='INSERT' OR (NEW.state='dispatching' AND OLD.state<>'dispatching') OR (NEW.quota_reserved AND NOT OLD.quota_reserved) THEN
      PERFORM communications.assert_account_retirement_open(NEW.account_id);
    END IF;
  ELSE
    PERFORM communications.assert_account_retirement_open(NEW.account_id);
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER communications_retiring_lease BEFORE INSERT OR UPDATE ON communications.account_leases FOR EACH ROW EXECUTE FUNCTION communications.guard_retiring_account_write();
CREATE TRIGGER communications_retiring_quota BEFORE INSERT OR UPDATE ON communications.quota_buckets FOR EACH ROW EXECUTE FUNCTION communications.guard_retiring_account_write();
CREATE TRIGGER communications_retiring_operation BEFORE INSERT OR UPDATE ON communications.operation_journal FOR EACH ROW EXECUTE FUNCTION communications.guard_retiring_account_write();

CREATE FUNCTION communications.guard_retiring_auth() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,communications AS $$
DECLARE physical text;
BEGIN
  PERFORM communications.lock_reply_barrier(NEW.application_id,NEW.tenant_id);
  IF NEW.reconnect_connection_id IS NOT NULL THEN
    SELECT account_id INTO STRICT physical FROM communications.connection_generations WHERE connection_id=NEW.reconnect_connection_id AND generation=NEW.reconnect_generation;
    PERFORM communications.assert_account_retirement_open(physical);
    IF EXISTS(SELECT 1 FROM communications.connection_retirements WHERE connection_id=NEW.reconnect_connection_id AND generation=NEW.reconnect_generation) THEN
      RAISE EXCEPTION 'A retired generation cannot reconnect; explicit new setup is required';
    END IF;
  END IF;
  IF EXISTS(SELECT 1 FROM communications.connection_retirements WHERE application_id=NEW.application_id AND tenant_id=NEW.tenant_id AND owner_id=NEW.owner_id AND channel=NEW.channel AND state<>'disconnected') THEN
    RAISE EXCEPTION 'Unresolved owner/channel retirement prevents new authentication';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER communications_retiring_auth BEFORE INSERT OR UPDATE ON communications.auth_states FOR EACH ROW EXECUTE FUNCTION communications.guard_retiring_auth();

CREATE FUNCTION communications.guard_retiring_cursor() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,communications AS $$
BEGIN
  PERFORM 1 FROM communications.physical_accounts WHERE id=NEW.account_id FOR UPDATE;
  IF (EXISTS(SELECT 1 FROM communications.connection_retirements WHERE account_id=NEW.account_id AND state<>'disconnected') OR
      EXISTS(SELECT 1 FROM communications.connection_retirements WHERE connection_id=NEW.connection_id AND generation=NEW.generation))
    AND (NOT NEW.invalidated OR NEW.complete OR NEW.initial_sync_complete OR NEW.lease_token IS NOT NULL OR NEW.lease_until IS NOT NULL) THEN
    RAISE EXCEPTION 'Retirement invalidates cursor coverage and leases';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER communications_retiring_cursor BEFORE INSERT OR UPDATE ON communications.event_cursors FOR EACH ROW EXECUTE FUNCTION communications.guard_retiring_cursor();

CREATE FUNCTION communications.guard_retiring_alias() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,communications AS $$
BEGIN
  PERFORM communications.assert_account_retirement_open(NEW.account_id);
  IF EXISTS(SELECT 1 FROM communications.connection_retirements WHERE connection_id=NEW.connection_id AND generation=NEW.generation) THEN
    RAISE EXCEPTION 'A retired generation cannot establish new aliases';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER communications_retiring_alias BEFORE INSERT ON communications.identity_aliases FOR EACH ROW EXECUTE FUNCTION communications.guard_retiring_alias();

-- Control-only writers can see global physical fences; scoped RLS must not hide another owner's intent.
REVOKE INSERT,UPDATE ON communications.auth_states,communications.event_cursors FROM communications_scoped;
REVOKE INSERT ON communications.identity_aliases FROM communications_scoped;
ALTER TABLE communications.connection_retirements ENABLE ROW LEVEL SECURITY;
ALTER TABLE communications.connection_retirements FORCE ROW LEVEL SECURITY;
CREATE POLICY connection_retirements_control ON communications.connection_retirements TO communications_control USING(true) WITH CHECK(true);
CREATE POLICY connection_retirements_scope ON communications.connection_retirements FOR SELECT TO communications_scoped USING(communications.scope_authorized(application_id,tenant_id,owner_id));
GRANT SELECT,INSERT,UPDATE ON communications.connection_retirements TO communications_control;
GRANT SELECT ON communications.connection_retirements TO communications_scoped;
REVOKE DELETE ON communications.connection_retirements FROM communications_control,communications_scoped;
REVOKE ALL ON FUNCTION communications.assert_account_retirement_open(text),communications.protect_retirement(),communications.apply_retirement(),communications.guard_retirement_commit(),communications.guard_retiring_connection(),communications.guard_retiring_generation(),communications.guard_retiring_account_write(),communications.guard_retiring_auth(),communications.guard_retiring_cursor(),communications.guard_retiring_alias() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION communications.assert_account_retirement_open(text),communications.protect_retirement(),communications.apply_retirement(),communications.guard_retirement_commit(),communications.guard_retiring_connection(),communications.guard_retiring_generation(),communications.guard_retiring_account_write(),communications.guard_retiring_auth(),communications.guard_retiring_cursor(),communications.guard_retiring_alias() TO communications_control;
COMMIT;
