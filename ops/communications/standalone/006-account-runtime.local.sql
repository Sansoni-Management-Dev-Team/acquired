-- PROVISIONAL REVIEW ARTIFACT. UNAPPROVED / UNAPPLIED. No runtime executes DDL.
-- Existing OrbStack 127.0.0.1:5446/communications_fixture, system ID 7696118996713136162.
-- Requires approved001/002 and separately proposed003/004. No Acquire relations or account backfill.
BEGIN;
DO $$ BEGIN
 IF current_user<>'communications_fixture' OR current_database()<>'communications_fixture' OR
 (SELECT system_identifier::text FROM pg_catalog.pg_control_system())<>'7696118996713136162' THEN
  RAISE EXCEPTION 'Requires exact standalone fixture'; END IF;
 IF EXISTS(SELECT 1 FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname='public' AND c.relkind IN('r','p','v','m','f')) THEN RAISE EXCEPTION 'Public application relations forbidden'; END IF;
 IF (SELECT count(*) FROM pg_catalog.pg_roles WHERE rolname IN('communications_control','communications_scoped')
 AND NOT rolsuper AND NOT rolbypassrls AND NOT rolcanlogin)<>2 THEN RAISE EXCEPTION 'Restricted service roles required'; END IF;
 IF (SELECT count(*) FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname='communications' AND c.relkind='r' AND c.relrowsecurity AND c.relforcerowsecurity
 AND c.relname IN('access_grants','physical_accounts','connections','connection_generations','operation_journal',
 'account_leases','quota_buckets','auth_states','identity_aliases','event_cursors','webhook_inbox','events','event_outbox',
 'tenant_reply_barriers','webhook_receipt_routes','reply_review_latches','connection_retirements',
 'email_tracking_acknowledgements','email_tracking_associations'))<>19 THEN RAISE EXCEPTION 'Exact service prerequisites required'; END IF;
 IF to_regprocedure('communications.lock_reply_barrier(text,text)') IS NULL OR
 to_regclass('communications.account_runtime_metadata') IS NOT NULL OR to_regclass('communications.connection_defaults') IS NOT NULL OR
 to_regclass('communications.setup_notification_inbox') IS NOT NULL OR to_regclass('communications.provider_webhook_spool') IS NOT NULL THEN RAISE EXCEPTION 'Runtime schema must be absent with tenant fence present'; END IF;
END $$;
CREATE TABLE communications.account_runtime_metadata(
 connection_id text NOT NULL,generation integer NOT NULL CHECK(generation>0),
 encrypted_metadata text NOT NULL CHECK(length(encrypted_metadata) BETWEEN 1 AND 2200000),
 metadata_key_version text NOT NULL CHECK(length(metadata_key_version) BETWEEN 1 AND 64),
 metadata_digest text NOT NULL CHECK(metadata_digest~'^[a-f0-9]{64}$'),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(connection_id,generation),FOREIGN KEY(connection_id,generation) REFERENCES communications.connection_generations
);
CREATE TABLE communications.connection_defaults(
 application_id text NOT NULL,tenant_id text NOT NULL,owner_id text NOT NULL,
 channel text NOT NULL CHECK(channel IN('email','whatsapp','linkedin')),connection_id text NOT NULL,generation integer NOT NULL CHECK(generation>0),
 updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(application_id,tenant_id,owner_id,channel),
 FOREIGN KEY(application_id,tenant_id,owner_id) REFERENCES communications.access_grants,
 FOREIGN KEY(connection_id,generation,application_id,tenant_id,owner_id) REFERENCES communications.connection_generations(connection_id,generation,application_id,tenant_id,owner_id)
);
CREATE TABLE communications.setup_notification_inbox(
 state_digest text PRIMARY KEY REFERENCES communications.auth_states(state_digest),
 encrypted_notification text NOT NULL CHECK(length(encrypted_notification) BETWEEN 1 AND 2200000),
 key_version text NOT NULL CHECK(length(key_version) BETWEEN 1 AND 64),payload_digest text NOT NULL CHECK(payload_digest~'^[a-f0-9]{64}$'),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),processed_at timestamptz,
 CHECK(processed_at IS NULL OR processed_at>=created_at)
);
CREATE TABLE communications.provider_webhook_spool(
 id text PRIMARY KEY CHECK(id~'^[a-f0-9]{64}$'),
 integration_id text NOT NULL CHECK(length(integration_id) BETWEEN 1 AND 200),
 provider_configuration_reference text NOT NULL CHECK(length(provider_configuration_reference) BETWEEN 1 AND 2000),
 provider_account_digests text[] NOT NULL CHECK(cardinality(provider_account_digests) BETWEEN 1 AND 32 AND array_position(provider_account_digests,NULL) IS NULL AND array_to_string(provider_account_digests,',')~'^[a-f0-9]{64}(,[a-f0-9]{64})*$'),
 encrypted_receipt text NOT NULL CHECK(length(encrypted_receipt) BETWEEN 1 AND 500000),
 key_version text NOT NULL CHECK(length(key_version) BETWEEN 1 AND 64),payload_digest text NOT NULL CHECK(payload_digest~'^[a-f0-9]{64}$'),
 received_at timestamptz NOT NULL,expires_at timestamptz NOT NULL,
 state text NOT NULL DEFAULT 'pending' CHECK(state IN('pending','processing','routed','review')),
 claim_token text CHECK(claim_token~'^[A-Za-z0-9_-]{43}$'),claim_until timestamptz,retry_at timestamptz,
 bound_connection_id text,bound_generation integer,scoped_receipt_key text REFERENCES communications.webhook_inbox(id),
 FOREIGN KEY(bound_connection_id,bound_generation) REFERENCES communications.connection_generations,
 CHECK(expires_at>received_at AND expires_at<=received_at+interval '24 hours'),
 CHECK((bound_connection_id IS NULL)=(bound_generation IS NULL)),
 CHECK((state='processing')=(claim_token IS NOT NULL AND claim_until IS NOT NULL)),
 CHECK(claim_until IS NULL OR claim_until<=expires_at),
 CHECK((state='routed')=(scoped_receipt_key IS NOT NULL)),CHECK(state<>'routed' OR bound_connection_id IS NOT NULL)
);
CREATE INDEX communications_provider_spool_work ON communications.provider_webhook_spool(integration_id,provider_configuration_reference,state,received_at);
-- An authenticated integration receipt is passive evidence, not owner authority. Pinning uses only
-- recorded provider digests/current generations, never account/tenant/owner fields from the body.
CREATE FUNCTION communications.guard_provider_webhook_spool() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $$
DECLARE g communications.connection_generations%ROWTYPE; matches integer;
BEGIN
 IF current_user<>'communications_control' OR TG_OP='DELETE' THEN RAISE EXCEPTION 'Retained restricted provider receipt required'; END IF;
 IF TG_OP='INSERT' THEN
  IF NEW.state<>'pending' OR NEW.claim_token IS NOT NULL OR NEW.scoped_receipt_key IS NOT NULL OR NEW.bound_connection_id IS NOT NULL OR NEW.received_at>clock_timestamp() THEN RAISE EXCEPTION 'Only original passive capture permitted'; END IF;
  SELECT count(*) INTO matches FROM communications.connections c JOIN communications.connection_generations v ON v.connection_id=c.id AND v.generation=c.current_generation
   WHERE c.active AND v.backend='unipile' AND v.provider_api_version='v1' AND v.authority='service' AND v.integration_id=NEW.integration_id AND v.provider_configuration_reference=NEW.provider_configuration_reference AND v.provider_account_digest=ANY(NEW.provider_account_digests);
  IF matches>1 THEN RAISE EXCEPTION 'Ambiguous provider ownership'; END IF;
  IF matches=1 THEN
   SELECT v.* INTO g FROM communications.connections c JOIN communications.connection_generations v ON v.connection_id=c.id AND v.generation=c.current_generation
    WHERE c.active AND v.backend='unipile' AND v.provider_api_version='v1' AND v.authority='service' AND v.integration_id=NEW.integration_id AND v.provider_configuration_reference=NEW.provider_configuration_reference AND v.provider_account_digest=ANY(NEW.provider_account_digests);
   PERFORM communications.lock_reply_barrier(g.application_id,g.tenant_id);
   PERFORM 1 FROM communications.connections c WHERE c.id=g.connection_id AND c.current_generation=g.generation AND c.active FOR SHARE;
   IF NOT FOUND THEN RAISE EXCEPTION 'Provider binding changed'; END IF;
   NEW.bound_connection_id:=g.connection_id;NEW.bound_generation:=g.generation;
   UPDATE communications.event_cursors SET invalidated=true,complete=false,lease_token=NULL,lease_until=NULL WHERE connection_id=g.connection_id AND generation=g.generation;
   PERFORM communications.advance_reply_barrier(g.application_id,g.tenant_id);
  END IF;
 ELSE
  IF (to_jsonb(NEW)-ARRAY['state','claim_token','claim_until','retry_at','bound_connection_id','bound_generation','scoped_receipt_key']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['state','claim_token','claim_until','retry_at','bound_connection_id','bound_generation','scoped_receipt_key']) OR OLD.state IN('routed','review') THEN RAISE EXCEPTION 'Provider receipt history immutable'; END IF;
  IF OLD.bound_connection_id IS NOT NULL AND ROW(NEW.bound_connection_id,NEW.bound_generation) IS DISTINCT FROM ROW(OLD.bound_connection_id,OLD.bound_generation) THEN RAISE EXCEPTION 'Original generation pin immutable'; END IF;
  IF NEW.bound_connection_id IS NOT NULL THEN
   SELECT * INTO g FROM communications.connection_generations WHERE connection_id=NEW.bound_connection_id AND generation=NEW.bound_generation;
   IF NOT FOUND OR g.backend<>'unipile' OR g.provider_api_version<>'v1' OR g.authority<>'service' OR g.integration_id<>NEW.integration_id OR g.provider_configuration_reference<>NEW.provider_configuration_reference OR NOT(g.provider_account_digest=ANY(NEW.provider_account_digests)) THEN RAISE EXCEPTION 'Original verified provider generation required'; END IF;
  END IF;
  IF OLD.bound_connection_id IS NULL AND NEW.bound_connection_id IS NOT NULL THEN
   PERFORM communications.lock_reply_barrier(g.application_id,g.tenant_id);
   UPDATE communications.event_cursors SET invalidated=true,complete=false,lease_token=NULL,lease_until=NULL WHERE connection_id=g.connection_id AND generation=g.generation;
   PERFORM communications.advance_reply_barrier(g.application_id,g.tenant_id);
  END IF;
  IF OLD.bound_connection_id IS NULL AND NEW.bound_connection_id IS NOT NULL AND ROW(NEW.state,NEW.claim_token,NEW.claim_until,NEW.retry_at,NEW.scoped_receipt_key) IS NOT DISTINCT FROM ROW(OLD.state,OLD.claim_token,OLD.claim_until,OLD.retry_at,OLD.scoped_receipt_key) THEN RETURN NEW; END IF;
  IF NEW.state='routed' THEN
   PERFORM communications.lock_reply_barrier(g.application_id,g.tenant_id);
   IF OLD.state<>'processing' OR OLD.claim_until<=clock_timestamp() OR OLD.expires_at<=clock_timestamp() OR NOT EXISTS(SELECT 1 FROM communications.webhook_receipt_routes r WHERE r.webhook_inbox_id=NEW.scoped_receipt_key AND r.connection_id=g.connection_id AND r.generation=g.generation AND r.application_id=g.application_id AND r.tenant_id=g.tenant_id AND r.owner_id=g.owner_id AND r.account_id=g.account_id) THEN RAISE EXCEPTION 'Exact durable scoped receipt required'; END IF;
   PERFORM communications.advance_reply_barrier(g.application_id,g.tenant_id);
  ELSIF NEW.state='review' THEN
   IF OLD.expires_at>clock_timestamp() THEN RAISE EXCEPTION 'Only expired receipt becomes unresolved review'; END IF;
  ELSIF NEW.state='processing' THEN
   IF OLD.state='processing' AND OLD.claim_until>clock_timestamp() OR NEW.claim_until<=clock_timestamp() OR NEW.expires_at<=clock_timestamp() THEN RAISE EXCEPTION 'Exact expiring receipt lease required'; END IF;
  ELSIF NEW.state='pending' THEN
   IF OLD.state<>'processing' OR OLD.claim_until<=clock_timestamp() OR OLD.expires_at<=clock_timestamp() THEN RAISE EXCEPTION 'Only current worker may defer'; END IF;
  END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER communications_provider_spool_guard BEFORE INSERT OR UPDATE OR DELETE ON communications.provider_webhook_spool FOR EACH ROW EXECUTE FUNCTION communications.guard_provider_webhook_spool();
CREATE FUNCTION communications.guard_provider_spool_account_work() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $$
DECLARE aid text;
BEGIN
 IF TG_TABLE_NAME='operation_journal' AND NEW.state<>'dispatching' THEN RETURN NEW; END IF;
 aid:=NEW.account_id;
 IF EXISTS(SELECT 1 FROM communications.provider_webhook_spool w JOIN communications.connection_generations g ON g.connection_id=w.bound_connection_id AND g.generation=w.bound_generation WHERE g.account_id=aid AND w.state<>'routed') THEN RAISE EXCEPTION 'Pending provider evidence blocks account mutation'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER communications_00_provider_spool_dispatch_guard BEFORE UPDATE ON communications.operation_journal FOR EACH ROW EXECUTE FUNCTION communications.guard_provider_spool_account_work();
CREATE TRIGGER communications_00_provider_spool_generation_guard BEFORE INSERT ON communications.connection_generations FOR EACH ROW EXECUTE FUNCTION communications.guard_provider_spool_account_work();
CREATE TRIGGER communications_00_provider_spool_retirement_guard BEFORE INSERT ON communications.connection_retirements FOR EACH ROW EXECUTE FUNCTION communications.guard_provider_spool_account_work();
ALTER TABLE communications.provider_webhook_spool ENABLE ROW LEVEL SECURITY;
ALTER TABLE communications.provider_webhook_spool FORCE ROW LEVEL SECURITY;
CREATE POLICY provider_webhook_control ON communications.provider_webhook_spool TO communications_control USING(true) WITH CHECK(true);
REVOKE ALL ON communications.provider_webhook_spool FROM PUBLIC;
REVOKE ALL ON FUNCTION communications.guard_provider_webhook_spool(),communications.guard_provider_spool_account_work() FROM PUBLIC;
GRANT SELECT,INSERT,UPDATE ON communications.provider_webhook_spool TO communications_control;
-- Provider/callback authentication and encrypted canonical identity validation are concrete runtime
-- responsibilities. SQL cannot treat account_id/name JSON or ciphertext as independent owner proof.
CREATE FUNCTION communications.guard_account_runtime() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $$
DECLARE g communications.connection_generations%ROWTYPE;c communications.connections%ROWTYPE;
BEGIN
 IF current_user<>'communications_control' OR TG_OP='DELETE' THEN RAISE EXCEPTION 'Restricted retained runtime history required'; END IF;
 IF TG_TABLE_NAME='setup_notification_inbox' THEN
  IF TG_OP='INSERT' THEN
   PERFORM 1 FROM communications.auth_states WHERE state_digest=NEW.state_digest AND backend='unipile' AND expires_at>clock_timestamp() FOR SHARE;
   IF NOT FOUND OR NEW.processed_at IS NOT NULL THEN RAISE EXCEPTION 'Original unexpired setup state required'; END IF;
  ELSE
   IF (to_jsonb(NEW)-'processed_at')<>(to_jsonb(OLD)-'processed_at') OR OLD.processed_at IS NOT NULL OR NEW.processed_at IS NULL OR
    NOT EXISTS(SELECT 1 FROM communications.auth_states WHERE state_digest=NEW.state_digest AND consumed_at IS NOT NULL) THEN
    RAISE EXCEPTION 'Notification may only record original committed completion'; END IF;
  END IF;
  RETURN NEW;
 END IF;
 IF TG_TABLE_NAME='account_runtime_metadata' AND TG_OP<>'INSERT' THEN RAISE EXCEPTION 'Canonical owner metadata is immutable'; END IF;
 SELECT * INTO g FROM communications.connection_generations WHERE connection_id=NEW.connection_id AND generation=NEW.generation;
 IF NOT FOUND OR g.backend<>'unipile' OR g.provider_api_version<>'v1' OR g.authority<>'service' THEN RAISE EXCEPTION 'Exact recorded service generation required'; END IF;
 PERFORM communications.lock_reply_barrier(g.application_id,g.tenant_id);
 SELECT * INTO c FROM communications.connections WHERE id=g.connection_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Original connection required'; END IF;
 PERFORM 1 FROM communications.physical_accounts WHERE id=g.account_id AND channel=g.channel AND verified_at IS NOT NULL AND verified_at<=clock_timestamp() FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Canonical verified physical owner required'; END IF;
 PERFORM 1 FROM communications.access_grants WHERE application_id=g.application_id AND tenant_id=g.tenant_id AND owner_id=g.owner_id
 AND revoked_at IS NULL AND expires_at>clock_timestamp() FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Current owner grant required'; END IF;
 IF TG_TABLE_NAME='account_runtime_metadata' THEN
  PERFORM pg_advisory_xact_lock(hashtextextended(jsonb_build_array('provider-webhook-spool',g.integration_id,g.provider_configuration_reference)::text,0));
  UPDATE communications.provider_webhook_spool SET bound_connection_id=g.connection_id,bound_generation=g.generation
   WHERE bound_connection_id IS NULL AND integration_id=g.integration_id AND provider_configuration_reference=g.provider_configuration_reference
    AND g.provider_account_digest=ANY(provider_account_digests) AND state IN('pending','processing');
 END IF;
 IF TG_TABLE_NAME='connection_defaults' THEN
  IF NEW.application_id<>g.application_id OR NEW.tenant_id<>g.tenant_id OR NEW.owner_id<>g.owner_id OR NEW.channel<>g.channel OR
   c.current_generation<>g.generation OR NOT c.active OR c.status<>'connected' OR
   EXISTS(SELECT 1 FROM communications.connection_retirements WHERE account_id=g.account_id AND state<>'disconnected') THEN
   RAISE EXCEPTION 'Exact current connected default required'; END IF;
  IF TG_OP='UPDATE' AND ROW(NEW.application_id,NEW.tenant_id,NEW.owner_id,NEW.channel) IS DISTINCT FROM ROW(OLD.application_id,OLD.tenant_id,OLD.owner_id,OLD.channel) THEN
   RAISE EXCEPTION 'Default scope is immutable'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER communications_runtime_metadata_guard BEFORE INSERT OR UPDATE OR DELETE ON communications.account_runtime_metadata FOR EACH ROW EXECUTE FUNCTION communications.guard_account_runtime();
CREATE TRIGGER communications_runtime_default_guard BEFORE INSERT OR UPDATE OR DELETE ON communications.connection_defaults FOR EACH ROW EXECUTE FUNCTION communications.guard_account_runtime();
CREATE TRIGGER communications_runtime_notification_guard BEFORE INSERT OR UPDATE OR DELETE ON communications.setup_notification_inbox FOR EACH ROW EXECUTE FUNCTION communications.guard_account_runtime();
CREATE CONSTRAINT TRIGGER communications_runtime_metadata_commit AFTER INSERT ON communications.account_runtime_metadata DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION communications.guard_account_runtime();
CREATE CONSTRAINT TRIGGER communications_runtime_default_commit AFTER INSERT OR UPDATE ON communications.connection_defaults DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION communications.guard_account_runtime();
ALTER TABLE communications.account_runtime_metadata ENABLE ROW LEVEL SECURITY;
ALTER TABLE communications.account_runtime_metadata FORCE ROW LEVEL SECURITY;
ALTER TABLE communications.connection_defaults ENABLE ROW LEVEL SECURITY;
ALTER TABLE communications.connection_defaults FORCE ROW LEVEL SECURITY;
ALTER TABLE communications.setup_notification_inbox ENABLE ROW LEVEL SECURITY;
ALTER TABLE communications.setup_notification_inbox FORCE ROW LEVEL SECURITY;
CREATE POLICY account_runtime_control ON communications.account_runtime_metadata TO communications_control USING(true) WITH CHECK(true);
CREATE POLICY connection_defaults_control ON communications.connection_defaults TO communications_control USING(true) WITH CHECK(true);
CREATE POLICY setup_notification_control ON communications.setup_notification_inbox TO communications_control USING(true) WITH CHECK(true);
CREATE POLICY account_runtime_scope ON communications.account_runtime_metadata FOR SELECT TO communications_scoped USING(EXISTS(
 SELECT 1 FROM communications.connection_generations g WHERE g.connection_id=account_runtime_metadata.connection_id AND g.generation=account_runtime_metadata.generation
 AND communications.scope_authorized(g.application_id,g.tenant_id,g.owner_id)));
CREATE POLICY connection_defaults_scope ON communications.connection_defaults FOR SELECT TO communications_scoped USING(communications.scope_authorized(application_id,tenant_id,owner_id));
REVOKE ALL ON communications.account_runtime_metadata,communications.connection_defaults,communications.setup_notification_inbox FROM PUBLIC;
REVOKE ALL ON FUNCTION communications.guard_account_runtime() FROM PUBLIC;
GRANT SELECT,INSERT ON communications.account_runtime_metadata TO communications_control;
GRANT SELECT,INSERT,UPDATE ON communications.connection_defaults,communications.setup_notification_inbox TO communications_control;
GRANT SELECT ON communications.account_runtime_metadata,communications.connection_defaults TO communications_scoped;
COMMIT;
