-- LOCAL ONLY: add one exact reserved email/LinkedIn namespace. WhatsApp unchanged; no policy or clock changes.
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
DO $$ BEGIN IF md5(pg_get_functiondef('public.agent_channel_reserved_recipient(text,text)'::regprocedure)) IS DISTINCT FROM 'a992dbcea118c60469bc9a5e65388133' THEN RAISE EXCEPTION 'Unexpected reserved recipient predecessor';END IF;END $$;
CREATE OR REPLACE FUNCTION public.agent_channel_reserved_recipient(p_channel text, p_value text)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'pg_catalog', 'public'
AS $function$
 SELECT CASE p_channel WHEN 'email' THEN p_value~'^lead-[0-9]{3}@agent-(multichannel-20261017|real-research-demos|deep-gui-20261020|deep-isolated-20261024)[.]leads[.]acquire[.]test$'
 WHEN 'whatsapp' THEN p_value~'^[+]999[0-9]{12}$'
 WHEN 'linkedin' THEN p_value~'^https://www[.]linkedin[.]com/in/sim-agent-(multichannel-20261017|real-research-demos|deep-gui-20261020|deep-isolated-20261024)-lead-[0-9]{3}$' ELSE false END;
$function$
;
COMMIT;
