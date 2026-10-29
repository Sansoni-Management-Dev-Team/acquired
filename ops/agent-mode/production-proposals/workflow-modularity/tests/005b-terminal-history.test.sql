-- Owner-only synthetic terminal fixture; proves DB history guards, not provider receipt ingestion.
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

DO $recovery_tests$
DECLARE org text:=gen_random_uuid()::text;actor text:=gen_random_uuid()::text;m uuid:=gen_random_uuid();w uuid:=gen_random_uuid();th uuid:=gen_random_uuid();resp uuid:=gen_random_uuid();contact uuid:=gen_random_uuid();conv uuid:=gen_random_uuid();evt uuid:=gen_random_uuid();denied boolean;msg text;stamp timestamptz;
BEGIN
 INSERT INTO public.communication_member_fence(singleton,writer_xid) VALUES(true,0) ON CONFLICT DO NOTHING;
 INSERT INTO public."user"(id,name,email) VALUES(actor,'Workflow recovery fixture',actor||'@example.invalid');
 INSERT INTO public.organization(id,name,slug) VALUES(org,'Workflow recovery fixture',org);
 INSERT INTO public.member(id,organization_id,user_id,role) VALUES(gen_random_uuid()::text,org,actor,'member');
 INSERT INTO public.mandates(id,organization_id,created_by,natural_language,filters,provenance) VALUES(m,org,actor,'Synthetic live recovery','{"brief":{}}','{}');
 PERFORM set_config('app.acquire_org',org,true);PERFORM set_config('app.acquire_user',actor,true);PERFORM set_config('app.acquire_workflow_version','1',true);PERFORM set_config('app.acquire_workflow_execution',w::text,true);
 INSERT INTO public.acquisition_workflow_executions(id,organization_id,owner_user_id,mandate_id,input_digest,preset,presentation,state) VALUES(w,org,actor,m,repeat('a',64),'live','agent','accepted');
 UPDATE public.acquisition_workflow_executions SET state='ready',revision=revision+1,updated_at=greatest(clock_timestamp(),updated_at) WHERE id=w;
 INSERT INTO public.agent_threads(id,organization_id,mandate_id,owner_user_id) VALUES(th,org,m,actor);
 INSERT INTO public.agent_responsibilities(id,thread_id,organization_id,mandate_id,owner_user_id,mandate_revision) VALUES(resp,th,org,m,actor,'1');
 INSERT INTO public.contacts(id,organization_id,mandate_id,display_name,provenance) VALUES(contact,org,m,'Synthetic recipient','{}');
 -- No held gate must fail before any downstream conversation source can exist.
 UPDATE public.communication_member_fence SET writer_xid=0 WHERE singleton;
 UPDATE public.communication_send_gates SET writer_xid=0 WHERE organization_id=org;
 denied:=false;
 BEGIN INSERT INTO public.agent_conversations(id,thread_id,organization_id,mandate_id,owner_user_id,responsibility_id,contact_id,delivery_mode,binding_digest,recipient_email,driver_kind,phase,history_revision)
 VALUES(conv,th,org,m,actor,resp,contact,'local_sink',repeat('b',64),'fixture@example.invalid','agent','paused',repeat('b',64));
 EXCEPTION WHEN SQLSTATE 'P0001' THEN GET STACKED DIAGNOSTICS msg=MESSAGE_TEXT;IF msg<>'Organization gate must precede workflow source lock' THEN RAISE;END IF;denied:=true;END;
 IF NOT denied THEN RAISE EXCEPTION 'Conversation created without organization gate';END IF;
 SET LOCAL ROLE acquire_agent_user;PERFORM public.agent_lock_send_gate();RESET ROLE;
 INSERT INTO public.agent_conversations(id,thread_id,organization_id,mandate_id,owner_user_id,responsibility_id,contact_id,delivery_mode,binding_digest,recipient_email,driver_kind,phase,history_revision)
 VALUES(conv,th,org,m,actor,resp,contact,'local_sink',repeat('b',64),'fixture@example.invalid','agent','complete',repeat('b',64));
 SELECT greatest(clock_timestamp(),updated_at) INTO stamp FROM public.acquisition_workflow_executions WHERE id=w;
 UPDATE public.acquisition_workflow_executions SET state='complete',revision=revision+1,updated_at=stamp,finished_at=stamp WHERE id=w;
 -- Completed workflows retain exact conversation history ingestion authority.
 INSERT INTO public.agent_events(id,thread_id,organization_id,mandate_id,owner_user_id,event_key,kind,payload,payload_digest)
 VALUES(evt,th,org,m,actor,'history','conversation.history_changed',jsonb_build_object('conversationId',conv),repeat('b',64));
 UPDATE public.agent_events SET state='leased',lease_owner=gen_random_uuid(),lease_until=clock_timestamp()+interval '1 minute' WHERE id=evt;
 UPDATE public.agent_conversations SET history='[{"direction":"inbound","body":"Synthetic late reply"}]',history_revision=repeat('c',64),revision=revision+1 WHERE id=conv;
 denied:=false;
 BEGIN INSERT INTO public.agent_events(thread_id,organization_id,mandate_id,owner_user_id,event_key,kind,payload,payload_digest)
 VALUES(th,org,m,actor,'new-send','email.proposed','{}',repeat('b',64));
 EXCEPTION WHEN SQLSTATE 'P0001' THEN GET STACKED DIAGNOSTICS msg=MESSAGE_TEXT;IF msg<>'Terminal or uncertain workflow cannot create work' THEN RAISE;END IF;denied:=true;END;
 IF NOT denied THEN RAISE EXCEPTION 'Terminal workflow scheduled new send';END IF;
 denied:=false;
 BEGIN INSERT INTO public.agent_events(thread_id,organization_id,mandate_id,owner_user_id,event_key,kind,payload,payload_digest)
 VALUES(th,org,m,actor,'foreign-history','conversation.history_changed',jsonb_build_object('conversationId',gen_random_uuid()),repeat('b',64));
 EXCEPTION WHEN SQLSTATE 'P0001' THEN GET STACKED DIAGNOSTICS msg=MESSAGE_TEXT;IF msg<>'Event conversation belongs to another workflow' THEN RAISE;END IF;denied:=true;END;
 IF NOT denied THEN RAISE EXCEPTION 'History accepted unknown conversation';END IF;
 denied:=false;
 BEGIN UPDATE public.agent_conversations SET phase='active',revision=revision+1 WHERE id=conv;
 EXCEPTION WHEN SQLSTATE 'P0001' THEN GET STACKED DIAGNOSTICS msg=MESSAGE_TEXT;IF msg<>'Terminal workflow cannot reactivate conversation' THEN RAISE;END IF;denied:=true;END;
 IF NOT denied THEN RAISE EXCEPTION 'Completed conversation reactivated';END IF;
 RAISE NOTICE 'PASS: missing gate rejected, terminal exact-history insert/lease and conversation history update allowed, terminal send and conversation restart denied, foreign history denied';
END $recovery_tests$;
ROLLBACK;
