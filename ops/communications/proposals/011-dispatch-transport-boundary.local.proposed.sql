-- UNAPPLIED proposal. Exact isolated agent database only. No backfill or send.
BEGIN;
SET LOCAL lock_timeout='2s';
SET LOCAL statement_timeout='10s';
DO $$ BEGIN
 IF current_database()<>'acquire_agent_mode' OR
 (SELECT shobj_description(oid,'pg_database') FROM pg_database WHERE datname=current_database()) IS DISTINCT FROM 'acquire-agent-mode-local-only' OR
 (SELECT system_identifier::text FROM pg_control_system())<>'7697400069962248225' OR
 to_regclass('communications.dispatch_admissions') IS NULL OR
 to_regclass('communications.dispatch_transport_boundaries') IS NOT NULL
 OR current_user IS DISTINCT FROM pg_get_userbyid((SELECT relowner FROM pg_class WHERE oid=to_regclass('communications.operation_journal')))
 THEN RAISE EXCEPTION 'Exact isolated target and unapplied transport boundary required'; END IF;
END $$;
CREATE TABLE communications.dispatch_transport_boundaries(
 journal_id text PRIMARY KEY REFERENCES communications.operation_journal(id),
 application_id text NOT NULL,tenant_id text NOT NULL,owner_id text NOT NULL,
 claim_token text NOT NULL,fencing_token bigint NOT NULL,lease_owner_token text NOT NULL,
 state text NOT NULL CHECK(state IN('prewrite','write_started','closed_no_write')),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),resolved_at timestamptz,
 CHECK((state='prewrite')=(resolved_at IS NULL))
);
-- Identity is inherited from the immutable journal/admission and cannot be
-- attached after admission. A deferred constraint requires that initialization
-- and the first dispatch admission commit atomically, including under savepoints.
CREATE FUNCTION communications.guard_dispatch_transport_boundary() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,communications AS $$
DECLARE j communications.operation_journal%ROWTYPE;
BEGIN
 IF current_user<>'communications_control' OR TG_OP='DELETE' THEN RAISE EXCEPTION 'Restricted immutable transport boundary required'; END IF;
 SELECT * INTO STRICT j FROM communications.operation_journal WHERE id=NEW.journal_id FOR UPDATE;
 IF ROW(j.application_id,j.tenant_id,j.owner_id,j.claim_token,j.fencing_token,j.lease_owner_token)
 IS DISTINCT FROM ROW(NEW.application_id,NEW.tenant_id,NEW.owner_id,NEW.claim_token,NEW.fencing_token,NEW.lease_owner_token)
 OR j.claim_until<=clock_timestamp()
 OR NOT EXISTS(SELECT 1 FROM communications.account_leases l WHERE l.account_id=j.account_id AND l.owner_token=j.lease_owner_token AND l.fencing_token=j.fencing_token AND l.expires_at>clock_timestamp())
 THEN RAISE EXCEPTION 'Original live dispatch fence required'; END IF;
 IF TG_OP='INSERT' THEN
  IF NEW.state<>'prewrite' OR NEW.resolved_at IS NOT NULL OR j.state<>'claimed' OR j.quota_reserved OR EXISTS(SELECT 1 FROM communications.dispatch_admissions a WHERE a.journal_id=j.id)
  THEN RAISE EXCEPTION 'Only new instrumented admission may initialize transport boundary'; END IF;
 ELSIF j.state<>'dispatching' OR NOT j.quota_reserved OR ROW(NEW.journal_id,NEW.application_id,NEW.tenant_id,NEW.owner_id,NEW.claim_token,NEW.fencing_token,NEW.lease_owner_token,NEW.created_at)
 IS DISTINCT FROM ROW(OLD.journal_id,OLD.application_id,OLD.tenant_id,OLD.owner_id,OLD.claim_token,OLD.fencing_token,OLD.lease_owner_token,OLD.created_at)
 OR OLD.state<>'prewrite' OR NEW.state NOT IN('write_started','closed_no_write') OR NEW.resolved_at IS NULL
 THEN RAISE EXCEPTION 'Transport decision is irreversible'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER communications_transport_boundary_guard BEFORE INSERT OR UPDATE OR DELETE ON communications.dispatch_transport_boundaries FOR EACH ROW EXECUTE FUNCTION communications.guard_dispatch_transport_boundary();
CREATE FUNCTION communications.check_transport_boundary_admission() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,communications AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM communications.operation_journal j JOIN communications.dispatch_admissions a ON a.journal_id=j.id WHERE j.id=NEW.journal_id AND j.state='dispatching' AND j.quota_reserved
 AND ROW(j.application_id,j.tenant_id,j.owner_id,j.claim_token,j.fencing_token,j.lease_owner_token)=ROW(NEW.application_id,NEW.tenant_id,NEW.owner_id,NEW.claim_token,NEW.fencing_token,NEW.lease_owner_token)
 AND ROW(a.application_id,a.tenant_id,a.owner_id,a.claim_token,a.fencing_token,a.lease_owner_token)=ROW(NEW.application_id,NEW.tenant_id,NEW.owner_id,NEW.claim_token,NEW.fencing_token,NEW.lease_owner_token))
 THEN RAISE EXCEPTION 'Transport boundary requires atomic original admission'; END IF;
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER communications_transport_boundary_admission AFTER INSERT ON communications.dispatch_transport_boundaries DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION communications.check_transport_boundary_admission();
REVOKE ALL ON FUNCTION communications.check_transport_boundary_admission() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION communications.check_transport_boundary_admission() TO communications_control;
ALTER TABLE communications.dispatch_transport_boundaries ENABLE ROW LEVEL SECURITY;
ALTER TABLE communications.dispatch_transport_boundaries FORCE ROW LEVEL SECURITY;
CREATE POLICY transport_boundary_control ON communications.dispatch_transport_boundaries TO communications_control USING(true) WITH CHECK(true);
REVOKE ALL ON communications.dispatch_transport_boundaries FROM PUBLIC;
REVOKE ALL ON FUNCTION communications.guard_dispatch_transport_boundary() FROM PUBLIC;
GRANT SELECT,INSERT,UPDATE ON communications.dispatch_transport_boundaries TO communications_control;
GRANT EXECUTE ON FUNCTION communications.guard_dispatch_transport_boundary() TO communications_control;
COMMIT;
