-- WF-02 proposed only. Requires reviewed 001 and 002; never run independently.
-- No provider traffic, mandate creation, research dispatch or outreach approval.
-- Caller commits this short transaction before invoking any external work.

BEGIN;
SET LOCAL lock_timeout='3s';
SET LOCAL statement_timeout='15s';
DO $preflight$
DECLARE system_id text;marker text;
BEGIN
 SELECT system_identifier::text INTO system_id FROM pg_catalog.pg_control_system();
 SELECT pg_catalog.shobj_description(oid,'pg_database') INTO marker FROM pg_catalog.pg_database WHERE datname=current_database();
 IF ((current_database()='postgres' AND system_id='7678071634733212629')
  OR (current_database()='acquire_hosted_demo_rehearsal' AND system_id='7699248227334438947' AND marker='acquire-hosted-demo-rehearsal-only')) IS NOT TRUE
 THEN RAISE EXCEPTION 'Unapproved workflow database target';END IF;
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

CREATE FUNCTION public.acquisition_workflow_mandate_unused(p_mandate uuid,p_org text,p_actor text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT p_org=current_setting('app.acquire_org',true)
 AND p_actor=current_setting('app.acquire_user',true)
 AND EXISTS(SELECT 1 FROM public.member WHERE organization_id=p_org AND user_id=p_actor)
 AND EXISTS(SELECT 1 FROM public.mandates WHERE id=p_mandate AND organization_id=p_org AND created_by=p_actor)
 AND NOT EXISTS(SELECT 1 FROM public.agent_conversations WHERE mandate_id=p_mandate AND organization_id=p_org)
 AND NOT EXISTS(SELECT 1 FROM public.campaign_enrolments WHERE mandate_id=p_mandate AND organization_id=p_org)
 AND NOT EXISTS(SELECT 1 FROM public.sequence_enrolments WHERE mandate_id=p_mandate AND organization_id=p_org)
 AND NOT EXISTS(SELECT 1 FROM public.agent_operations WHERE mandate_id=p_mandate AND organization_id=p_org AND (name~'^(email|whatsapp|linkedin)[.]' OR state IN('running','uncertain')))
 AND NOT EXISTS(SELECT 1 FROM public.communication_dispatch_intents WHERE execution_mandate_id=p_mandate AND organization_id=p_org)
 AND NOT EXISTS(SELECT 1 FROM public.agent_demo_mapping_requests WHERE mandate_id=p_mandate AND organization_id=p_org)
 AND NOT EXISTS(SELECT 1 FROM public.agent_demo_contact_mappings WHERE mandate_id=p_mandate AND organization_id=p_org)
 AND NOT EXISTS(SELECT 1 FROM public.research_jobs WHERE mandate_id=p_mandate AND organization_id=p_org
   AND (status NOT IN('complete','partial','failed','cancelled') OR config->'companyPeopleProgress'->>'settled'='false'))
 AND NOT EXISTS(SELECT 1 FROM public.agent_events WHERE mandate_id=p_mandate AND organization_id=p_org AND state IN('pending','leased'));
$$;
REVOKE ALL ON FUNCTION public.acquisition_workflow_mandate_unused(uuid,text,text) FROM PUBLIC,acquire_agent_user,acquire_campaign_user,anon,authenticated,service_role;

-- Source eligibility is not outreach eligibility. Keep this bounded EXISTS
-- cheap; canonical aliases, unresolved effects, fit, suppression and history
-- authority stay in the normal contact-selection/admission modules. A source
-- can consequently open with no contacts eligible for outreach after review.
CREATE FUNCTION public.acquisition_workflow_has_saved_people(p_mandate uuid,p_org text,p_actor text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT p_org=current_setting('app.acquire_org',true)
 AND p_actor=current_setting('app.acquire_user',true)
 AND EXISTS(SELECT 1 FROM public.member WHERE organization_id=p_org AND user_id=p_actor)
 AND EXISTS(SELECT 1 FROM public.mandates WHERE id=p_mandate AND organization_id=p_org AND created_by=p_actor)
 AND EXISTS(SELECT 1 FROM public.research_jobs WHERE mandate_id=p_mandate AND organization_id=p_org AND created_by=p_actor AND status IN('complete','partial'))
 AND EXISTS(
  SELECT 1 FROM public.mandate_targets mt
  JOIN public.targets t ON t.id=mt.target_id AND t.organization_id=mt.organization_id
  JOIN public.contacts c ON c.target_id=t.id AND c.organization_id=t.organization_id
  WHERE mt.mandate_id=p_mandate AND mt.organization_id=p_org
   AND c.fictionalised=false AND c.firmable_person_id IS NOT NULL
   AND coalesce(c.personal_data->>'doNotContact','false')='false'
   AND coalesce(t.firmable_company_id,t.identifiers->>'firmableId','')~'^f[0-9]+$'
   AND NOT(t.firmable_company_id IS NOT NULL AND t.identifiers->>'firmableId' IS NOT NULL AND t.firmable_company_id<>t.identifiers->>'firmableId')
   AND NOT(t.firmographics ? 'offlineFixture')
   AND NOT EXISTS(SELECT 1 FROM public.company_identity_claims claim WHERE claim.organization_id=p_org AND claim.identity_key='firmable:'||coalesce(t.firmable_company_id,t.identifiers->>'firmableId') AND claim.target_id<>t.id)
   AND NOT EXISTS(SELECT 1 FROM public.agent_person_claims claim JOIN public.agent_conversations owned ON owned.id=claim.conversation_id AND owned.organization_id=claim.organization_id WHERE claim.organization_id=p_org AND owned.contact_id=c.id)
   AND NOT EXISTS(SELECT 1 FROM public.campaign_enrolments e WHERE e.organization_id=p_org AND e.contact_id=c.id AND e.state IN('active','paused','needs_review'))
   AND NOT EXISTS(SELECT 1 FROM public.sequence_enrolments e WHERE e.organization_id=p_org AND e.contact_id=c.id AND e.state::text NOT IN('completed','stopped'))
 );
$$;
REVOKE ALL ON FUNCTION public.acquisition_workflow_has_saved_people(uuid,text,text) FROM PUBLIC,acquire_agent_user,acquire_campaign_user,anon,authenticated,service_role;

-- p_mandate is required for live/live-research-test; normal server creation may
-- insert its mandate in this same transaction first. NULL selects saved demo
-- automatically. Candidate page is bounded; no eligible source is a 02000 error,
-- never a fallback to live research. Application validates the full brief schema.
CREATE FUNCTION public.acquisition_workflow_start(
 p_request uuid,p_preset text,p_presentation text,p_mandate uuid DEFAULT NULL,
 p_expected_mandate_revision text DEFAULT NULL
) RETURNS public.acquisition_workflow_executions
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
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
 PERFORM public.communications_lock_send_gate(org);
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
END $$;
REVOKE ALL ON FUNCTION public.acquisition_workflow_start(uuid,text,text,uuid,text) FROM PUBLIC,acquire_agent_user,acquire_campaign_user,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.acquisition_workflow_start(uuid,text,text,uuid,text) TO acquire_agent_user;

-- State projection/transition is not outreach approval. Existing reviewed
-- contacts, binding/coverage checks and dispatch permit checks remain mandatory.
CREATE FUNCTION public.acquisition_workflow_transition(p_execution uuid,p_expected_revision integer,p_state text,p_error_code text DEFAULT NULL)
RETURNS public.acquisition_workflow_executions
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
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
 PERFORM public.communications_lock_send_gate(org);
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
END $$;
REVOKE ALL ON FUNCTION public.acquisition_workflow_transition(uuid,integer,text,text) FROM PUBLIC,acquire_agent_user,acquire_campaign_user,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.acquisition_workflow_transition(uuid,integer,text,text) TO acquire_agent_user;

COMMIT;
