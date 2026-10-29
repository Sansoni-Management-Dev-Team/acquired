-- PREPARED ONLY. Execute only on the explicitly approved rehearsal after 001-003.
-- No DDL, trigger disabling, provider traffic or persistent fixtures. All writes
-- (including normal organization admission-gate bookkeeping) are rolled back.
BEGIN;
SET LOCAL lock_timeout='3s';
SET LOCAL statement_timeout='20s';
DO $target$
BEGIN
 IF current_database() IS DISTINCT FROM 'acquire_hosted_demo_rehearsal'
 OR shobj_description((SELECT oid FROM pg_database WHERE datname=current_database()),'pg_database')
    IS DISTINCT FROM 'acquire-hosted-demo-rehearsal-only'
 OR (SELECT system_identifier::text FROM pg_catalog.pg_control_system())
    IS DISTINCT FROM '7699248227334438947'
 THEN RAISE EXCEPTION 'Exact isolated workflow rehearsal database and cluster required';END IF;
 IF current_user IS DISTINCT FROM pg_get_userbyid((SELECT relowner FROM pg_class WHERE oid='public.acquisition_workflow_executions'::regclass))
 THEN RAISE EXCEPTION 'Run admission assertions as workflow schema owner';END IF;
END $target$;

DO $admission_tests$
DECLARE
 org text:=gen_random_uuid()::text;
 actor text:=gen_random_uuid()::text;
 other_actor text:=gen_random_uuid()::text;
 mandate uuid:=gen_random_uuid();
 spare_mandate uuid:=gen_random_uuid();
 request_id uuid:=gen_random_uuid();
 mandate_revision text;
 saved public.acquisition_workflow_executions%ROWTYPE;
 replay public.acquisition_workflow_executions%ROWTYPE;
 denied boolean;
 observed_message text;
BEGIN
 -- Schema-only rehearsal omits the baseline singleton data; seed transactionally.
 INSERT INTO public.communication_member_fence(singleton,writer_xid) VALUES(true,0) ON CONFLICT DO NOTHING;
 INSERT INTO public."user"(id,name,email) VALUES
  (actor,'Admission rehearsal owner',actor||'@example.invalid'),
  (other_actor,'Admission rehearsal other member',other_actor||'@example.invalid');
 INSERT INTO public.organization(id,name,slug) VALUES(org,'Admission rehearsal',org);
 INSERT INTO public.member(id,organization_id,user_id,role) VALUES
  (gen_random_uuid()::text,org,actor,'member'),
  (gen_random_uuid()::text,org,other_actor,'member');
 INSERT INTO public.mandates(id,organization_id,created_by,natural_language,filters,provenance) VALUES
  (mandate,org,actor,'Synthetic live research test','{"brief":{}}','{}'),
  (spare_mandate,org,actor,'Synthetic spare live research test','{"brief":{}}','{}');
 SELECT xmin::text INTO mandate_revision FROM public.mandates WHERE id=mandate;
 SET LOCAL ROLE acquire_agent_user;
 PERFORM set_config('app.acquire_org',org,true);
 PERFORM set_config('app.acquire_user',actor,true);
 PERFORM set_config('app.acquire_workflow_version','1',true);

 SELECT * INTO saved FROM public.acquisition_workflow_start(
  request_id,'live-research-test','agent',mandate,mandate_revision);
 IF saved.id IS DISTINCT FROM request_id OR saved.mandate_id IS DISTINCT FROM mandate
 OR saved.owner_user_id IS DISTINCT FROM actor OR saved.organization_id IS DISTINCT FROM org
 OR saved.preset IS DISTINCT FROM 'live-research-test' OR saved.state IS DISTINCT FROM 'accepted'
 OR saved.revision IS DISTINCT FROM 1 OR saved.finished_at IS NOT NULL THEN
  RAISE EXCEPTION 'Accepted execution did not preserve its exact request/source/owner';
 END IF;
 IF current_setting('app.acquire_workflow_execution',true) IS DISTINCT FROM request_id::text THEN
  RAISE EXCEPTION 'Admission did not establish exact execution context';
 END IF;

 -- Simulate a lost HTTP response and later retry with no current execution GUC.
 PERFORM set_config('app.acquire_workflow_execution','',true);
 SELECT * INTO replay FROM public.acquisition_workflow_start(
  request_id,'live-research-test','agent',mandate,mandate_revision);
 IF to_jsonb(saved) IS DISTINCT FROM to_jsonb(replay)
 OR current_setting('app.acquire_workflow_execution',true) IS DISTINCT FROM request_id::text THEN
  RAISE EXCEPTION 'Exact retry mutated/reselected the execution or failed to restore context';
 END IF;
 IF (SELECT count(*) FROM public.acquisition_workflow_executions WHERE organization_id=org)<>1 THEN
  RAISE EXCEPTION 'Retry created a second execution';
 END IF;

 denied:=false;
 BEGIN
  PERFORM public.acquisition_workflow_start(request_id,'live','agent',mandate,mandate_revision);
 EXCEPTION WHEN SQLSTATE '23505' THEN denied:=true;
 END;
 IF NOT denied THEN RAISE EXCEPTION 'Conflicting preset reused an immutable request';END IF;

 denied:=false;
 BEGIN
  PERFORM public.acquisition_workflow_start(gen_random_uuid(),'live-research-test','agent',mandate,mandate_revision);
 EXCEPTION WHEN SQLSTATE '40001' THEN denied:=true;
 END;
 IF NOT denied THEN RAISE EXCEPTION 'Second active request took an occupied mandate';END IF;

 PERFORM set_config('app.acquire_user',other_actor,true);
 denied:=false;
 BEGIN
  PERFORM public.acquisition_workflow_start(gen_random_uuid(),'live-research-test','agent',mandate,mandate_revision);
 EXCEPTION WHEN SQLSTATE '42501' THEN denied:=true;
 END;
 IF NOT denied THEN RAISE EXCEPTION 'Another same-organization member started the owned mandate';END IF;
 denied:=false;
 BEGIN
  PERFORM public.acquisition_workflow_start(request_id,'live-research-test','agent',mandate,mandate_revision);
 EXCEPTION WHEN SQLSTATE '23505' THEN denied:=true;
 END;
 IF NOT denied THEN RAISE EXCEPTION 'Another member replayed the owned request';END IF;
 PERFORM set_config('app.acquire_user',actor,true);

 PERFORM set_config('app.acquire_workflow_version','0',true);
 denied:=false;
 BEGIN
  PERFORM public.acquisition_workflow_start(gen_random_uuid(),'live-research-test','workspace',spare_mandate);
 EXCEPTION WHEN SQLSTATE '22023' THEN denied:=true;
 END;
 IF NOT denied THEN RAISE EXCEPTION 'Unsupported runtime admitted workflow state';END IF;
 PERFORM set_config('app.acquire_workflow_version','1',true);

 denied:=false;
 BEGIN
  PERFORM public.acquisition_workflow_transition(request_id,1,'outreach');
 EXCEPTION WHEN SQLSTATE '55000' THEN denied:=true;
 END;
 IF NOT denied THEN RAISE EXCEPTION 'Research-only execution entered outreach';END IF;
 denied:=false;
 BEGIN
  PERFORM public.acquisition_workflow_transition(request_id,1,'complete');
 EXCEPTION WHEN SQLSTATE '55000' THEN
  GET STACKED DIAGNOSTICS observed_message=MESSAGE_TEXT;
  IF observed_message IS DISTINCT FROM 'Execution research has not settled' THEN
   RAISE EXCEPTION 'Missing-research completion was denied for an unexpected reason: %',observed_message;
  END IF;
  denied:=true;
 END;
 IF NOT denied THEN RAISE EXCEPTION 'Research-only execution completed without a saved settled job';END IF;

 SELECT * INTO replay FROM public.acquisition_workflow_executions WHERE id=request_id;
 IF to_jsonb(saved) IS DISTINCT FROM to_jsonb(replay) THEN
  RAISE EXCEPTION 'Rejected transitions changed accepted execution state';
 END IF;
 RESET ROLE;
 IF (SELECT count(*) FROM public.acquisition_workflow_executions WHERE organization_id=org)<>1
 OR EXISTS(SELECT 1 FROM public.research_jobs WHERE organization_id=org)
 OR EXISTS(SELECT 1 FROM public.agent_threads WHERE organization_id=org)
 OR EXISTS(SELECT 1 FROM public.agent_events WHERE organization_id=org)
 OR EXISTS(SELECT 1 FROM public.agent_conversations WHERE organization_id=org)
 OR EXISTS(SELECT 1 FROM public.agent_operations WHERE organization_id=org)
 OR EXISTS(SELECT 1 FROM public.agent_demo_mapping_requests WHERE organization_id=org)
 OR EXISTS(SELECT 1 FROM public.workflow_agent_demo_mapping_requests WHERE organization_id=org)
 OR EXISTS(SELECT 1 FROM public.campaign_enrolments WHERE organization_id=org)
 OR EXISTS(SELECT 1 FROM public.sequence_enrolments WHERE organization_id=org)
 OR EXISTS(SELECT 1 FROM public.messages WHERE organization_id=org)
 OR EXISTS(SELECT 1 FROM public.communication_dispatch_intents WHERE organization_id=org)
 THEN RAISE EXCEPTION 'Admission/replay/rejection created prohibited research or outreach effects';END IF;
 RAISE NOTICE 'PASS: exact admission/replay, conflicting inputs, ownership, active reservation, runtime version and research-only transitions';
END $admission_tests$;
ROLLBACK;
