-- LOCAL ONLY: recognize the exact independent lane for existing explicit accelerated policy. No policy/timestamps are changed here.
BEGIN;
SET LOCAL lock_timeout='3s';
SET LOCAL statement_timeout='15s';
DO $preflight$
DECLARE system_id text;marker text;
BEGIN
 SELECT system_identifier::text INTO system_id FROM pg_catalog.pg_control_system();
 SELECT pg_catalog.shobj_description(oid,'pg_database') INTO marker FROM pg_catalog.pg_database WHERE datname=current_database();
 IF (current_database()='acquire_agent_mode' AND system_id='7697400069962248225' AND marker='acquire-agent-mode-local-only') IS NOT TRUE THEN RAISE EXCEPTION 'Unapproved database target';END IF;
 IF to_regclass('public.acquisition_workflow_executions') IS NULL OR current_user IS DISTINCT FROM pg_get_userbyid((SELECT relowner FROM pg_class WHERE oid='public.acquisition_workflow_executions'::regclass)) THEN RAISE EXCEPTION 'Workflow schema owner required';END IF;
END $preflight$;
DO $$ BEGIN IF md5(pg_get_functiondef('public.agent_channel_local_binding(uuid)'::regprocedure)) IS DISTINCT FROM 'f2a5d85f4680095eb99f98370c20bf83' THEN RAISE EXCEPTION 'Unexpected local binding predecessor';END IF;END $$;
CREATE OR REPLACE FUNCTION public.agent_channel_local_binding(p_binding uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
BEGIN
 IF current_database()='acquire_agent_mode'
 AND shobj_description((SELECT oid FROM pg_database WHERE datname=current_database()),'pg_database')='acquire-agent-mode-local-only'
 AND (SELECT system_identifier::text FROM pg_control_system())='7697400069962248225'
 AND current_setting('role',true) IN('acquire_agent_user','acquire_campaign_user')
 AND current_setting('app.acquire_channel_simulation',true)='true'
 AND current_setting('app.acquire_runtime_id',true)='acquire-isolated-20261024'
 AND current_setting('app.acquire_org',true)='tznAqSOpz3XjLKZFwvgY9m1rJNTQa9ef'
 AND current_setting('app.acquire_user',true)='2BgUnimhvgfiCHJjspTL4zH8qG7kx9Ch'
 AND EXISTS(SELECT 1 FROM public.agent_demo_runs run JOIN LATERAL jsonb_array_elements(run.senders) s ON s->>'bindingId'=p_binding::text
 WHERE run.organization_id=current_setting('app.acquire_org',true) AND run.owner_user_id=current_setting('app.acquire_user',true)
 AND run.run_id='agent-deep-isolated-20261024' AND run.integration_id='sim-agent-deep-isolated-20261024' AND run.configuration_ref='sim-agent-deep-isolated-20261024-v1'
 AND public.agent_demo_run_bindings_match(run.organization_id,run.owner_user_id,run.run_id,run.integration_id,run.configuration_ref,run.senders)) THEN RETURN true;END IF;
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
END $function$
;
COMMIT;
