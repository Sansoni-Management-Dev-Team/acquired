-- PROPOSED ONLY. Requires specific user approval before application.
-- Target: isolated APP5437 acquire_agent_mode, marker acquire-agent-mode-local-only.
-- Enables the existing 3-60-second channel stagger only for three exact5991 test bindings.
-- Preserves wall time, account quotas, approvals, history checks, reply cancellation and old profiles.
-- No account rebinding, data rewrite, production permission or real delivery is added.
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
 THEN RAISE EXCEPTION 'Exact isolated APP5437 database owner required';END IF;
 SELECT * INTO p FROM pg_catalog.pg_proc WHERE oid=to_regprocedure('public.agent_channel_local_binding(uuid)');
 IF p.oid IS NULL OR encode(sha256(convert_to(p.prosrc,'UTF8')),'hex') IS DISTINCT FROM '3c86bed205a096a517fdf2297fcf114ba66eb1b1f45921749355a198c574646d'
 OR pg_get_userbyid(p.proowner) IS DISTINCT FROM 'project_acquire'
 OR p.prosecdef IS DISTINCT FROM true OR p.provolatile IS DISTINCT FROM 's'
 OR p.proacl::text IS DISTINCT FROM '{project_acquire=X/project_acquire}'
 OR p.proconfig IS DISTINCT FROM ARRAY['search_path=pg_catalog, public']::text[]
 OR p.prorettype IS DISTINCT FROM 'boolean'::regtype OR p.prolang IS DISTINCT FROM (SELECT oid FROM pg_language WHERE lanname='plpgsql')
 THEN RAISE EXCEPTION 'Exact reviewed fast-channel predecessor and authority required';END IF;
END $guard$;
CREATE OR REPLACE FUNCTION public.agent_channel_local_binding(p_binding uuid)
 RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
BEGIN
 IF public.agent_channel_local_binding_before_execution_context(p_binding) THEN RETURN true;END IF;
 IF current_database()<>'acquire_agent_mode' OR shobj_description((SELECT oid FROM pg_database WHERE datname=current_database()),'pg_database') IS DISTINCT FROM 'acquire-agent-mode-local-only'
 OR current_setting('app.acquire_channel_simulation',true) IS DISTINCT FROM 'true' OR current_setting('app.acquire_runtime_id',true) IS DISTINCT FROM 'agent-multichannel-20261017' THEN RETURN false;END IF;
 IF current_setting('app.acquire_org',true)='m8qeFHRPVOUAgbBRq3sOFGXo3XE2aYFo'
 AND current_setting('app.acquire_user',true)='yJPrXFrkU8VWyiX47yRUAv6lIaGvyMSk'
 AND p_binding IN('b2dc48c5-4558-408d-a38a-5db9dc8bec02'::uuid,'c00037ab-15ec-4c76-b421-82bb123d2b4b'::uuid,'b18da951-477f-4917-9d7e-251c35559d8b'::uuid)
 AND EXISTS(SELECT 1 FROM public.agent_demo_runs run JOIN LATERAL jsonb_array_elements(run.senders) s ON s->>'bindingId'=p_binding::text
  WHERE run.organization_id=current_setting('app.acquire_org',true) AND run.owner_user_id=current_setting('app.acquire_user',true)
  AND run.run_id='agent-deep-gui-20261020' AND run.integration_id='sim-agent-deep-gui-20261020' AND run.configuration_ref='sim-agent-deep-gui-20261020-v1'
  AND public.agent_demo_run_bindings_match(run.organization_id,run.owner_user_id,run.run_id,run.integration_id,run.configuration_ref,run.senders))
 THEN RETURN true;END IF;
 RETURN EXISTS(SELECT 1 FROM public.agent_demo_runs run JOIN LATERAL jsonb_array_elements(run.senders) s ON s->>'bindingId'=p_binding::text WHERE run.organization_id=current_setting('app.acquire_org',true) AND run.owner_user_id=current_setting('app.acquire_user',true)
  AND run.run_id='agent-real-research-demos' AND run.integration_id='sim-agent-real-research-demos' AND run.configuration_ref='sim-agent-real-research-demos-v1'
  AND public.agent_demo_run_bindings_match(run.organization_id,run.owner_user_id,run.run_id,run.integration_id,run.configuration_ref,run.senders));
END $function$;
DO $readback$
DECLARE p pg_catalog.pg_proc%ROWTYPE;
BEGIN
 SELECT * INTO p FROM pg_catalog.pg_proc WHERE oid=to_regprocedure('public.agent_channel_local_binding(uuid)');
 IF encode(sha256(convert_to(p.prosrc,'UTF8')),'hex') IS DISTINCT FROM '446300a37e0d9ebb40775cc9868aecf0b0b37627cfbc3af0ec8bcc480e6009e6'
 OR pg_get_userbyid(p.proowner) IS DISTINCT FROM 'project_acquire'
 OR p.prosecdef IS DISTINCT FROM true OR p.provolatile IS DISTINCT FROM 's'
 OR p.proacl::text IS DISTINCT FROM '{project_acquire=X/project_acquire}'
 OR p.proconfig IS DISTINCT FROM ARRAY['search_path=pg_catalog, public']::text[]
 THEN RAISE EXCEPTION 'Fast-channel body or original authority differs';END IF;
END $readback$;
COMMIT;
