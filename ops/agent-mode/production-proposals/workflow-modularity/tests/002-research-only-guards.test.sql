-- PREPARED ONLY. Requires exact approved migrations and rehearsal target.
-- Rollback-only trigger assertions, no DDL or trigger disabling. Fixtures use
-- schema owner privileges; these cases isolate BEFORE admission errors, while
-- tests/001 covers restricted-role RLS/ACL. Dummy downstream FK identifiers are
-- intentional: only the exact P0001 policy error counts as a successful denial.
BEGIN;
SET LOCAL lock_timeout='3s';
SET LOCAL statement_timeout='20s';
DO $target$
BEGIN
 IF current_database() IS DISTINCT FROM 'acquire_hosted_demo_rehearsal'
 OR shobj_description((SELECT oid FROM pg_database WHERE datname=current_database()),'pg_database') IS DISTINCT FROM 'acquire-hosted-demo-rehearsal-only'
 OR (SELECT system_identifier::text FROM pg_catalog.pg_control_system()) IS DISTINCT FROM '7699248227334438947'
 THEN RAISE EXCEPTION 'Exact isolated workflow rehearsal database and cluster required';END IF;
 IF current_user IS DISTINCT FROM pg_get_userbyid((SELECT relowner FROM pg_class WHERE oid='public.acquisition_workflow_executions'::regclass))
 THEN RAISE EXCEPTION 'Run guard assertions as workflow schema owner';END IF;
END $target$;

DO $guard_tests$
DECLARE
 org text:=gen_random_uuid()::text;actor text:=gen_random_uuid()::text;
 mandate uuid:=gen_random_uuid();workflow uuid:=gen_random_uuid();thread uuid:=gen_random_uuid();
 old_job uuid:=gen_random_uuid();new_job uuid:=gen_random_uuid();denied boolean;observed_message text;stamp timestamptz;
BEGIN
 INSERT INTO public."user"(id,name,email) VALUES(actor,'Research guard rehearsal',actor||'@example.invalid');
 INSERT INTO public.organization(id,name,slug) VALUES(org,'Research guard rehearsal',org);
 INSERT INTO public.member(id,organization_id,user_id,role) VALUES(gen_random_uuid()::text,org,actor,'member');
 INSERT INTO public.mandates(id,organization_id,created_by,natural_language,filters,provenance)
 VALUES(mandate,org,actor,'Synthetic research-only guard fixture','{"brief":{}}','{}');
 INSERT INTO public.agent_threads(id,organization_id,mandate_id,owner_user_id) VALUES(thread,org,mandate,actor);
 -- Historical complete research predates the execution and must not be adopted.
 INSERT INTO public.research_jobs(id,organization_id,mandate_id,created_by,status,config)
 VALUES(old_job,org,mandate,actor,'complete','{}');
 INSERT INTO public.acquisition_workflow_executions(id,organization_id,owner_user_id,mandate_id,input_digest,preset,presentation)
 VALUES(workflow,org,actor,mandate,repeat('a',64),'live-research-test','agent');
 PERFORM public.communications_lock_send_gate(org);
 PERFORM set_config('app.acquire_org',org,true);
 PERFORM set_config('app.acquire_user',actor,true);
 PERFORM set_config('app.acquire_workflow_version','',true);
 PERFORM set_config('app.acquire_workflow_execution','',true);

 denied:=false;
 BEGIN
  INSERT INTO public.agent_events(thread_id,organization_id,mandate_id,owner_user_id,event_key,kind,payload,payload_digest)
  VALUES(thread,org,mandate,actor,'old-writer','research.requested','{}',repeat('b',64));
 EXCEPTION WHEN SQLSTATE 'P0001' THEN
  GET STACKED DIAGNOSTICS observed_message=MESSAGE_TEXT;
  IF observed_message<>'Explicit workflow-capable writer required' THEN RAISE EXCEPTION 'Wrong old-writer denial: %',observed_message;END IF;
  denied:=true;
 END;
 IF NOT denied THEN RAISE EXCEPTION 'Old writer created work for a workflow mandate';END IF;

 PERFORM set_config('app.acquire_workflow_version','1',true);
 PERFORM set_config('app.acquire_workflow_execution',workflow::text,true);
 denied:=false;
 BEGIN
  INSERT INTO public.agent_events(thread_id,organization_id,mandate_id,owner_user_id,event_key,kind,payload,payload_digest)
  VALUES(thread,org,mandate,actor,'outreach-event','email.proposed','{}',repeat('b',64));
 EXCEPTION WHEN SQLSTATE 'P0001' THEN
  GET STACKED DIAGNOSTICS observed_message=MESSAGE_TEXT;
  IF observed_message<>'Research-only execution cannot schedule outreach' THEN RAISE EXCEPTION 'Wrong event denial: %',observed_message;END IF;
  denied:=true;
 END;
 IF NOT denied THEN RAISE EXCEPTION 'Research-only execution scheduled outreach';END IF;

 denied:=false;
 BEGIN
  INSERT INTO public.agent_operations(thread_id,organization_id,mandate_id,owner_user_id,request_key,name,input,input_digest)
  VALUES(thread,org,mandate,actor,'outreach-operation','email.initial','{}',repeat('b',64));
 EXCEPTION WHEN SQLSTATE 'P0001' THEN
  GET STACKED DIAGNOSTICS observed_message=MESSAGE_TEXT;
  IF observed_message<>'Research-only execution cannot create outreach operations' THEN RAISE EXCEPTION 'Wrong operation denial: %',observed_message;END IF;
  denied:=true;
 END;
 IF NOT denied THEN RAISE EXCEPTION 'Research-only execution created an outreach operation';END IF;

 denied:=false;
 BEGIN
  INSERT INTO public.agent_conversations(thread_id,organization_id,mandate_id,owner_user_id,responsibility_id,contact_id,delivery_mode,binding_digest,recipient_email,driver_kind,phase,history_revision)
  VALUES(thread,org,mandate,actor,gen_random_uuid(),gen_random_uuid(),'local_sink',repeat('b',64),'synthetic@example.invalid','agent','paused',repeat('b',64));
 EXCEPTION WHEN SQLSTATE 'P0001' THEN
  GET STACKED DIAGNOSTICS observed_message=MESSAGE_TEXT;
  IF observed_message<>'Execution cannot create outreach conversations' THEN RAISE EXCEPTION 'Wrong conversation denial: %',observed_message;END IF;
  denied:=true;
 END;
 IF NOT denied THEN RAISE EXCEPTION 'Research-only execution created a conversation';END IF;

 denied:=false;
 BEGIN
  INSERT INTO public.sequence_enrolments(organization_id,mandate_id,sequence_id,target_id,state)
  VALUES(org,mandate,gen_random_uuid(),gen_random_uuid(),'draft');
 EXCEPTION WHEN SQLSTATE 'P0001' THEN
  GET STACKED DIAGNOSTICS observed_message=MESSAGE_TEXT;
  IF observed_message<>'Only exact live workspace execution permits manual outreach' THEN RAISE EXCEPTION 'Wrong manual sequence denial: %',observed_message;END IF;
  denied:=true;
 END;
 IF NOT denied THEN RAISE EXCEPTION 'Research-only execution entered a manual sequence';END IF;

 denied:=false;
 BEGIN
  INSERT INTO public.agent_channel_policies(thread_id,organization_id,owner_user_id,mandate_id,channel_order,delay_seconds,bindings)
  VALUES(thread,org,actor,mandate,ARRAY['email'],86400,'[]');
 EXCEPTION WHEN SQLSTATE 'P0001' THEN
  GET STACKED DIAGNOSTICS observed_message=MESSAGE_TEXT;
  IF observed_message<>'Exact outreach workflow required for channel policy' THEN RAISE EXCEPTION 'Wrong policy denial: %',observed_message;END IF;
  denied:=true;
 END;
 IF NOT denied THEN RAISE EXCEPTION 'Research-only execution provisioned an outreach policy';END IF;

 denied:=false;
 BEGIN
  UPDATE public.research_jobs SET status='queued' WHERE id=old_job;
 EXCEPTION WHEN SQLSTATE 'P0001' THEN
  GET STACKED DIAGNOSTICS observed_message=MESSAGE_TEXT;
  IF observed_message<>'Historical work cannot acquire new workflow authority' THEN RAISE EXCEPTION 'Wrong legacy job denial: %',observed_message;END IF;
  denied:=true;
 END;
 IF NOT denied THEN RAISE EXCEPTION 'Legacy research job inherited a newer workflow';END IF;

 -- A normal associated research row is permitted and stamped with exact scope.
 INSERT INTO public.research_jobs(id,organization_id,mandate_id,created_by,status,config)
 VALUES(new_job,org,mandate,actor,'complete','{}');
 IF (SELECT workflow_execution_id FROM public.research_jobs WHERE id=new_job) IS DISTINCT FROM workflow
 THEN RAISE EXCEPTION 'Research job did not keep its execution association';END IF;
 -- Owner-only fixture closure, not proof of the application transition function.
 SELECT greatest(clock_timestamp(),updated_at) INTO stamp FROM public.acquisition_workflow_executions WHERE id=workflow;
 UPDATE public.acquisition_workflow_executions SET state='complete',revision=revision+1,
  updated_at=stamp,finished_at=stamp
 WHERE id=workflow;
 denied:=false;
 BEGIN
  UPDATE public.research_jobs SET status='queued' WHERE id=new_job;
 EXCEPTION WHEN SQLSTATE 'P0001' THEN
  GET STACKED DIAGNOSTICS observed_message=MESSAGE_TEXT;
  IF observed_message<>'Terminal workflow cannot reactivate research' THEN RAISE EXCEPTION 'Wrong terminal research denial: %',observed_message;END IF;
  denied:=true;
 END;
 IF NOT denied THEN RAISE EXCEPTION 'Terminal research execution restarted its job';END IF;

 IF EXISTS(SELECT 1 FROM public.agent_events WHERE mandate_id=mandate)
 OR EXISTS(SELECT 1 FROM public.agent_operations WHERE mandate_id=mandate)
 OR EXISTS(SELECT 1 FROM public.agent_conversations WHERE mandate_id=mandate)
 OR EXISTS(SELECT 1 FROM public.sequence_enrolments WHERE mandate_id=mandate)
 OR EXISTS(SELECT 1 FROM public.agent_channel_policies WHERE thread_id=thread)
 THEN RAISE EXCEPTION 'Denied outreach left persisted work inside the test transaction';END IF;
END $guard_tests$;
ROLLBACK;
