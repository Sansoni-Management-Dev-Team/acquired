-- LOCAL DERIVATION: draft only, root review before application. Source 004-workflow-agent-gate.proposed.sql
-- WF-03 correction, proposed only: requires new exact approval. 001-003 remain immutable.
BEGIN;
SET LOCAL lock_timeout='3s';
SET LOCAL statement_timeout='15s';
DO $preflight$
DECLARE system_id text;marker text;
BEGIN
 SELECT system_identifier::text INTO system_id FROM pg_catalog.pg_control_system();
 SELECT pg_catalog.shobj_description(oid,'pg_database') INTO marker FROM pg_catalog.pg_database WHERE datname=current_database();
 IF (current_database()='acquire_agent_mode' AND (SELECT system_identifier::text FROM pg_catalog.pg_control_system())='7697400069962248225' AND shobj_description((SELECT oid FROM pg_database WHERE datname=current_database()),'pg_database')='acquire-agent-mode-local-only') IS NOT TRUE THEN RAISE EXCEPTION 'Exact marked local workflow target required';END IF;
 IF to_regclass('public.acquisition_workflow_executions') IS NULL
 OR to_regclass('public.workflow_agent_demo_mapping_requests') IS NULL
 OR NOT EXISTS(SELECT 1 FROM pg_catalog.pg_attribute WHERE attrelid='public.research_jobs'::regclass AND attname='workflow_execution_id' AND NOT attisdropped)
 OR NOT EXISTS(SELECT 1 FROM pg_catalog.pg_attribute WHERE attrelid='public.agent_conversations'::regclass AND attname='workflow_execution_id' AND NOT attisdropped)
 OR NOT EXISTS(SELECT 1 FROM pg_catalog.pg_attribute WHERE attrelid='public.agent_operations'::regclass AND attname='workflow_execution_id' AND NOT attisdropped)
 OR NOT EXISTS(SELECT 1 FROM pg_catalog.pg_attribute WHERE attrelid='public.campaign_enrolments'::regclass AND attname='workflow_execution_id' AND NOT attisdropped)
 OR NOT EXISTS(SELECT 1 FROM pg_catalog.pg_attribute WHERE attrelid='public.sequence_enrolments'::regclass AND attname='workflow_execution_id' AND NOT attisdropped)
 THEN RAISE EXCEPTION 'Reviewed workflow expansion and compatibility prerequisites required';END IF;
 IF current_user IS DISTINCT FROM pg_get_userbyid((SELECT relowner FROM pg_class WHERE oid='public.acquisition_workflow_executions'::regclass))
 THEN RAISE EXCEPTION 'Apply admission as workflow schema owner';END IF;
END $preflight$;

DO $predecessors$
BEGIN
 IF md5(pg_get_functiondef('public.acquisition_workflow_start(uuid,text,text,uuid,text)'::regprocedure)) IS DISTINCT FROM '1c68eae09a9a9dd6828c2d2a9d5a84f9' THEN RAISE EXCEPTION 'Unexpected predecessor: acquisition_workflow_start(uuid,text,text,uuid,text)'; END IF;
 IF md5(pg_get_functiondef('public.acquisition_workflow_transition(uuid,integer,text,text)'::regprocedure)) IS DISTINCT FROM '6f3258c50e1d5bd8381a86e57de6e442' THEN RAISE EXCEPTION 'Unexpected predecessor: acquisition_workflow_transition(uuid,integer,text,text)'; END IF;
 IF md5(pg_get_functiondef('public.workflow_source_write_guard()'::regprocedure)) IS DISTINCT FROM '129f18485bca4c931a137720484bbcd2' THEN RAISE EXCEPTION 'Unexpected predecessor: workflow_source_write_guard()'; END IF;
 IF md5(pg_get_functiondef('public.workflow_manual_source_guard()'::regprocedure)) IS DISTINCT FROM 'd59e5f76df19304664c3b778551d9919' THEN RAISE EXCEPTION 'Unexpected predecessor: workflow_manual_source_guard()'; END IF;
 IF md5(pg_get_functiondef('public.workflow_dispatch_guard()'::regprocedure)) IS DISTINCT FROM '7f317b4e2d1cbdd43f8e822ccf7ef55b' THEN RAISE EXCEPTION 'Unexpected predecessor: workflow_dispatch_guard()'; END IF;
 IF md5(pg_get_functiondef('public.agent_lock_send_gate()'::regprocedure)) IS DISTINCT FROM 'ed4309f7336eb68454b17a10f97aa0c3' THEN RAISE EXCEPTION 'Unexpected agent gate prerequisite'; END IF;
END $predecessors$;

CREATE OR REPLACE FUNCTION public.acquisition_workflow_start(p_request uuid, p_preset text, p_presentation text, p_mandate uuid DEFAULT NULL::uuid, p_expected_mandate_revision text DEFAULT NULL::text)
 RETURNS acquisition_workflow_executions
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE org text:=current_setting('app.acquire_org',true);actor text:=current_setting('app.acquire_user',true);
 saved public.acquisition_workflow_executions%ROWTYPE;chosen uuid;candidate record;input_digest text;mandate_revision text;
BEGIN
 IF current_setting('role',true) IS DISTINCT FROM 'acquire_agent_user'
 OR current_setting('app.acquire_workflow_version',true) IS DISTINCT FROM '1'
 OR org IS NULL OR org='' OR actor IS NULL OR actor=''
 OR p_request IS NULL OR p_preset IS NULL OR p_preset NOT IN('demo','live-research-test','live')
 OR p_presentation IS NULL OR p_presentation NOT IN('agent','workspace')
 OR (p_mandate IS NULL AND p_preset<>'demo')
 OR (p_expected_mandate_revision IS NOT NULL AND (p_mandate IS NULL OR p_expected_mandate_revision!~'^[0-9]{1,30}$'))
 THEN RAISE EXCEPTION 'Exact workflow request and supported runtime required' USING ERRCODE='22023';END IF;
 -- Bounded source search is outside the shared policy fence. It is a hint,
 -- not a reservation. Revalidation below locks exactly one candidate and fails
 -- on a race rather than keeping the global gate while scanning more sources.
 IF p_mandate IS NULL AND NOT EXISTS(SELECT 1 FROM public.acquisition_workflow_executions WHERE id=p_request) THEN
  FOR candidate IN
   SELECT m.id FROM public.mandates m WHERE m.organization_id=org AND m.created_by=actor
    AND jsonb_typeof(m.filters->'brief')='object'
    AND NOT EXISTS(SELECT 1 FROM public.acquisition_workflow_executions e WHERE e.mandate_id=m.id AND (e.preset IN('demo','live') OR e.state NOT IN('complete','failed','cancelled')))
    AND EXISTS(SELECT 1 FROM public.research_jobs j WHERE j.mandate_id=m.id AND j.organization_id=org AND j.created_by=actor AND j.status IN('complete','partial'))
   ORDER BY m.created_at DESC,m.id LIMIT 25
  LOOP
   IF public.acquisition_workflow_mandate_unused(candidate.id,org,actor)
    AND public.acquisition_workflow_has_saved_people(candidate.id,org,actor)
   THEN chosen:=candidate.id;EXIT;END IF;
  END LOOP;
  IF chosen IS NULL THEN RAISE EXCEPTION 'No eligible saved mandate in the bounded candidate set' USING ERRCODE='02000';END IF;
 END IF;
 -- Match existing policy-write lock order; all checks and insertion are local.
 PERFORM pg_advisory_xact_lock(7426619361492031::bigint);
 PERFORM public.agent_lock_send_gate();
 PERFORM 1 FROM public.member WHERE organization_id=org AND user_id=actor FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Current organization membership required' USING ERRCODE='42501';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('acquisition-workflow-request:'||p_request::text,0));
 input_digest:=encode(sha256(convert_to(jsonb_build_object('version',1,'preset',p_preset,'presentation',p_presentation,
   'requestedMandateId',p_mandate,'expectedMandateRevision',p_expected_mandate_revision)::text,'UTF8')),'hex');
 SELECT * INTO saved FROM public.acquisition_workflow_executions WHERE id=p_request;
 IF FOUND THEN
  IF saved.organization_id IS DISTINCT FROM org OR saved.owner_user_id IS DISTINCT FROM actor
   OR saved.input_digest IS DISTINCT FROM input_digest OR saved.preset IS DISTINCT FROM p_preset OR saved.presentation IS DISTINCT FROM p_presentation
   OR (p_mandate IS NOT NULL AND saved.mandate_id IS DISTINCT FROM p_mandate)
   OR NOT EXISTS(SELECT 1 FROM public.mandates WHERE id=saved.mandate_id AND organization_id=org AND created_by=actor)
  THEN RAISE EXCEPTION 'Workflow request conflicts with an existing request' USING ERRCODE='23505';END IF;
  -- Do not reselect, reset status or overwrite original work after lost response.
  PERFORM set_config('app.acquire_workflow_execution',saved.id::text,true);
  RETURN saved;
 END IF;
 chosen:=coalesce(p_mandate,chosen);
 SELECT id,xmin::text INTO chosen,mandate_revision FROM public.mandates
  WHERE id=chosen AND organization_id=org AND created_by=actor AND jsonb_typeof(filters->'brief')='object' FOR UPDATE;
 IF chosen IS NULL THEN RAISE EXCEPTION 'Owned mandate with saved brief unavailable' USING ERRCODE='42501';END IF;
 IF p_expected_mandate_revision IS NOT NULL AND p_expected_mandate_revision IS DISTINCT FROM mandate_revision
 THEN RAISE EXCEPTION 'Mandate revision changed' USING ERRCODE='40001';END IF;
 IF NOT public.acquisition_workflow_mandate_unused(chosen,org,actor)
  OR EXISTS(SELECT 1 FROM public.acquisition_workflow_executions WHERE mandate_id=chosen AND (preset IN('demo','live') OR state NOT IN('complete','failed','cancelled')))
 THEN RAISE EXCEPTION 'Selected mandate changed or already has active/outreach work' USING ERRCODE='40001';END IF;
 IF p_preset='demo' AND NOT public.acquisition_workflow_has_saved_people(chosen,org,actor)
 THEN RAISE EXCEPTION 'Selected saved research changed' USING ERRCODE='40001';END IF;
 -- Existing explicit demo creation history must never become a real send scope.
 IF p_preset='live' AND EXISTS(SELECT 1 FROM public.agent_mandate_execution_modes WHERE mandate_id=chosen AND mode='demo')
 THEN RAISE EXCEPTION 'A historical demo mandate cannot become live outreach' USING ERRCODE='55000';END IF;
 INSERT INTO public.acquisition_workflow_executions(id,organization_id,owner_user_id,mandate_id,input_digest,preset,presentation)
 VALUES(p_request,org,actor,chosen,input_digest,p_preset,p_presentation) RETURNING * INTO saved;
 PERFORM set_config('app.acquire_workflow_execution',saved.id::text,true);
 RETURN saved;
END $function$;

CREATE OR REPLACE FUNCTION public.acquisition_workflow_transition(p_execution uuid, p_expected_revision integer, p_state text, p_error_code text DEFAULT NULL::text)
 RETURNS acquisition_workflow_executions
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE org text:=current_setting('app.acquire_org',true);actor text:=current_setting('app.acquire_user',true);
 saved public.acquisition_workflow_executions%ROWTYPE;updated public.acquisition_workflow_executions%ROWTYPE;has_active_research boolean;has_settled_research boolean;stamp timestamptz;
BEGIN
 IF current_setting('role',true) IS DISTINCT FROM 'acquire_agent_user'
 OR current_setting('app.acquire_workflow_version',true) IS DISTINCT FROM '1'
 OR org IS NULL OR org='' OR actor IS NULL OR actor='' OR p_execution IS NULL OR p_expected_revision IS NULL OR p_expected_revision<1
 OR p_state IS NULL OR p_state NOT IN('accepted','researching','ready','outreach','complete','failed','cancelled','uncertain')
 OR (p_error_code IS NOT NULL AND (p_error_code!~'^[a-z][a-z0-9_]{0,79}$' OR p_state NOT IN('failed','uncertain')))
 THEN RAISE EXCEPTION 'Exact workflow transition required' USING ERRCODE='22023';END IF;
 PERFORM pg_advisory_xact_lock(7426619361492031::bigint);
 PERFORM public.agent_lock_send_gate();
 PERFORM 1 FROM public.member WHERE organization_id=org AND user_id=actor FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Current organization membership required' USING ERRCODE='42501';END IF;
 SELECT * INTO saved FROM public.acquisition_workflow_executions WHERE id=p_execution AND organization_id=org AND owner_user_id=actor;
 IF saved.id IS NULL THEN RAISE EXCEPTION 'Owned execution unavailable' USING ERRCODE='42501';END IF;
 PERFORM 1 FROM public.mandates WHERE id=saved.mandate_id AND organization_id=org AND created_by=actor FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Owned mandate unavailable' USING ERRCODE='42501';END IF;
 SELECT * INTO saved FROM public.acquisition_workflow_executions WHERE id=p_execution FOR UPDATE;
 PERFORM set_config('app.acquire_workflow_execution',saved.id::text,true);
 IF saved.revision<>p_expected_revision THEN RAISE EXCEPTION 'Workflow revision changed' USING ERRCODE='40001';END IF;
 IF saved.state=p_state AND saved.error_code IS NOT DISTINCT FROM p_error_code THEN RETURN saved;END IF;
 IF NOT(
  (saved.state='accepted' AND p_state IN('researching','ready','complete','failed','cancelled','uncertain')) OR
  (saved.state='researching' AND p_state IN('ready','complete','failed','cancelled','uncertain')) OR
  (saved.state='ready' AND p_state IN('outreach','complete','failed','cancelled','uncertain')) OR
  (saved.state='outreach' AND p_state IN('complete','uncertain')) OR
  (saved.state='uncertain' AND p_state IN('researching','ready','outreach','complete','failed','cancelled')) OR
  (saved.state IN('failed','cancelled') AND p_state='accepted')
 ) THEN RAISE EXCEPTION 'Invalid workflow transition' USING ERRCODE='55000';END IF;
 IF saved.preset='live-research-test' AND p_state IN('ready','outreach')
  OR saved.preset='demo' AND p_state='researching'
  OR (saved.preset<>'live-research-test' AND saved.state IN('accepted','researching') AND p_state='complete')
 THEN RAISE EXCEPTION 'Preset does not permit this phase' USING ERRCODE='55000';END IF;
 IF EXISTS(SELECT 1 FROM public.acquisition_workflow_executions e WHERE e.mandate_id=saved.mandate_id AND e.id<>saved.id AND
   (e.preset IN('demo','live') OR e.state NOT IN('complete','failed','cancelled')))
 THEN RAISE EXCEPTION 'A later execution owns this mandate' USING ERRCODE='55000';END IF;
 SELECT EXISTS(SELECT 1 FROM public.research_jobs j WHERE j.workflow_execution_id=saved.id AND j.organization_id=org AND j.mandate_id=saved.mandate_id AND j.created_by=actor AND
   (j.status NOT IN('complete','partial','failed','cancelled') OR j.config->'companyPeopleProgress'->>'settled'='false')),
  EXISTS(SELECT 1 FROM public.research_jobs j WHERE j.workflow_execution_id=saved.id AND j.organization_id=org AND j.mandate_id=saved.mandate_id AND j.created_by=actor AND j.status IN('complete','partial') AND j.config->'companyPeopleProgress'->>'settled' IS DISTINCT FROM 'false')
 INTO has_active_research,has_settled_research;
 IF p_state='researching' AND NOT has_active_research
 THEN RAISE EXCEPTION 'Execution has no active research job' USING ERRCODE='55000';END IF;
 IF p_state IN('ready','complete') AND saved.preset<>'demo' AND (has_active_research OR NOT has_settled_research)
 THEN RAISE EXCEPTION 'Execution research has not settled' USING ERRCODE='55000';END IF;
 IF p_state='ready' AND saved.preset='demo' AND NOT public.acquisition_workflow_has_saved_people(saved.mandate_id,org,actor)
 THEN RAISE EXCEPTION 'Saved research is no longer eligible' USING ERRCODE='55000';END IF;
 IF p_state='outreach' AND NOT EXISTS(SELECT 1 FROM public.agent_conversations c WHERE c.workflow_execution_id=saved.id AND c.organization_id=org AND c.owner_user_id=actor AND c.mandate_id=saved.mandate_id)
  AND NOT(saved.preset='live' AND saved.presentation='workspace' AND (
   EXISTS(SELECT 1 FROM public.campaign_enrolments e WHERE e.organization_id=org AND e.mandate_id=saved.mandate_id AND e.workflow_execution_id=saved.id AND e.owner_user_id=actor)
   OR EXISTS(SELECT 1 FROM public.sequence_enrolments e WHERE e.organization_id=org AND e.mandate_id=saved.mandate_id AND e.workflow_execution_id=saved.id)))
 THEN RAISE EXCEPTION 'Execution has no recorded conversations' USING ERRCODE='55000';END IF;
 IF p_state IN('accepted','complete','failed','cancelled') THEN
  IF EXISTS(SELECT 1 FROM public.communication_dispatch_intents i WHERE i.organization_id=org AND i.execution_mandate_id=saved.mandate_id
   AND NOT EXISTS(SELECT 1 FROM public.communication_intent_resolutions r WHERE r.intent_id=i.id)
   AND NOT(i.source_kind='agent' AND EXISTS(SELECT 1 FROM public.agent_operations o WHERE o.id=i.source_id AND o.organization_id=org AND o.workflow_execution_id=saved.id AND o.state='complete' AND o.result->'delivery'->>'status'='submitted'))
   AND NOT(i.source_kind='campaign' AND EXISTS(SELECT 1 FROM public.campaign_send_attempts a JOIN public.campaign_enrolments e ON e.id=a.enrolment_id AND e.organization_id=a.organization_id WHERE a.id=i.source_id AND a.organization_id=org AND e.mandate_id=saved.mandate_id AND e.workflow_execution_id=saved.id AND e.owner_user_id=actor AND a.state='sent' AND a.provider_message_id IS NOT NULL AND a.sent_at IS NOT NULL))
   AND NOT(i.source_kind='draft' AND EXISTS(SELECT 1 FROM public.messages m JOIN public.sequence_enrolments e ON e.id=m.enrolment_id AND e.organization_id=m.organization_id WHERE m.id=i.source_id AND m.organization_id=org AND e.mandate_id=saved.mandate_id AND e.workflow_execution_id=saved.id AND m.state='sent' AND m.provider_message_id IS NOT NULL AND m.sent_at IS NOT NULL)))
   OR EXISTS(SELECT 1 FROM public.agent_linkedin_invitations i JOIN public.agent_conversations c ON c.id=i.conversation_id AND c.organization_id=i.organization_id WHERE c.workflow_execution_id=saved.id AND i.state='unknown')
  THEN RAISE EXCEPTION 'Original dispatch outcome remains unresolved' USING ERRCODE='55000';END IF;
  IF EXISTS(SELECT 1 FROM public.campaign_enrolments e WHERE e.organization_id=org AND e.mandate_id=saved.mandate_id AND e.state NOT IN('completed','stopped'))
   OR EXISTS(SELECT 1 FROM public.sequence_enrolments e WHERE e.organization_id=org AND e.mandate_id=saved.mandate_id AND e.state::text NOT IN('completed','stopped'))
   OR EXISTS(SELECT 1 FROM public.campaign_send_attempts a JOIN public.campaign_enrolments e ON e.id=a.enrolment_id AND e.organization_id=a.organization_id WHERE e.organization_id=org AND e.mandate_id=saved.mandate_id AND a.state IN('claimed','unknown'))
   OR EXISTS(SELECT 1 FROM public.messages m JOIN public.sequence_enrolments e ON e.id=m.enrolment_id AND e.organization_id=m.organization_id WHERE e.organization_id=org AND e.mandate_id=saved.mandate_id AND m.state IN('approved','queued'))
  THEN RAISE EXCEPTION 'Manual outreach remains active or unresolved' USING ERRCODE='55000';END IF;
  IF has_active_research OR EXISTS(SELECT 1 FROM public.agent_operations o WHERE o.workflow_execution_id=saved.id AND o.state IN('running','uncertain'))
   OR EXISTS(SELECT 1 FROM public.agent_conversations c WHERE c.workflow_execution_id=saved.id AND (c.phase IN('quiescing','held') OR (c.phase<>'complete' AND c.driver_kind<>'human')))
   OR (p_state='complete' AND EXISTS(SELECT 1 FROM public.agent_operations o WHERE o.workflow_execution_id=saved.id AND o.name~'^(email|whatsapp|linkedin)[.]' AND o.state IN('proposed','approved')))
  THEN RAISE EXCEPTION 'Execution still has active or unresolved work' USING ERRCODE='55000';END IF;
  IF p_state IN('accepted','failed','cancelled') AND (EXISTS(SELECT 1 FROM public.agent_conversations c WHERE c.workflow_execution_id=saved.id)
   OR EXISTS(SELECT 1 FROM public.campaign_enrolments WHERE mandate_id=saved.mandate_id AND organization_id=org)
   OR EXISTS(SELECT 1 FROM public.sequence_enrolments WHERE mandate_id=saved.mandate_id AND organization_id=org)
   OR EXISTS(SELECT 1 FROM public.communication_dispatch_intents i WHERE i.execution_mandate_id=saved.mandate_id AND i.organization_id=org))
  THEN RAISE EXCEPTION 'Outreach execution cannot be reset or released' USING ERRCODE='55000';END IF;
 END IF;
 IF saved.preset='live-research-test' AND EXISTS(SELECT 1 FROM public.agent_conversations WHERE mandate_id=saved.mandate_id AND organization_id=org)
 THEN RAISE EXCEPTION 'Research-only execution has prohibited outreach state' USING ERRCODE='55000';END IF;
 stamp:=greatest(clock_timestamp(),saved.updated_at);
 UPDATE public.acquisition_workflow_executions SET state=p_state,error_code=p_error_code,revision=revision+1,updated_at=stamp,
  finished_at=CASE WHEN p_state IN('complete','failed','cancelled') THEN stamp ELSE NULL END
 WHERE id=saved.id RETURNING * INTO updated;
 RETURN updated;
END $function$;

CREATE OR REPLACE FUNCTION public.workflow_source_write_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE w public.acquisition_workflow_executions%ROWTYPE; actor text; requested uuid; managed boolean;
BEGIN
 actor:=CASE WHEN TG_TABLE_NAME='research_jobs' THEN to_jsonb(NEW)->>'created_by' ELSE to_jsonb(NEW)->>'owner_user_id' END;
 IF TG_OP='UPDATE' AND (OLD.workflow_execution_id IS DISTINCT FROM NEW.workflow_execution_id OR OLD.mandate_id IS DISTINCT FROM NEW.mandate_id OR OLD.organization_id IS DISTINCT FROM NEW.organization_id) THEN
  IF OLD.workflow_execution_id IS NOT NULL OR NEW.workflow_execution_id IS NOT NULL THEN RAISE EXCEPTION 'Workflow effect association is immutable';END IF;
 END IF;
 -- New sources and explicit reactivation serialize against reservation. Ordinary
 -- immutable-identity bookkeeping does not introduce another row lock.
 IF TG_TABLE_NAME IN('agent_conversations','agent_operations') THEN
  IF EXISTS(SELECT 1 FROM public.communication_member_fence WHERE singleton AND writer_xid=txid_current()) AND NOT EXISTS(SELECT 1 FROM public.communication_send_gates WHERE organization_id=NEW.organization_id AND writer_xid=txid_current()) THEN PERFORM public.communications_lock_send_gate(NEW.organization_id);END IF;
  IF NOT EXISTS(SELECT 1 FROM public.communication_send_gates WHERE organization_id=NEW.organization_id AND writer_xid=txid_current()) THEN RAISE EXCEPTION 'Organization gate must precede workflow source lock';END IF;
 END IF;
 IF TG_OP='INSERT' OR (TG_OP='UPDATE' AND (OLD.mandate_id IS DISTINCT FROM NEW.mandate_id OR OLD.organization_id IS DISTINCT FROM NEW.organization_id OR to_jsonb(OLD)->>'name' IS DISTINCT FROM to_jsonb(NEW)->>'name')) OR (TG_OP='UPDATE' AND ((TG_TABLE_NAME='research_jobs' AND to_jsonb(OLD)->>'status' IN('complete','partial','failed','cancelled') AND to_jsonb(NEW)->>'status' NOT IN('complete','partial','failed','cancelled')) OR (TG_TABLE_NAME='agent_events' AND to_jsonb(OLD)->>'state' IN('done') AND to_jsonb(NEW)->>'state' NOT IN('done')))) THEN
  IF TG_OP='UPDATE' THEN PERFORM 1 FROM public.mandates WHERE id IN(NEW.mandate_id,OLD.mandate_id) ORDER BY id FOR UPDATE; ELSE PERFORM 1 FROM public.mandates WHERE id=NEW.mandate_id AND organization_id=NEW.organization_id FOR UPDATE;END IF;
 END IF;
 managed:=EXISTS(SELECT 1 FROM public.acquisition_workflow_executions WHERE mandate_id=NEW.mandate_id);
 IF NOT managed THEN
  IF NEW.workflow_execution_id IS NOT NULL THEN RAISE EXCEPTION 'Workflow association unavailable';END IF;
  RETURN NEW;
 END IF;
 IF TG_OP='UPDATE' AND OLD.workflow_execution_id IS NULL THEN
  -- Old completed research evidence may be read but not reactivated/reparented.
  IF TG_TABLE_NAME='research_jobs' AND to_jsonb(OLD)->>'status' IN('complete','partial','failed','cancelled') AND to_jsonb(NEW)->>'status'=to_jsonb(OLD)->>'status' AND to_jsonb(NEW)=to_jsonb(OLD) THEN RETURN NEW;END IF;
  -- A late event may be retired; it cannot be leased or converted into new work.
  IF TG_TABLE_NAME='agent_events' AND to_jsonb(NEW)->>'state' IN('done') AND to_jsonb(OLD)->>'state'<> 'leased'
    AND to_jsonb(NEW)-ARRAY['state','lease_owner','lease_until'] = to_jsonb(OLD)-ARRAY['state','lease_owner','lease_until'] THEN RETURN NEW;END IF;
  RAISE EXCEPTION 'Historical work cannot acquire new workflow authority';
 END IF;
 IF current_setting('app.acquire_workflow_version',true) IS DISTINCT FROM '1'
 OR nullif(current_setting('app.acquire_workflow_execution',true),'') IS NULL THEN RAISE EXCEPTION 'Explicit workflow-capable writer required';END IF;
 requested:=current_setting('app.acquire_workflow_execution',true)::uuid;
 IF NEW.workflow_execution_id IS NULL AND TG_OP='INSERT' THEN NEW.workflow_execution_id:=requested;END IF;
 SELECT * INTO w FROM public.acquisition_workflow_executions WHERE id=NEW.workflow_execution_id AND mandate_id=NEW.mandate_id AND organization_id=NEW.organization_id AND owner_user_id=actor;
 IF w.id IS NULL OR w.id<>requested OR actor IS DISTINCT FROM current_setting('app.acquire_user',true) OR NEW.organization_id IS DISTINCT FROM current_setting('app.acquire_org',true)
 OR NOT EXISTS(SELECT 1 FROM public.member WHERE organization_id=w.organization_id AND user_id=w.owner_user_id) THEN RAISE EXCEPTION 'Exact current owned workflow association required';END IF;
 IF TG_OP='INSERT' AND w.state IN('complete','failed','cancelled','uncertain') AND NOT (TG_TABLE_NAME='agent_events' AND to_jsonb(NEW)->>'kind'='conversation.history_changed' AND w.preset IN('demo','live')) THEN RAISE EXCEPTION 'Terminal or uncertain workflow cannot create work';END IF;
 IF TG_OP='UPDATE' AND w.state IN('complete','failed','cancelled','uncertain') THEN
  IF TG_TABLE_NAME='research_jobs' AND to_jsonb(NEW)->>'status' NOT IN('complete','partial','failed','cancelled') THEN RAISE EXCEPTION 'Terminal workflow cannot reactivate research';END IF;
  IF TG_TABLE_NAME='agent_events' AND to_jsonb(NEW)->>'state'<>'done' AND NOT (to_jsonb(NEW)->>'kind'='conversation.history_changed' AND w.preset IN('demo','live')) THEN RAISE EXCEPTION 'Terminal workflow cannot reactivate event';END IF;
  IF TG_TABLE_NAME='agent_operations' AND to_jsonb(NEW)->>'state' NOT IN('complete','failed','cancelled','rejected','uncertain') THEN RAISE EXCEPTION 'Terminal workflow cannot reactivate operation';END IF;
  IF TG_TABLE_NAME='agent_conversations' AND ((to_jsonb(NEW)->>'driver_kind'='agent' AND to_jsonb(OLD)->>'driver_kind'<>'agent') OR (to_jsonb(NEW)->>'phase'='active' AND to_jsonb(OLD)->>'phase'<>'active') OR (to_jsonb(OLD)->>'phase'='complete' AND to_jsonb(NEW)->>'phase'<>'complete')) THEN RAISE EXCEPTION 'Terminal workflow cannot reactivate conversation';END IF;
 END IF;
 IF TG_TABLE_NAME='research_jobs' THEN
  IF w.preset='demo' THEN RAISE EXCEPTION 'Saved demo cannot start live research';END IF;
 ELSIF TG_TABLE_NAME='agent_conversations' THEN
  IF w.preset='live-research-test' OR TG_OP='INSERT' AND w.state NOT IN('ready','outreach') THEN RAISE EXCEPTION 'Execution cannot create outreach conversations';END IF;
 ELSIF TG_TABLE_NAME='agent_operations' THEN
  IF NEW.conversation_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.agent_conversations c WHERE c.id=NEW.conversation_id AND c.workflow_execution_id=w.id AND c.organization_id=w.organization_id AND c.owner_user_id=w.owner_user_id) THEN RAISE EXCEPTION 'Conversation belongs to another workflow';END IF;
  IF w.preset='live-research-test' AND (NEW.conversation_id IS NOT NULL OR NEW.name!~'^research[.]') THEN RAISE EXCEPTION 'Research-only execution cannot create outreach operations';END IF;
 ELSIF TG_TABLE_NAME='agent_events' THEN
  IF NEW.payload ? 'conversationId' OR NEW.kind='conversation.history_changed' THEN
   IF NOT EXISTS(SELECT 1 FROM public.agent_conversations c WHERE c.id::text=NEW.payload->>'conversationId' AND c.workflow_execution_id=w.id AND c.mandate_id=w.mandate_id AND c.organization_id=w.organization_id AND c.owner_user_id=w.owner_user_id) THEN RAISE EXCEPTION 'Event conversation belongs to another workflow';END IF;
  END IF;
  IF w.preset='live-research-test' AND NEW.kind NOT IN('control.changed','research.completed','research.failed','research.requested','research.continue','research.people.completed','research.people.failed') THEN RAISE EXCEPTION 'Research-only execution cannot schedule outreach';END IF;
 ELSE RAISE EXCEPTION 'Unsupported workflow write source';END IF;
 RETURN NEW;
END $function$;

CREATE OR REPLACE FUNCTION public.workflow_manual_source_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE mandate uuid;org text;old_mandate uuid;execution uuid;w public.acquisition_workflow_executions%ROWTYPE;managed boolean;
BEGIN
 IF TG_TABLE_NAME IN('sequence_enrolments','campaign_enrolments') THEN
  mandate:=NEW.mandate_id;org:=NEW.organization_id;execution:=NEW.workflow_execution_id;
  IF TG_OP='UPDATE' THEN
   old_mandate:=OLD.mandate_id;
   IF (OLD.workflow_execution_id IS NOT NULL OR NEW.workflow_execution_id IS NOT NULL) AND (OLD.workflow_execution_id IS DISTINCT FROM NEW.workflow_execution_id OR OLD.mandate_id IS DISTINCT FROM NEW.mandate_id OR OLD.organization_id IS DISTINCT FROM NEW.organization_id) THEN RAISE EXCEPTION 'Manual workflow association is immutable';END IF;
  END IF;
 ELSIF TG_TABLE_NAME='messages' THEN
  SELECT e.mandate_id,e.organization_id,e.workflow_execution_id INTO mandate,org,execution FROM public.sequence_enrolments e WHERE e.id=NEW.enrolment_id AND e.organization_id=NEW.organization_id;
  IF TG_OP='UPDATE' THEN
   SELECT e.mandate_id INTO old_mandate FROM public.sequence_enrolments e WHERE e.id=OLD.enrolment_id AND e.organization_id=OLD.organization_id;
   IF (execution IS NOT NULL OR EXISTS(SELECT 1 FROM public.acquisition_workflow_executions WHERE mandate_id=old_mandate)) AND NEW.enrolment_id IS DISTINCT FROM OLD.enrolment_id THEN RAISE EXCEPTION 'Workflow draft origin is immutable';END IF;
  END IF;
 ELSE RAISE EXCEPTION 'Unsupported manual workflow source';END IF;
 -- Statement policy fence precedes this trigger. Take its organization gate
 -- before the mandate reservation row, matching workflow admission lock order.
 IF EXISTS(SELECT 1 FROM public.communication_member_fence WHERE singleton AND writer_xid=txid_current()) AND NOT EXISTS(SELECT 1 FROM public.communication_send_gates WHERE organization_id=org AND writer_xid=txid_current()) THEN PERFORM public.communications_lock_send_gate(org);END IF;
 IF NOT EXISTS(SELECT 1 FROM public.communication_send_gates WHERE organization_id=org AND writer_xid=txid_current()) THEN RAISE EXCEPTION 'Organization gate must precede workflow source lock';END IF;
 IF TG_OP='INSERT' OR old_mandate IS DISTINCT FROM mandate THEN PERFORM 1 FROM public.mandates WHERE id IN(mandate,old_mandate) ORDER BY id FOR UPDATE;END IF;
 managed:=EXISTS(SELECT 1 FROM public.acquisition_workflow_executions WHERE mandate_id IN(mandate,old_mandate));
 IF NOT managed THEN
  IF execution IS NOT NULL THEN RAISE EXCEPTION 'Manual workflow unavailable';END IF;
  RETURN NEW;
 END IF;
 IF TG_OP='INSERT' AND TG_TABLE_NAME IN('sequence_enrolments','campaign_enrolments') AND execution IS NULL THEN
  execution:=nullif(current_setting('app.acquire_workflow_execution',true),'')::uuid;NEW.workflow_execution_id:=execution;
 END IF;
 SELECT * INTO w FROM public.acquisition_workflow_executions WHERE id=execution AND mandate_id=mandate AND organization_id=org;
 IF w.id IS NULL OR w.preset<>'live' OR w.presentation<>'workspace'
 OR current_setting('app.acquire_workflow_version',true) IS DISTINCT FROM '1'
 OR current_setting('app.acquire_workflow_execution',true) IS DISTINCT FROM w.id::text
 OR current_setting('app.acquire_user',true) IS DISTINCT FROM w.owner_user_id OR current_setting('app.acquire_org',true) IS DISTINCT FROM w.organization_id
 OR NOT EXISTS(SELECT 1 FROM public.member WHERE organization_id=w.organization_id AND user_id=w.owner_user_id)
 THEN RAISE EXCEPTION 'Only exact live workspace execution permits manual outreach';END IF;
 IF TG_TABLE_NAME='campaign_enrolments' AND to_jsonb(NEW)->>'owner_user_id' IS DISTINCT FROM w.owner_user_id THEN RAISE EXCEPTION 'Manual workflow owner differs';END IF;
 IF TG_OP='INSERT' AND w.state NOT IN('ready','outreach') THEN RAISE EXCEPTION 'Workflow is not ready for manual outreach';END IF;
 IF TG_OP='UPDATE' AND w.state IN('complete','failed','cancelled','uncertain') AND to_jsonb(NEW)->>'state' IS DISTINCT FROM to_jsonb(OLD)->>'state' AND to_jsonb(NEW)->>'state' NOT IN('sent','complete','completed','failed','cancelled','stopped','replied') THEN RAISE EXCEPTION 'Terminal workflow cannot reactivate manual outreach';END IF;
 RETURN NEW;
END $function$;

CREATE OR REPLACE FUNCTION public.workflow_dispatch_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE intent public.communication_dispatch_intents%ROWTYPE;mandate uuid;execution uuid;w public.acquisition_workflow_executions%ROWTYPE;
BEGIN
 IF TG_TABLE_NAME='communication_dispatch_intents' THEN intent:=NEW;
 ELSE SELECT * INTO intent FROM public.communication_dispatch_intents WHERE id=NEW.intent_id;END IF;
 mandate:=public.agent_origin_mandate(intent.source_kind,intent.source_id);
 IF mandate IS NULL THEN RETURN NEW;END IF;
 IF EXISTS(SELECT 1 FROM public.communication_member_fence WHERE singleton AND writer_xid=txid_current()) AND NOT EXISTS(SELECT 1 FROM public.communication_send_gates WHERE organization_id=intent.organization_id AND writer_xid=txid_current()) THEN PERFORM public.communications_lock_send_gate(intent.organization_id);END IF;
 IF NOT EXISTS(SELECT 1 FROM public.communication_send_gates WHERE organization_id=intent.organization_id AND writer_xid=txid_current()) THEN RAISE EXCEPTION 'Held organization gate required before dispatch source lock';END IF;
 PERFORM 1 FROM public.mandates WHERE id=mandate FOR UPDATE;
 IF NOT EXISTS(SELECT 1 FROM public.acquisition_workflow_executions WHERE mandate_id=mandate) THEN RETURN NEW;END IF;
 IF intent.source_kind='agent' THEN
  SELECT o.workflow_execution_id INTO execution FROM public.agent_operations o WHERE o.id=intent.source_id AND o.organization_id=intent.organization_id AND o.owner_user_id=intent.owner_user_id AND o.mandate_id=mandate;
 ELSIF intent.source_kind='campaign' THEN
  SELECT e.workflow_execution_id INTO execution FROM public.campaign_send_attempts a JOIN public.campaign_enrolments e ON e.id=a.enrolment_id AND e.organization_id=a.organization_id WHERE a.id=intent.source_id AND e.organization_id=intent.organization_id AND e.owner_user_id=intent.owner_user_id AND e.mandate_id=mandate;
 ELSIF intent.source_kind='draft' THEN
  SELECT e.workflow_execution_id INTO execution FROM public.messages m JOIN public.sequence_enrolments e ON e.id=m.enrolment_id AND e.organization_id=m.organization_id WHERE m.id=intent.source_id AND e.organization_id=intent.organization_id AND e.mandate_id=mandate;
 END IF;
 SELECT * INTO w FROM public.acquisition_workflow_executions WHERE id=execution AND mandate_id=mandate AND organization_id=intent.organization_id AND owner_user_id=intent.owner_user_id;
 IF w.id IS NULL OR w.preset='live-research-test' OR w.state NOT IN('ready','outreach')
 OR intent.source_kind<>'agent' AND (w.preset<>'live' OR w.presentation<>'workspace')
 OR current_setting('app.acquire_workflow_version',true) IS DISTINCT FROM '1'
 OR current_setting('app.acquire_workflow_execution',true) IS DISTINCT FROM w.id::text
 OR current_setting('app.acquire_org',true) IS DISTINCT FROM w.organization_id OR current_setting('app.acquire_user',true) IS DISTINCT FROM w.owner_user_id
 OR NOT EXISTS(SELECT 1 FROM public.member WHERE organization_id=w.organization_id AND user_id=w.owner_user_id)
 THEN RAISE EXCEPTION 'Exact active outreach workflow required for new dispatch';END IF;
 RETURN NEW;
END $function$;
COMMIT;
