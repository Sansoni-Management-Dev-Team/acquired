-- WF-03 acceptance. Execute only on the explicitly approved rehearsal after 001-004.
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

DO $security_tests$
DECLARE org text:=gen_random_uuid()::text;actor text:=gen_random_uuid()::text;foreign_org text:=gen_random_uuid()::text;
 m uuid:=gen_random_uuid();agent_m uuid:=gen_random_uuid();w uuid:=gen_random_uuid();agent_w uuid:=gen_random_uuid();
 seq uuid:=gen_random_uuid();t uuid:=gen_random_uuid();enrol uuid:=gen_random_uuid();denied boolean;msg text;result public.acquisition_workflow_executions%ROWTYPE;stamp timestamptz;
BEGIN
 INSERT INTO public.communication_member_fence(singleton,writer_xid) VALUES(true,0) ON CONFLICT DO NOTHING;
 INSERT INTO public."user"(id,name,email) VALUES(actor,'Workflow security fixture',actor||'@example.invalid');
 INSERT INTO public.organization(id,name,slug) VALUES(org,'Workflow security fixture',org),(foreign_org,'Foreign fixture',foreign_org);
 INSERT INTO public.member(id,organization_id,user_id,role) VALUES(gen_random_uuid()::text,org,actor,'member');
 INSERT INTO public.mandates(id,organization_id,created_by,natural_language,filters,provenance) VALUES
 (m,org,actor,'Synthetic workspace live','{"brief":{}}','{}'),(agent_m,org,actor,'Synthetic agent live','{"brief":{}}','{}');
 SET LOCAL ROLE acquire_agent_user;
 PERFORM set_config('app.acquire_org',org,true);PERFORM set_config('app.acquire_user',actor,true);PERFORM set_config('app.acquire_workflow_version','1',true);
 -- The correction must not widen the general helper's role allowlist/ACL.
 denied:=false;
 BEGIN PERFORM public.communications_lock_send_gate(org);
 EXCEPTION WHEN insufficient_privilege THEN denied:=true;
 WHEN SQLSTATE 'P0001' THEN GET STACKED DIAGNOSTICS msg=MESSAGE_TEXT;IF msg<>'Reviewed writer role required' THEN RAISE;END IF;denied:=true;END;
 IF NOT denied THEN RAISE EXCEPTION 'Agent unexpectedly admitted by general gate';END IF;
 PERFORM public.acquisition_workflow_start(w,'live','workspace',m);
 denied:=false;
 BEGIN PERFORM public.acquisition_workflow_transition(w,2,'cancelled');EXCEPTION WHEN serialization_failure THEN denied:=true;END;
 IF NOT denied THEN RAISE EXCEPTION 'Stale revision accepted';END IF;
 PERFORM set_config('app.acquire_org',foreign_org,true);denied:=false;
 BEGIN PERFORM public.acquisition_workflow_transition(w,1,'cancelled');
 EXCEPTION WHEN SQLSTATE 'P0001' THEN GET STACKED DIAGNOSTICS msg=MESSAGE_TEXT;IF msg<>'Authenticated agent scope required' THEN RAISE;END IF;denied:=true;END;
 IF NOT denied THEN RAISE EXCEPTION 'Foreign organization transition accepted';END IF;
 PERFORM set_config('app.acquire_org',org,true);
 PERFORM public.acquisition_workflow_start(agent_w,'live','agent',agent_m);
 RESET ROLE;
 -- Owner creates settled research, not approval or provider evidence.
 PERFORM set_config('app.acquire_workflow_execution',w::text,true);
 INSERT INTO public.research_jobs(id,organization_id,mandate_id,created_by,status,config) VALUES(gen_random_uuid(),org,m,actor,'complete','{}');
 PERFORM set_config('app.acquire_workflow_execution',agent_w::text,true);
 INSERT INTO public.research_jobs(id,organization_id,mandate_id,created_by,status,config) VALUES(gen_random_uuid(),org,agent_m,actor,'complete','{}');
 SET LOCAL ROLE acquire_agent_user;
 PERFORM public.acquisition_workflow_transition(w,1,'ready');
 PERFORM public.acquisition_workflow_transition(agent_w,1,'ready');
 RESET ROLE;
 -- Owner scope tests the actual manual trigger/FKs, not application table ACLs.
 INSERT INTO public.sequences(id,organization_id,name,steps,created_by) VALUES(seq,org,'Synthetic sequence','[]',actor);
 INSERT INTO public.targets(id,organization_id,mandate_id,company_name,firmographics) VALUES(t,org,m,'Synthetic business','{}');
 PERFORM set_config('app.acquire_workflow_execution',w::text,true);
 INSERT INTO public.sequence_enrolments(id,organization_id,mandate_id,sequence_id,target_id,state) VALUES(enrol,org,m,seq,t,'draft');
 IF (SELECT workflow_execution_id FROM public.sequence_enrolments WHERE id=enrol) IS DISTINCT FROM w THEN RAISE EXCEPTION 'Manual source not bound to original execution';END IF;
 PERFORM set_config('app.acquire_workflow_execution',agent_w::text,true);denied:=false;
 BEGIN INSERT INTO public.sequence_enrolments(organization_id,mandate_id,sequence_id,target_id,state) VALUES(org,agent_m,seq,t,'draft');
 EXCEPTION WHEN SQLSTATE 'P0001' THEN GET STACKED DIAGNOSTICS msg=MESSAGE_TEXT;IF msg<>'Only exact live workspace execution permits manual outreach' THEN RAISE;END IF;denied:=true;END;
 IF NOT denied THEN RAISE EXCEPTION 'Agent mode allowed manual sequence';END IF;
 PERFORM set_config('app.acquire_workflow_execution',w::text,true);
 SET LOCAL ROLE acquire_agent_user;
 PERFORM public.acquisition_workflow_transition(w,2,'outreach');
 denied:=false;
 BEGIN PERFORM public.acquisition_workflow_transition(w,3,'complete');
 EXCEPTION WHEN SQLSTATE '55000' THEN GET STACKED DIAGNOSTICS msg=MESSAGE_TEXT;IF msg<>'Manual outreach remains active or unresolved' THEN RAISE;END IF;denied:=true;END;
 IF NOT denied THEN RAISE EXCEPTION 'Completed with pending manual outreach';END IF;
 RESET ROLE;
 UPDATE public.sequence_enrolments SET state='stopped' WHERE id=enrol;
 SET LOCAL ROLE acquire_agent_user;
 SELECT * INTO result FROM public.acquisition_workflow_transition(w,3,'complete');
 IF result.state<>'complete' OR result.revision<>4 THEN RAISE EXCEPTION 'Settled manual execution did not complete';END IF;
 RESET ROLE;
 denied:=false;
 BEGIN UPDATE public.sequence_enrolments SET state='draft' WHERE id=enrol;
 EXCEPTION WHEN SQLSTATE 'P0001' THEN GET STACKED DIAGNOSTICS msg=MESSAGE_TEXT;IF msg<>'Terminal workflow cannot reactivate manual outreach' THEN RAISE;END IF;denied:=true;END;
 IF NOT denied THEN RAISE EXCEPTION 'Terminal manual outreach reactivated';END IF;
 DELETE FROM public.member WHERE organization_id=org AND user_id=actor;
 SET LOCAL ROLE acquire_agent_user;denied:=false;
 BEGIN PERFORM public.acquisition_workflow_transition(agent_w,2,'cancelled');
 EXCEPTION WHEN SQLSTATE 'P0001' THEN GET STACKED DIAGNOSTICS msg=MESSAGE_TEXT;IF msg<>'Authenticated agent scope required' THEN RAISE;END IF;denied:=true;END;
 IF NOT denied THEN RAISE EXCEPTION 'Revoked membership retained transition authority';END IF;
 RESET ROLE;
 RAISE NOTICE 'PASS: general gate restriction, stale revision, foreign/revoked membership, live workspace manual association, agent manual denial, active manual completion hold, terminal reactivation denial';
END $security_tests$;
ROLLBACK;
