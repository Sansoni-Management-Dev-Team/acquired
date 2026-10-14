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
 IF current_database()<>'acquire_communications' OR current_user<>'communications_admin'
 OR (SELECT system_identifier::text FROM pg_control_system())<>current_setting('acquire.expected_system_identifier', true) THEN
  RAISE EXCEPTION 'Exact existing standalone repair target required';
 END IF;
 IF EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind IN('r','p','v','m','f')) THEN
  RAISE EXCEPTION 'Service-only target required';
 END IF;
 IF (SELECT count(*) FROM pg_roles WHERE rolname IN('communications_control','communications_scoped') AND NOT rolsuper AND NOT rolbypassrls AND NOT rolcanlogin)<>2 THEN
  RAISE EXCEPTION 'Existing restricted service roles required';
 END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('communications.guard_provider_spool_account_work()')
  AND md5(p.prosrc)='aa568c195ae4a03d576a6966baa09b3d' AND NOT p.prosecdef
  AND p.proconfig=ARRAY['search_path=pg_catalog']::text[] AND pg_get_userbyid(p.proowner)='communications_admin'
  AND p.prorettype='pg_catalog.trigger'::regtype) THEN
  RAISE EXCEPTION 'Unchanged approved006 trigger function required; do not reapply or overwrite other repairs';
 END IF;
 IF (SELECT count(*) FROM pg_class c WHERE c.oid IN('communications.provider_webhook_spool'::regclass,'communications.connection_generations'::regclass,'communications.connection_retirements'::regclass,'communications.operation_journal'::regclass) AND c.relrowsecurity AND c.relforcerowsecurity)<>4 THEN
  RAISE EXCEPTION 'Approved FORCE-RLS prerequisites required';
 END IF;
 IF (SELECT array_agg(pg_get_triggerdef(t.oid) ORDER BY t.tgname) FROM pg_trigger t
  WHERE t.tgfoid='communications.guard_provider_spool_account_work()'::regprocedure AND NOT t.tgisinternal)
  IS DISTINCT FROM ARRAY[
   'CREATE TRIGGER communications_00_provider_spool_dispatch_guard BEFORE UPDATE ON communications.operation_journal FOR EACH ROW EXECUTE FUNCTION communications.guard_provider_spool_account_work()',
   'CREATE TRIGGER communications_00_provider_spool_generation_guard BEFORE INSERT ON communications.connection_generations FOR EACH ROW EXECUTE FUNCTION communications.guard_provider_spool_account_work()',
   'CREATE TRIGGER communications_00_provider_spool_retirement_guard BEFORE INSERT ON communications.connection_retirements FOR EACH ROW EXECUTE FUNCTION communications.guard_provider_spool_account_work()']::text[] THEN
  RAISE EXCEPTION 'Unchanged three reviewed trigger bindings required';
 END IF;
END $$;
CREATE OR REPLACE FUNCTION communications.guard_provider_spool_account_work() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $$
DECLARE aid text;
BEGIN
 IF TG_TABLE_NAME='operation_journal' THEN
  IF NEW.state<>'dispatching' THEN RETURN NEW; END IF;
 END IF;
 aid:=NEW.account_id;
 IF EXISTS(SELECT 1 FROM communications.provider_webhook_spool w JOIN communications.connection_generations g ON g.connection_id=w.bound_connection_id AND g.generation=w.bound_generation WHERE g.account_id=aid AND w.state<>'routed') THEN RAISE EXCEPTION 'Pending provider evidence blocks account mutation'; END IF;
 RETURN NEW;
END $$;
COMMIT;
