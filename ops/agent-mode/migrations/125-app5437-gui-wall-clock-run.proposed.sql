-- PROPOSED ONLY. APP5437, NOT the sim5549 cluster. No application/startup hook.
-- Requires the user's specific approval of this exact file/hash/target before application.
-- One wall-clock run only; historical admission and both acceleration predicates remain unchanged.
-- Captured installed predecessor body SHA256: bc721b876fbf88998fe2d019ecf19dcb6fb987986525571b44071fed623d1741
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='15s';
DO $guard$
DECLARE p pg_catalog.pg_proc%ROWTYPE;
BEGIN
 IF current_database() IS DISTINCT FROM 'acquire_agent_mode'
 OR shobj_description((SELECT oid FROM pg_database WHERE datname=current_database()),'pg_database') IS DISTINCT FROM 'acquire-agent-mode-local-only'
 OR (SELECT system_identifier::text FROM pg_control_system()) IS DISTINCT FROM '7697400069962248225'
 OR current_user IS DISTINCT FROM 'project_acquire' OR session_user IS DISTINCT FROM 'project_acquire'
 THEN RAISE EXCEPTION 'Exact approved isolated APP5437 database owner required';END IF;
 SELECT * INTO p FROM pg_catalog.pg_proc WHERE oid=to_regprocedure('public.agent_demo_runtime_ready(uuid)');
 IF p.oid IS NULL OR encode(sha256(convert_to(p.prosrc,'UTF8')),'hex') IS DISTINCT FROM 'bc721b876fbf88998fe2d019ecf19dcb6fb987986525571b44071fed623d1741'
 OR pg_get_userbyid(p.proowner) IS DISTINCT FROM 'project_acquire'
 OR p.prosecdef IS DISTINCT FROM true OR p.provolatile IS DISTINCT FROM 's'
 OR p.proacl::text IS DISTINCT FROM '{project_acquire=X/project_acquire}'
 OR p.proconfig IS DISTINCT FROM ARRAY['search_path=pg_catalog, public']::text[]
 OR p.prorettype IS DISTINCT FROM 'boolean'::regtype OR p.prolang IS DISTINCT FROM (SELECT oid FROM pg_language WHERE lanname='plpgsql')
 THEN RAISE EXCEPTION 'Exact reviewed runtime-ready predecessor and authority required';END IF;
END $guard$;

CREATE OR REPLACE FUNCTION public.agent_demo_runtime_ready(p_run uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
BEGIN
 RETURN EXISTS(SELECT 1 FROM public.agent_demo_runs run WHERE run.id=p_run AND run.organization_id=current_setting('app.acquire_org',true) AND run.owner_user_id=current_setting('app.acquire_user',true)
 AND ((run.run_id='agent-real-research-demos' AND run.integration_id='sim-agent-real-research-demos' AND run.configuration_ref='sim-agent-real-research-demos-v1')
   OR (run.run_id='agent-deep-gui-20261020' AND run.integration_id='sim-agent-deep-gui-20261020' AND run.configuration_ref='sim-agent-deep-gui-20261020-v1'))
 AND public.agent_demo_run_bindings_match(run.organization_id,run.owner_user_id,run.run_id,run.integration_id,run.configuration_ref,run.senders));
END $function$;

DO $readback$
DECLARE p pg_catalog.pg_proc%ROWTYPE;
BEGIN
 SELECT * INTO p FROM pg_catalog.pg_proc WHERE oid=to_regprocedure('public.agent_demo_runtime_ready(uuid)');
 IF encode(sha256(convert_to(p.prosrc,'UTF8')),'hex') IS DISTINCT FROM 'a1165251184c4b7a5eb7c34720188aa9fd4a9ee1bb30eb82d17e2a3abf9a0b28'
 OR pg_get_userbyid(p.proowner) IS DISTINCT FROM 'project_acquire'
 OR p.prosecdef IS DISTINCT FROM true OR p.provolatile IS DISTINCT FROM 's'
 OR p.proacl::text IS DISTINCT FROM '{project_acquire=X/project_acquire}'
 OR p.proconfig IS DISTINCT FROM ARRAY['search_path=pg_catalog, public']::text[]
 THEN RAISE EXCEPTION 'Prepared runtime-ready body or original authority differs';END IF;
END $readback$;
COMMIT;
