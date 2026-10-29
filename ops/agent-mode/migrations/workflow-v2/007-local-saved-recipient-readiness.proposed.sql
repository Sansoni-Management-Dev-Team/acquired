-- LOCAL ONLY: verified saved-recipient registry readiness; no send-window or clock changes.
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
DO $$ BEGIN IF md5(pg_get_functiondef('public.agent_demo_runtime_ready(uuid)'::regprocedure)) IS DISTINCT FROM 'fc24173e9562a70c8dadc234ccd89937' THEN RAISE EXCEPTION 'Unexpected demo readiness predecessor';END IF;END $$;
CREATE OR REPLACE FUNCTION public.agent_demo_runtime_ready(p_run uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
BEGIN
 RETURN EXISTS(SELECT 1 FROM public.agent_demo_runs run WHERE run.id=p_run AND run.organization_id=current_setting('app.acquire_org',true) AND run.owner_user_id=current_setting('app.acquire_user',true)
 AND ((run.run_id='agent-real-research-demos' AND run.integration_id='sim-agent-real-research-demos' AND run.configuration_ref='sim-agent-real-research-demos-v1')
   OR (run.run_id='agent-deep-gui-20261020' AND run.integration_id='sim-agent-deep-gui-20261020' AND run.configuration_ref='sim-agent-deep-gui-20261020-v1')
   OR (run.run_id='agent-deep-isolated-20261024' AND run.integration_id='sim-agent-deep-isolated-20261024' AND run.configuration_ref='sim-agent-deep-isolated-20261024-v1' AND run.organization_id='tznAqSOpz3XjLKZFwvgY9m1rJNTQa9ef' AND run.owner_user_id='2BgUnimhvgfiCHJjspTL4zH8qG7kx9Ch'))
 AND public.agent_demo_run_bindings_match(run.organization_id,run.owner_user_id,run.run_id,run.integration_id,run.configuration_ref,run.senders));
END $function$
;
COMMIT;
