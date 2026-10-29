-- PROPOSED ONLY; additive original-source workflow reader. No table grants or historical changes.
BEGIN;
SET LOCAL lock_timeout='3s';
SET LOCAL statement_timeout='15s';
DO $preflight$
DECLARE system_id text;marker text;
BEGIN
 SELECT system_identifier::text INTO system_id FROM pg_catalog.pg_control_system();
 SELECT pg_catalog.shobj_description(oid,'pg_database') INTO marker FROM pg_catalog.pg_database WHERE datname=current_database();
 IF (current_database()='acquire_hosted_demo_rehearsal' AND system_id='7699248227334438947' AND marker='acquire-hosted-demo-rehearsal-only') IS NOT TRUE THEN RAISE EXCEPTION 'Unapproved database target';END IF;
 IF to_regclass('public.acquisition_workflow_executions') IS NULL OR current_user IS DISTINCT FROM pg_get_userbyid((SELECT relowner FROM pg_class WHERE oid='public.acquisition_workflow_executions'::regclass)) THEN RAISE EXCEPTION 'Workflow schema owner required';END IF;
END $preflight$;
CREATE FUNCTION public.communications_original_workflow(p_kind text,p_source uuid,p_enrolment uuid DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'pg_catalog','public' AS $function$
DECLARE org text:=nullif(current_setting('app.acquire_org',true),''); actor text:=nullif(current_setting('app.acquire_user',true),''); execution uuid; mandate uuid; found_source boolean:=false;
BEGIN
 IF org IS NULL OR actor IS NULL OR p_source IS NULL OR p_kind NOT IN('agent','campaign','draft')
 OR (p_kind='campaign') IS DISTINCT FROM (p_enrolment IS NOT NULL)
 OR NOT EXISTS(SELECT 1 FROM public.member WHERE organization_id=org AND user_id=actor)
 OR NOT EXISTS(SELECT 1 FROM public.communication_send_gates WHERE organization_id=org AND writer_xid=txid_current())
 THEN RAISE EXCEPTION 'Owned held source scope required' USING ERRCODE='42501';END IF;
 IF p_kind='agent' THEN
  SELECT o.workflow_execution_id,o.mandate_id,true INTO execution,mandate,found_source FROM public.agent_operations o WHERE o.id=p_source AND o.organization_id=org AND o.owner_user_id=actor;
 ELSIF p_kind='campaign' THEN
  SELECT e.workflow_execution_id,e.mandate_id,true INTO execution,mandate,found_source FROM public.campaign_send_attempts a JOIN public.campaign_enrolments e ON e.id=a.enrolment_id AND e.organization_id=a.organization_id WHERE a.id=p_source AND a.enrolment_id=p_enrolment AND a.organization_id=org AND e.owner_user_id=actor;
 ELSE
  SELECT e.workflow_execution_id,e.mandate_id,true INTO execution,mandate,found_source FROM public.messages m JOIN public.sequence_enrolments e ON e.id=m.enrolment_id AND e.organization_id=m.organization_id WHERE m.id=p_source AND m.organization_id=org AND EXISTS(SELECT 1 FROM public.outreach_draft_bindings b WHERE b.message_id=m.id AND b.organization_id=org AND b.owner_user_id=actor);
 END IF;
 IF found_source IS DISTINCT FROM true THEN RAISE EXCEPTION 'Original owned source unavailable' USING ERRCODE='42501';END IF;
 IF execution IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.acquisition_workflow_executions w WHERE w.id=execution AND w.organization_id=org AND w.owner_user_id=actor AND w.mandate_id=mandate)
 THEN RAISE EXCEPTION 'Original workflow ownership differs' USING ERRCODE='42501';END IF;
 -- Null remains an explicit legacy origin; never select a newer mandate run.
 RETURN execution;
END $function$;
REVOKE ALL ON FUNCTION public.communications_original_workflow(text,uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.communications_original_workflow(text,uuid,uuid) TO acquire_campaign_user,acquire_agent_user;
COMMIT;
