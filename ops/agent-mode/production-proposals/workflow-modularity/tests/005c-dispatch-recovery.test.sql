-- Owner-only synthetic SQL fixture; not proof of application approval validation or provider authentication.
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

DO $dispatch_tests$
DECLARE org text:=gen_random_uuid()::text;actor text:=gen_random_uuid()::text;m uuid:=gen_random_uuid();w uuid:=gen_random_uuid();seq uuid:=gen_random_uuid();t uuid:=gen_random_uuid();enrol uuid:=gen_random_uuid();contact uuid:=gen_random_uuid();binding uuid:=gen_random_uuid();message_id uuid:=gen_random_uuid();intent uuid:=gen_random_uuid();permit uuid:=gen_random_uuid();denied boolean;msg text;stamp timestamptz;legacy_t uuid:=gen_random_uuid();legacy_m uuid:=gen_random_uuid();legacy_enrol uuid:=gen_random_uuid();legacy_message uuid:=gen_random_uuid();legacy_intent uuid:=gen_random_uuid();
BEGIN
 INSERT INTO public.communication_member_fence(singleton,writer_xid) VALUES(true,0) ON CONFLICT DO NOTHING;
 INSERT INTO public."user"(id,name,email) VALUES(actor,'Workflow dispatch fixture',actor||'@example.invalid');
 INSERT INTO public.organization(id,name,slug) VALUES(org,'Workflow dispatch fixture',org);
 INSERT INTO public.member(id,organization_id,user_id,role) VALUES(gen_random_uuid()::text,org,actor,'member');
 INSERT INTO public.mandates(id,organization_id,created_by,natural_language,filters,provenance) VALUES(m,org,actor,'Synthetic dispatch','{"brief":{}}','{}');
 PERFORM set_config('app.acquire_org',org,true);PERFORM set_config('app.acquire_user',actor,true);PERFORM set_config('app.acquire_workflow_version','1',true);PERFORM set_config('app.acquire_workflow_execution',w::text,true);
 INSERT INTO public.acquisition_workflow_executions(id,organization_id,owner_user_id,mandate_id,input_digest,preset,presentation) VALUES(w,org,actor,m,repeat('a',64),'live','workspace');
 UPDATE public.acquisition_workflow_executions SET state='ready',revision=revision+1,updated_at=greatest(clock_timestamp(),updated_at) WHERE id=w;
 INSERT INTO public.sequences(id,organization_id,name,steps,created_by) VALUES(seq,org,'Synthetic sequence','[]',actor);
 INSERT INTO public.targets(id,organization_id,mandate_id,company_name,firmographics) VALUES(t,org,m,'Synthetic business','{}');
 INSERT INTO public.contacts(id,organization_id,mandate_id,target_id,display_name,provenance) VALUES(contact,org,m,t,'Synthetic recipient','{}');
 INSERT INTO public.sequence_enrolments(id,organization_id,mandate_id,sequence_id,target_id,contact_id,state) VALUES(enrol,org,m,seq,t,contact,'draft');
 INSERT INTO public.messages(id,organization_id,enrolment_id,step_number,purpose,subject,body,state,approved_by,approved_at) VALUES(message_id,org,enrol,1,'initial','Synthetic subject','Synthetic body','approved',actor,clock_timestamp());
 INSERT INTO public.communication_bindings(id,organization_id,owner_user_id,service_connection_id,service_account_id,generation,channel,platform,backend,authority) VALUES(binding,org,actor,'synthetic-'||binding,'synthetic-'||binding,1,'email','gmail','unipile','service');
 -- Stale runtime context cannot bind an otherwise valid physical draft source.
 PERFORM set_config('app.acquire_workflow_execution',gen_random_uuid()::text,true);denied:=false;
 BEGIN INSERT INTO public.communication_dispatch_intents(id,organization_id,owner_user_id,binding_id,source_kind,source_id,epoch,contact_id,operation_key,operation,payload_digest,intent_digest,encrypted_intent,intent_key_version,source_digest,required_since,coverage_scopes) VALUES(intent,org,actor,binding,'draft',message_id,1,contact,'synthetic-'||intent,'message',repeat('b',64),repeat('c',64),'synthetic-not-ciphertext','fixture',repeat('d',64),clock_timestamp(),'[{}]');
 EXCEPTION WHEN SQLSTATE 'P0001' THEN GET STACKED DIAGNOSTICS msg=MESSAGE_TEXT;IF msg<>'Exact active outreach workflow required for new dispatch' THEN RAISE;END IF;denied:=true;END;
 IF NOT denied THEN RAISE EXCEPTION 'Wrong workflow dispatch admitted';END IF;
 PERFORM set_config('app.acquire_workflow_execution',w::text,true);
 INSERT INTO public.communication_dispatch_intents(id,organization_id,owner_user_id,binding_id,source_kind,source_id,epoch,contact_id,operation_key,operation,payload_digest,intent_digest,encrypted_intent,intent_key_version,source_digest,required_since,coverage_scopes) VALUES(intent,org,actor,binding,'draft',message_id,1,contact,'synthetic-'||intent,'message',repeat('b',64),repeat('c',64),'synthetic-not-ciphertext','fixture',repeat('d',64),clock_timestamp(),'[{}]');
 PERFORM set_config('app.acquire_workflow_execution',gen_random_uuid()::text,true);denied:=false;
 BEGIN INSERT INTO public.communication_dispatch_permits(id,intent_id,service_admission_id,service_journal_id,encrypted_receipt,receipt_key_version,receipt_digest) VALUES(permit,intent,gen_random_uuid(),gen_random_uuid(),'synthetic-not-ciphertext','fixture',repeat('e',64));
 EXCEPTION WHEN SQLSTATE 'P0001' THEN GET STACKED DIAGNOSTICS msg=MESSAGE_TEXT;IF msg<>'Exact active outreach workflow required for new dispatch' THEN RAISE;END IF;denied:=true;END;
 IF NOT denied THEN RAISE EXCEPTION 'Wrong workflow permit admitted';END IF;
 PERFORM set_config('app.acquire_workflow_execution',w::text,true);
 INSERT INTO public.communication_dispatch_permits(id,intent_id,service_admission_id,service_journal_id,encrypted_receipt,receipt_key_version,receipt_digest) VALUES(permit,intent,gen_random_uuid(),gen_random_uuid(),'synthetic-not-ciphertext','fixture',repeat('e',64));
 -- Force terminal synthetic fixture to test delayed original receipt ingestion.
 SELECT greatest(clock_timestamp(),updated_at) INTO stamp FROM public.acquisition_workflow_executions WHERE id=w;
 UPDATE public.acquisition_workflow_executions SET state='complete',revision=revision+1,updated_at=stamp,finished_at=stamp WHERE id=w;
 INSERT INTO public.communication_submission_receipts(intent_id,organization_id,owner_user_id,binding_id,source_kind,source_id,operation,operation_key,payload_digest,source_digest,original_intent_digest,encrypted_receipt,receipt_key_version,receipt_digest,recipient_digest,provider_reference,submitted_at,origin_status)
 VALUES(intent,org,actor,binding,'draft',message_id,'message','synthetic-'||intent,repeat('b',64),repeat('d',64),repeat('c',64),'synthetic-not-ciphertext','fixture',repeat('e',64),repeat('f',64),'synthetic-provider-reference',public.agent_business_now(),'legacy_unsealed');
 UPDATE public.messages SET state='sent',provider_message_id='synthetic-provider-reference',sent_at=public.agent_business_now(),updated_at=clock_timestamp() WHERE id=message_id;
 IF (SELECT workflow_execution_id FROM public.sequence_enrolments WHERE id=enrol) IS DISTINCT FROM w OR (SELECT state FROM public.messages WHERE id=message_id)<>'sent' THEN RAISE EXCEPTION 'Original delivery projection failed';END IF;
 denied:=false;
 BEGIN UPDATE public.communication_dispatch_intents SET source_id=gen_random_uuid() WHERE id=intent;
 EXCEPTION WHEN SQLSTATE 'P0001' THEN GET STACKED DIAGNOSTICS msg=MESSAGE_TEXT;IF msg<>'Dispatch intent and recorded disposition are immutable' THEN RAISE;END IF;denied:=true;END;
 IF NOT denied THEN RAISE EXCEPTION 'Original dispatch intent identity mutable';END IF;
 -- Old real draft path has no workflow identity and must remain writable.
 PERFORM set_config('app.acquire_workflow_version','',true);PERFORM set_config('app.acquire_workflow_execution','',true);
 INSERT INTO public.mandates(id,organization_id,created_by,natural_language,filters,provenance) VALUES(legacy_m,org,actor,'Synthetic legacy dispatch','{"brief":{}}','{}');
 INSERT INTO public.targets(id,organization_id,mandate_id,company_name,firmographics) VALUES(legacy_t,org,legacy_m,'Synthetic legacy business','{}');
 INSERT INTO public.sequence_enrolments(id,organization_id,mandate_id,sequence_id,target_id,contact_id,state) VALUES(legacy_enrol,org,legacy_m,seq,legacy_t,contact,'draft');
 INSERT INTO public.messages(id,organization_id,enrolment_id,step_number,purpose,subject,body,state,approved_by,approved_at) VALUES(legacy_message,org,legacy_enrol,1,'initial','Synthetic legacy subject','Synthetic legacy body','approved',actor,clock_timestamp());
 INSERT INTO public.communication_dispatch_intents(id,organization_id,owner_user_id,binding_id,source_kind,source_id,epoch,contact_id,operation_key,operation,payload_digest,intent_digest,encrypted_intent,intent_key_version,source_digest,required_since,coverage_scopes) VALUES(legacy_intent,org,actor,binding,'draft',legacy_message,1,contact,'synthetic-'||legacy_intent,'message',repeat('b',64),repeat('c',64),'synthetic-not-ciphertext','fixture',repeat('d',64),clock_timestamp(),'[{}]');
 INSERT INTO public.communication_dispatch_permits(id,intent_id,service_admission_id,service_journal_id,encrypted_receipt,receipt_key_version,receipt_digest) VALUES(gen_random_uuid(),legacy_intent,gen_random_uuid(),gen_random_uuid(),'synthetic-not-ciphertext','fixture',repeat('e',64));
 IF (SELECT workflow_execution_id FROM public.sequence_enrolments WHERE id=legacy_enrol) IS NOT NULL THEN RAISE EXCEPTION 'Legacy real source acquired workflow identity';END IF;
 RAISE NOTICE 'PASS: live workspace draft intent/permit original workflow, stale context denial, late terminal original receipt/projection, immutable intent, legacy real intent/permit';
END $dispatch_tests$;
ROLLBACK;
