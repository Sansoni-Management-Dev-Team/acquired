-- REVIEW DRAFT ONLY. Not approved/applied. Startup must never execute this artifact.
-- Existing owned OrbStack 127.0.0.1:5446/communications_fixture ONLY.
-- System identifier7696118996713136162; service-only. No public/Acquire objects.
-- Requires approved standalone001/002 and final specifically approved proposed003.
BEGIN;
DO $$ BEGIN
 IF current_database()<>'communications_fixture' OR current_user<>'communications_fixture'
  OR (SELECT system_identifier::text FROM pg_control_system())<>'7696118996713136162'
  OR to_regclass('communications.history_refreshes') IS NOT NULL
  OR to_regclass('communications.connection_retirements') IS NULL
  OR to_regprocedure('communications.assert_account_retirement_open(text)') IS NULL THEN
  RAISE EXCEPTION 'Requires exact existing standalone target and retirement prerequisite';
 END IF;
 IF EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
  WHERE n.nspname='public' AND c.relkind IN ('r','p','v','m','f')) THEN
  RAISE EXCEPTION 'Standalone target must contain no application relations';
 END IF;
 IF (SELECT count(*) FROM pg_roles WHERE rolname IN ('communications_control','communications_scoped')
  AND NOT rolsuper AND NOT rolbypassrls AND NOT rolcanlogin)<>2 THEN
  RAISE EXCEPTION 'Restricted service roles required';
 END IF;
 IF (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='communications'
  AND c.relkind IN ('r','p') AND c.relrowsecurity AND c.relforcerowsecurity AND c.relname IN
  ('access_grants','physical_accounts','connections','connection_generations','event_cursors','events','event_outbox',
   'tenant_reply_barriers','reply_review_latches','connection_retirements'))<>10 THEN
  RAISE EXCEPTION 'Reviewed FORCE RLS storage prerequisites required';
 END IF;
END $$;
CREATE TABLE communications.history_initial_sync (
 application_id text NOT NULL,tenant_id text NOT NULL,owner_id text NOT NULL,
 connection_id text NOT NULL,generation integer NOT NULL,account_id text NOT NULL,
 webhook_inbox_id text NOT NULL REFERENCES communications.webhook_receipt_routes(webhook_inbox_id),
 completed_at timestamptz NOT NULL,
 encrypted_evidence text NOT NULL CHECK(length(encrypted_evidence) BETWEEN 1 AND 65536),
 key_version text NOT NULL CHECK(length(key_version) BETWEEN 1 AND 64),
 digest_key_version text NOT NULL CHECK(length(digest_key_version) BETWEEN 1 AND 64),
 PRIMARY KEY(connection_id,generation),
 FOREIGN KEY(connection_id,generation,application_id,tenant_id,owner_id,account_id)
 REFERENCES communications.connection_generations(connection_id,generation,application_id,tenant_id,owner_id,account_id)
);
-- Completed_at is authenticated webhook capture/observed completion time, not an invented vendor
-- event timestamp. Exact generation routing and retained receipt are immutable; no status-OK proof.
CREATE FUNCTION communications.protect_history_initial_sync() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,communications AS $$
BEGIN
 PERFORM communications.lock_reply_barrier(NEW.application_id,NEW.tenant_id);
 PERFORM communications.assert_account_retirement_open(NEW.account_id);
 IF NEW.completed_at>clock_timestamp() OR NOT EXISTS(
  SELECT 1 FROM communications.webhook_receipt_routes r JOIN communications.webhook_inbox w ON w.id=r.webhook_inbox_id
  WHERE r.webhook_inbox_id=NEW.webhook_inbox_id AND r.application_id=NEW.application_id AND r.tenant_id=NEW.tenant_id
   AND r.owner_id=NEW.owner_id AND r.connection_id=NEW.connection_id AND r.generation=NEW.generation AND r.account_id=NEW.account_id
   AND w.backend='unipile' AND w.authenticated_at<=clock_timestamp() AND w.received_at=NEW.completed_at
   AND w.state='processing' AND w.lease_until>clock_timestamp() AND w.expires_at>clock_timestamp()) THEN
  RAISE EXCEPTION 'Initial sync requires exact authenticated owned original receipt';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER communications_history_initial_sync_guard BEFORE INSERT ON communications.history_initial_sync
 FOR EACH ROW EXECUTE FUNCTION communications.protect_history_initial_sync();
ALTER TABLE communications.history_initial_sync ENABLE ROW LEVEL SECURITY;
ALTER TABLE communications.history_initial_sync FORCE ROW LEVEL SECURITY;
CREATE POLICY history_initial_sync_control ON communications.history_initial_sync TO communications_control USING(true) WITH CHECK(true);
CREATE POLICY history_initial_sync_scoped ON communications.history_initial_sync TO communications_scoped
 USING(communications.scope_authorized(application_id,tenant_id,owner_id));
REVOKE ALL ON communications.history_initial_sync FROM PUBLIC,communications_control,communications_scoped;
GRANT SELECT,INSERT ON communications.history_initial_sync TO communications_control;
GRANT SELECT ON communications.history_initial_sync TO communications_scoped;
REVOKE ALL ON FUNCTION communications.protect_history_initial_sync() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION communications.protect_history_initial_sync() TO communications_control;

CREATE TABLE communications.history_refreshes (
 application_id text NOT NULL,tenant_id text NOT NULL,owner_id text NOT NULL,
 connection_id text NOT NULL,generation integer NOT NULL,account_id text NOT NULL,
 scope_digest text NOT NULL CHECK(scope_digest~'^[0-9a-f]{64}$'),
 digest_key_version text NOT NULL CHECK(length(digest_key_version) BETWEEN 1 AND 64),
 token_hash text NOT NULL CHECK(token_hash~'^[0-9a-f]{64}$'),
 required_since timestamptz NOT NULL,capture_revision bigint NOT NULL CHECK(capture_revision>=0),
 started_at timestamptz NOT NULL DEFAULT clock_timestamp(),lease_until timestamptz NOT NULL,
 finished_at timestamptz,finished_revision bigint,
 PRIMARY KEY(connection_id,generation,scope_digest),
 FOREIGN KEY(connection_id,generation,application_id,tenant_id,owner_id,account_id)
 REFERENCES communications.connection_generations(connection_id,generation,application_id,tenant_id,owner_id,account_id),
 CHECK(required_since<=started_at),CHECK(lease_until>=started_at),
 CHECK((finished_at IS NULL)=(finished_revision IS NULL)),CHECK(finished_revision IS NULL OR finished_revision>=capture_revision),
 CHECK(finished_at IS NULL OR finished_at>=started_at)
);
CREATE FUNCTION communications.protect_history_refresh() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,communications AS $$
DECLARE c communications.connections%ROWTYPE;
BEGIN
 PERFORM communications.lock_reply_barrier(NEW.application_id,NEW.tenant_id);
 PERFORM communications.assert_account_retirement_open(NEW.account_id);
 SELECT * INTO STRICT c FROM communications.connections WHERE id=NEW.connection_id FOR SHARE;
 IF NOT c.active OR c.current_generation<>NEW.generation OR c.account_id<>NEW.account_id
  OR ROW(c.application_id,c.tenant_id,c.owner_id) IS DISTINCT FROM ROW(NEW.application_id,NEW.tenant_id,NEW.owner_id)
  OR NOT EXISTS(SELECT 1 FROM communications.access_grants WHERE application_id=NEW.application_id
   AND tenant_id=NEW.tenant_id AND owner_id=NEW.owner_id AND revoked_at IS NULL AND expires_at>clock_timestamp())
  OR NEW.started_at>clock_timestamp() THEN
  RAISE EXCEPTION 'History refresh requires current original authority';
 END IF;
 IF TG_OP='UPDATE' THEN
  IF ROW(NEW.application_id,NEW.tenant_id,NEW.owner_id,NEW.connection_id,NEW.generation,NEW.account_id,NEW.scope_digest,NEW.digest_key_version)
   IS DISTINCT FROM ROW(OLD.application_id,OLD.tenant_id,OLD.owner_id,OLD.connection_id,OLD.generation,OLD.account_id,OLD.scope_digest,OLD.digest_key_version)
   OR (NEW.token_hash<>OLD.token_hash AND (OLD.lease_until>clock_timestamp() OR NEW.started_at<OLD.started_at OR NEW.finished_at IS NOT NULL))
   OR (NEW.token_hash=OLD.token_hash AND ROW(NEW.required_since,NEW.capture_revision,NEW.started_at)
    IS DISTINCT FROM ROW(OLD.required_since,OLD.capture_revision,OLD.started_at)) THEN
   RAISE EXCEPTION 'History identity/active claim is immutable';
  END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER communications_history_refresh_guard BEFORE INSERT OR UPDATE ON communications.history_refreshes
 FOR EACH ROW EXECUTE FUNCTION communications.protect_history_refresh();
-- Rechecks natural access expiry at transaction precommit; never claims post-WAL authorization.
CREATE FUNCTION communications.history_refresh_commit_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,communications AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM communications.connections c JOIN communications.access_grants g
  ON g.application_id=c.application_id AND g.tenant_id=c.tenant_id AND g.owner_id=c.owner_id
  WHERE c.id=NEW.connection_id AND c.current_generation=NEW.generation AND c.account_id=NEW.account_id AND c.active
   AND g.revoked_at IS NULL AND g.expires_at>clock_timestamp()) THEN
  RAISE EXCEPTION 'History refresh authorization expired before commit';
 END IF;
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER communications_history_sync_commit AFTER INSERT ON communications.history_initial_sync
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION communications.history_refresh_commit_guard();
CREATE CONSTRAINT TRIGGER communications_history_refresh_commit AFTER INSERT OR UPDATE ON communications.history_refreshes
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION communications.history_refresh_commit_guard();
ALTER TABLE communications.history_refreshes ENABLE ROW LEVEL SECURITY;
ALTER TABLE communications.history_refreshes FORCE ROW LEVEL SECURITY;
CREATE POLICY history_refresh_control ON communications.history_refreshes TO communications_control USING(true) WITH CHECK(true);
CREATE POLICY history_refresh_scoped ON communications.history_refreshes TO communications_scoped
 USING(communications.scope_authorized(application_id,tenant_id,owner_id));
REVOKE ALL ON communications.history_refreshes FROM PUBLIC,communications_control,communications_scoped;
GRANT SELECT,INSERT,UPDATE ON communications.history_refreshes TO communications_control;
GRANT SELECT ON communications.history_refreshes TO communications_scoped;
REVOKE ALL ON FUNCTION communications.protect_history_refresh(),communications.history_refresh_commit_guard() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION communications.protect_history_refresh(),communications.history_refresh_commit_guard() TO communications_control;

-- Prevent accidental direct control UPDATE from publishing authorized complete coverage after expiry.
-- SQL metadata does not authenticate encrypted provider evidence; only the configured worker may
-- supply that evidence. EventCodec/cursor-AEAD verification remains a concrete repository duty.
CREATE FUNCTION communications.history_coverage_commit_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,communications AS $$
BEGIN
 IF NEW.complete THEN
  IF NOT NEW.initial_sync_complete OR NEW.invalidated OR NEW.encrypted_cursor IS NULL OR NEW.cursor_key_version IS NULL
   OR NEW.coverage_through>clock_timestamp() OR NEW.observed_at>clock_timestamp()
   OR NOT EXISTS(SELECT 1 FROM communications.history_refreshes h WHERE h.connection_id=NEW.connection_id
    AND h.generation=NEW.generation AND h.scope_digest=NEW.scope_digest
    AND h.application_id=NEW.application_id AND h.tenant_id=NEW.tenant_id AND h.owner_id=NEW.owner_id
    AND h.account_id=NEW.account_id AND h.required_since=NEW.coverage_from
    AND date_trunc('milliseconds',h.started_at)=NEW.coverage_through AND h.finished_at IS NOT NULL
    AND h.finished_at>=NEW.observed_at)
   OR NOT EXISTS(SELECT 1 FROM communications.connections c JOIN communications.access_grants g
    ON g.application_id=c.application_id AND g.tenant_id=c.tenant_id AND g.owner_id=c.owner_id
    WHERE c.id=NEW.connection_id AND c.current_generation=NEW.generation AND c.account_id=NEW.account_id AND c.active
    AND g.revoked_at IS NULL AND g.expires_at>clock_timestamp()) THEN
   RAISE EXCEPTION 'Complete history coverage lacks current finished original authorization';
  END IF;
 END IF;
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER communications_history_coverage_commit AFTER INSERT OR UPDATE ON communications.event_cursors
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION communications.history_coverage_commit_guard();
REVOKE ALL ON FUNCTION communications.history_coverage_commit_guard() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION communications.history_coverage_commit_guard() TO communications_control;

CREATE CONSTRAINT TRIGGER communications_history_alias_commit AFTER INSERT ON communications.identity_aliases
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW WHEN (NEW.namespace LIKE 'unipile.v1.history-peer.%')
 EXECUTE FUNCTION communications.history_refresh_commit_guard();

COMMIT;
