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
 IF current_database()<>'acquire_communications' OR current_user<>'communications_admin' OR (SELECT system_identifier::text FROM pg_control_system())<>current_setting('acquire.expected_system_identifier', true)
 OR to_regclass('communications.operation_journal') IS NULL OR to_regprocedure('communications.assert_dispatch_reply_barrier(text,text)') IS NULL
 OR to_regclass('communications.dispatch_admissions') IS NOT NULL OR to_regclass('communications.application_quota_buckets') IS NOT NULL
 THEN RAISE EXCEPTION 'Exact existing standalone target and unapplied admission schema required'; END IF;
 IF EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind IN('r','p','v','m','f')) THEN RAISE EXCEPTION 'Service target must have no application relations'; END IF;
 IF (SELECT count(*) FROM pg_roles WHERE rolname IN('communications_control','communications_scoped') AND NOT rolsuper AND NOT rolbypassrls AND NOT rolcanlogin)<>2 THEN RAISE EXCEPTION 'Restricted service roles required'; END IF;
END $$;
CREATE TABLE communications.dispatch_admissions(
 id text PRIMARY KEY CHECK(length(id) BETWEEN 1 AND 200),journal_id text NOT NULL UNIQUE REFERENCES communications.operation_journal(id),
 application_id text NOT NULL,tenant_id text NOT NULL,owner_id text NOT NULL,connection_id text NOT NULL,generation integer NOT NULL,account_id text NOT NULL,
 operation_key text NOT NULL,payload_digest text NOT NULL CHECK(payload_digest~'^[a-f0-9]{64}$'),
 permit_id text NOT NULL,intent_digest text NOT NULL CHECK(intent_digest~'^[a-f0-9]{64}$'),
 claim_token text NOT NULL,fencing_token bigint NOT NULL,lease_owner_token text NOT NULL,service_revision bigint NOT NULL CHECK(service_revision>=0),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),UNIQUE(application_id,permit_id),
 FOREIGN KEY(connection_id,generation,application_id,tenant_id,owner_id,account_id) REFERENCES communications.connection_generations(connection_id,generation,application_id,tenant_id,owner_id,account_id)
);
CREATE TABLE communications.application_quota_buckets(
 application_id text NOT NULL,window_kind text NOT NULL CHECK(window_kind IN('hour','day')),window_start timestamptz NOT NULL,
 used bigint NOT NULL CHECK(used>=0),limit_value integer NOT NULL CHECK(limit_value>=0 AND used<=limit_value),
 PRIMARY KEY(application_id,window_kind,window_start)
);
CREATE FUNCTION communications.rollup_application_quota() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,communications AS $$
DECLARE delta bigint; prior bigint;
BEGIN
 IF NEW.bucket_kind<>'application' THEN RETURN NEW; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('communications.application-quota.v1:'||NEW.application_id,0));
 IF TG_OP='UPDATE' AND ROW(NEW.account_id,NEW.bucket_kind,NEW.application_id,NEW.window_kind,NEW.window_start,NEW.limit_value) IS DISTINCT FROM ROW(OLD.account_id,OLD.bucket_kind,OLD.application_id,OLD.window_kind,OLD.window_start,OLD.limit_value) THEN RAISE EXCEPTION 'Quota policy/window identity cannot be changed'; END IF;
 delta:=NEW.used-CASE WHEN TG_OP='UPDATE' THEN OLD.used ELSE 0 END;
 IF delta<0 THEN RAISE EXCEPTION 'Charged application quota cannot be reset'; END IF;
 -- AFTER fires exactly once for the actual INSERT or ON CONFLICT UPDATE.
 -- The changed per-account row is already included in SUM, so remove its delta.
 SELECT coalesce(sum(used),0) INTO prior FROM communications.quota_buckets WHERE bucket_kind='application' AND application_id=NEW.application_id AND window_kind=NEW.window_kind AND window_start=NEW.window_start;
 prior:=prior-delta;
 IF prior<0 THEN RAISE EXCEPTION 'Application quota history count conflict'; END IF;
 IF prior+delta>NEW.limit_value THEN RAISE EXCEPTION USING ERRCODE='PQUO1',MESSAGE='Application quota unavailable'; END IF;
 INSERT INTO communications.application_quota_buckets(application_id,window_kind,window_start,used,limit_value) VALUES(NEW.application_id,NEW.window_kind,NEW.window_start,prior,NEW.limit_value) ON CONFLICT DO NOTHING;
 UPDATE communications.application_quota_buckets SET used=used+delta WHERE application_id=NEW.application_id AND window_kind=NEW.window_kind AND window_start=NEW.window_start AND limit_value=NEW.limit_value AND used=prior AND used+delta<=limit_value;
 IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='PQUO1',MESSAGE='Application quota policy/count conflict'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER communications_application_quota_rollup AFTER INSERT OR UPDATE ON communications.quota_buckets FOR EACH ROW EXECUTE FUNCTION communications.rollup_application_quota();
CREATE FUNCTION communications.guard_dispatch_admission() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,communications AS $$
DECLARE operation communications.operation_journal%ROWTYPE; current_revision bigint;
BEGIN
 IF current_user<>'communications_control' THEN RAISE EXCEPTION 'Restricted service admission writer required'; END IF;
 SELECT * INTO STRICT operation FROM communications.operation_journal WHERE id=NEW.journal_id FOR SHARE;
 current_revision:=communications.assert_dispatch_reply_barrier(NEW.application_id,NEW.tenant_id);
 IF ROW(operation.application_id,operation.tenant_id,operation.owner_id,operation.connection_id,operation.generation,operation.account_id,operation.operation_key,operation.payload_digest,operation.claim_token,operation.fencing_token,operation.lease_owner_token)
 IS DISTINCT FROM ROW(NEW.application_id,NEW.tenant_id,NEW.owner_id,NEW.connection_id,NEW.generation,NEW.account_id,NEW.operation_key,NEW.payload_digest,NEW.claim_token,NEW.fencing_token,NEW.lease_owner_token)
 OR operation.state<>'dispatching' OR NOT operation.quota_reserved OR operation.claim_until<=clock_timestamp() OR current_revision<>NEW.service_revision
 OR NOT EXISTS(SELECT 1 FROM communications.connections c WHERE c.id=NEW.connection_id AND c.current_generation=NEW.generation AND c.account_id=NEW.account_id AND c.active AND c.status='connected')
 OR NOT EXISTS(SELECT 1 FROM communications.physical_accounts p WHERE p.id=NEW.account_id AND p.verified_at IS NOT NULL AND p.verified_at<=clock_timestamp())
 OR NOT EXISTS(SELECT 1 FROM communications.access_grants g WHERE g.application_id=NEW.application_id AND g.tenant_id=NEW.tenant_id AND g.owner_id=NEW.owner_id AND g.revoked_at IS NULL AND g.expires_at>clock_timestamp())
 OR NOT EXISTS(SELECT 1 FROM communications.account_leases l WHERE l.account_id=NEW.account_id AND l.owner_token=NEW.lease_owner_token AND l.fencing_token=NEW.fencing_token AND l.expires_at>clock_timestamp()) THEN RAISE EXCEPTION 'Original held admission authority expired or mismatched'; END IF;
 RETURN NEW;
END $$;
CREATE CONSTRAINT TRIGGER communications_admission_commit AFTER INSERT ON communications.dispatch_admissions DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION communications.guard_dispatch_admission();
CREATE FUNCTION communications.require_dispatch_admission() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,communications AS $$
BEGIN
 IF OLD.state='claimed' AND NEW.state='dispatching' AND NOT EXISTS(SELECT 1 FROM communications.dispatch_admissions a WHERE a.journal_id=NEW.id AND a.application_id=NEW.application_id AND a.tenant_id=NEW.tenant_id AND a.owner_id=NEW.owner_id AND a.claim_token=NEW.claim_token AND a.fencing_token=NEW.fencing_token) THEN RAISE EXCEPTION 'Private application permit ledger required'; END IF; RETURN NEW;
END $$;
CREATE TRIGGER communications_01_private_admission BEFORE UPDATE ON communications.operation_journal FOR EACH ROW EXECUTE FUNCTION communications.require_dispatch_admission();
CREATE TRIGGER communications_admission_immutable BEFORE UPDATE OR DELETE ON communications.dispatch_admissions FOR EACH ROW EXECUTE FUNCTION communications.reject_mutation();
CREATE TRIGGER communications_application_quota_no_delete BEFORE DELETE ON communications.application_quota_buckets FOR EACH ROW EXECUTE FUNCTION communications.reject_mutation();
ALTER TABLE communications.dispatch_admissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE communications.dispatch_admissions FORCE ROW LEVEL SECURITY;
ALTER TABLE communications.application_quota_buckets ENABLE ROW LEVEL SECURITY;
ALTER TABLE communications.application_quota_buckets FORCE ROW LEVEL SECURITY;
CREATE POLICY communications_admissions_control ON communications.dispatch_admissions TO communications_control USING(true) WITH CHECK(true);
CREATE POLICY communications_admissions_scope ON communications.dispatch_admissions FOR SELECT TO communications_scoped USING(communications.scope_authorized(application_id,tenant_id,owner_id));
CREATE POLICY communications_app_quota_control ON communications.application_quota_buckets TO communications_control USING(true) WITH CHECK(true);
GRANT SELECT,INSERT ON communications.dispatch_admissions TO communications_control;
GRANT SELECT ON communications.dispatch_admissions TO communications_scoped;
GRANT SELECT,INSERT,UPDATE ON communications.application_quota_buckets TO communications_control;
REVOKE DELETE ON communications.dispatch_admissions,communications.application_quota_buckets FROM communications_control,communications_scoped;
REVOKE ALL ON FUNCTION communications.rollup_application_quota(),communications.guard_dispatch_admission(),communications.require_dispatch_admission() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION communications.rollup_application_quota(),communications.guard_dispatch_admission(),communications.require_dispatch_admission() TO communications_control;
COMMIT;
