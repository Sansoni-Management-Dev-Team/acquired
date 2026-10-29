-- LOCAL ONLY: exact isolated account mapped-route hours exception. No clocks/cadence/leases changed.
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
DO $$ BEGIN IF md5(pg_get_functiondef('public.agent_gui_testing_send_window_exempt(uuid)'::regprocedure)) IS DISTINCT FROM '08838421371c06a7a1e0ad911b406267' THEN RAISE EXCEPTION 'Unexpected local send-window predecessor';END IF;END $$;
CREATE OR REPLACE FUNCTION public.agent_gui_testing_send_window_exempt(p_route uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE org text:=current_setting('app.acquire_org',true);actor text:=current_setting('app.acquire_user',true);
BEGIN
 IF current_database() IS DISTINCT FROM 'acquire_agent_mode'
 OR shobj_description((SELECT oid FROM pg_database WHERE datname=current_database()),'pg_database') IS DISTINCT FROM 'acquire-agent-mode-local-only'
 OR (SELECT system_identifier::text FROM pg_control_system()) IS DISTINCT FROM '7697400069962248225'
 OR current_setting('role',true) NOT IN('acquire_agent_user','acquire_campaign_user')
 OR current_setting('app.acquire_channel_simulation',true) IS DISTINCT FROM 'true'
 OR ((current_setting('app.acquire_runtime_id',true)='agent-multichannel-20261017' AND org='m8qeFHRPVOUAgbBRq3sOFGXo3XE2aYFo' AND actor='yJPrXFrkU8VWyiX47yRUAv6lIaGvyMSk')
 OR (current_setting('app.acquire_runtime_id',true)='acquire-isolated-20261024' AND org='tznAqSOpz3XjLKZFwvgY9m1rJNTQa9ef' AND actor='2BgUnimhvgfiCHJjspTL4zH8qG7kx9Ch')) IS NOT TRUE THEN RETURN false;END IF;
 RETURN EXISTS(
 SELECT 1 FROM public.agent_conversation_channels r
 JOIN public.agent_conversations c ON c.id=r.conversation_id AND c.thread_id=r.thread_id AND c.mandate_id=r.mandate_id AND c.organization_id=org AND c.owner_user_id=actor
 JOIN public.agent_threads t ON t.id=c.thread_id AND t.mandate_id=c.mandate_id AND t.organization_id=org AND t.owner_user_id=actor
 JOIN public.mandates mandate ON mandate.id=c.mandate_id AND mandate.organization_id=org
 JOIN public.agent_effective_demo_contact_mappings mapping ON mapping.contact_id=c.contact_id AND mapping.mandate_id=c.mandate_id AND mapping.organization_id=org AND mapping.created_by=actor
 JOIN public.agent_demo_runs run ON mapping.demo_run_id=run.id AND run.organization_id=org AND run.owner_user_id=actor
 JOIN LATERAL jsonb_array_elements(run.senders) sender ON sender->>'bindingId'=r.binding_id::text AND sender->>'bindingDigest'=r.binding_digest AND sender->>'channel'=r.channel
 WHERE r.id=p_route AND r.organization_id=org AND r.owner_user_id=actor AND c.delivery_mode='communications'
 AND ((current_setting('app.acquire_runtime_id',true)='agent-multichannel-20261017' AND run.run_id='agent-deep-gui-20261020' AND run.integration_id='sim-agent-deep-gui-20261020' AND run.configuration_ref='sim-agent-deep-gui-20261020-v1')
 OR (current_setting('app.acquire_runtime_id',true)='acquire-isolated-20261024' AND run.run_id='agent-deep-isolated-20261024' AND run.integration_id='sim-agent-deep-isolated-20261024' AND run.configuration_ref='sim-agent-deep-isolated-20261024-v1'))
 AND public.agent_demo_run_bindings_match(run.organization_id,run.owner_user_id,run.run_id,run.integration_id,run.configuration_ref,run.senders)
 AND mapping.wire->>'email'~('^lead-[0-9]{3}@'||run.run_id||'[.]leads[.]acquire[.]test$')
 AND mapping.wire->>'phone'~'^[+]999[0-9]{12}$'
 AND mapping.wire->>'linkedin'~('^https://www[.]linkedin[.]com/in/sim-'||run.run_id||'-lead-[0-9]{3}$')
 AND CASE r.channel
  WHEN 'email' THEN r.recipient_kind='email' AND r.recipient_value=mapping.wire->>'email'
  WHEN 'whatsapp' THEN r.recipient_kind='phone' AND r.recipient_value=mapping.wire->>'phone'
  WHEN 'linkedin' THEN r.recipient_kind='linkedin_profile' AND r.recipient_value=mapping.wire->>'linkedin'
  ELSE false END);
END $function$
;
COMMIT;
