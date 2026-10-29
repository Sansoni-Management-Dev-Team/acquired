-- PROPOSED, NOT APPLIED. Specific approval required for this exact app database.
-- Scope: legacy research compatibility only; shared workflow/native agent activation excluded.
-- Target: account352329340196, Sydney app Aurora acquire-acquire-develop, database acquire.
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '15s';
DO $$ BEGIN
 IF current_database() <> 'acquire' OR (SELECT system_identifier::text FROM pg_control_system()) <> '7619074599616174976' THEN
  RAISE EXCEPTION 'Wrong app Aurora database/cluster';
 END IF;
 IF to_regclass('public.research_jobs') IS NULL THEN RAISE EXCEPTION 'Expected existing research_jobs'; END IF;
 IF to_regclass('public.acquisition_workflow_executions') IS NOT NULL THEN RAISE EXCEPTION 'Shared workflow schema already installed; review full compatibility instead'; END IF;
 IF current_user <> (SELECT pg_get_userbyid(relowner) FROM pg_class WHERE oid='public.research_jobs'::regclass) THEN RAISE EXCEPTION 'Expected existing table owner'; END IF;
 IF (SELECT array_agg(attname::text ORDER BY attnum) FROM pg_attribute WHERE attrelid='public.research_jobs'::regclass AND attnum>0 AND NOT attisdropped) IS DISTINCT FROM
  ARRAY['id','organization_id','mandate_id','created_by','status','config','seeds','discovery_started','revision','pages','model_calls','message','crawl_id','created_at','updated_at']::text[] THEN RAISE EXCEPTION 'Research table differs from reviewed UAT catalog'; END IF;
END $$;
LOCK TABLE public.research_jobs IN ACCESS EXCLUSIVE MODE;
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM public.research_jobs) THEN RAISE EXCEPTION 'Expected reviewed empty UAT research table'; END IF;
END $$;
-- Current legacy research readers select this field even when workflow features
-- are disabled. Null preserves legacy ownership. Reject any attempt to associate
-- work with the unavailable shared workflow schema until a separate full upgrade.
ALTER TABLE public.research_jobs ADD COLUMN workflow_execution_id uuid
 CONSTRAINT acquire_aws_uat_research_legacy_only CHECK (workflow_execution_id IS NULL);
COMMENT ON COLUMN public.research_jobs.workflow_execution_id IS
 'AWS UAT legacy research compatibility only; NULL required until a separately approved shared-workflow schema upgrade.';
COMMIT;
