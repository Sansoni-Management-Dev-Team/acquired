-- REVIEWABLE REPAIR ONLY. Specific approval for this artifact is required before execution.
-- Exact existing target127.0.0.1:5446/communications_fixture, system7696118996713136162.
-- Repairs actual PG record-field planning failure from approved006; original006 bytes remain unchanged.
-- No table/trigger/ACL/data change, provider action, backfill, startup or initialization.
BEGIN;
DO $$ BEGIN
 IF current_database()<>'communications_fixture' OR current_user<>'communications_fixture'
 OR (SELECT system_identifier::text FROM pg_control_system())<>'7696118996713136162' THEN
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
  AND p.proconfig=ARRAY['search_path=pg_catalog']::text[] AND pg_get_userbyid(p.proowner)='communications_fixture'
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
