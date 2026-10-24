-- Rollback-only exact rehearsal. All sender attestations are synthetic fixtures,
-- not service-verified readiness evidence. No provider requests or persistent rows.
BEGIN;
SET LOCAL lock_timeout='3s';
SET LOCAL statement_timeout='20s';
DO $$ BEGIN
 IF current_database() IS DISTINCT FROM 'acquire_hosted_demo_rehearsal' OR (SELECT system_identifier::text FROM pg_control_system()) IS DISTINCT FROM '7699248227334438947' OR shobj_description((SELECT oid FROM pg_database WHERE datname=current_database()),'pg_database') IS DISTINCT FROM 'acquire-hosted-demo-rehearsal-only' THEN RAISE EXCEPTION 'Exact isolated rehearsal required'; END IF;
END $$;
DO $$
DECLARE org text:=gen_random_uuid()::text; actor text:=gen_random_uuid()::text; legacy uuid:=gen_random_uuid(); live uuid:=gen_random_uuid(); demo uuid:=gen_random_uuid(); person uuid:=gen_random_uuid(); otherperson uuid:=gen_random_uuid(); realperson uuid:=gen_random_uuid(); result jsonb; expected jsonb; runid text:='hosted-demo-rehearsal'; runuuid uuid:=gen_random_uuid(); bid uuid; ch text; senders jsonb:='[]'; accounts jsonb:='[]'; b public.communication_bindings%ROWTYPE; proof jsonb; req uuid; rev text; fp text; wire jsonb; manifest jsonb; batch jsonb; mid uuid; newmid uuid; oldmid uuid; keyname text; badwire jsonb; ex uuid; mand uuid; c uuid; n integer; denied boolean; msg text;
BEGIN
 INSERT INTO public.communication_member_fence(singleton,writer_xid) VALUES(true,0) ON CONFLICT DO NOTHING;
 INSERT INTO public."user"(id,name,email) VALUES(actor,'Legacy projection rehearsal',actor||'@example.invalid');
 INSERT INTO public.organization(id,name,slug) VALUES(org,'Legacy projection',org);
 INSERT INTO public.member(id,organization_id,user_id,role) VALUES(gen_random_uuid()::text,org,actor,'member');
 INSERT INTO public.mandates(id,organization_id,created_by,natural_language,filters,provenance) VALUES
 (legacy,org,actor,'Legacy demo','{"brief":{}}','{}'),(live,org,actor,'Legacy real','{"brief":{}}','{}'),(demo,org,actor,'Workflow demo','{"brief":{}}','{}');
 INSERT INTO public.agent_mandate_execution_modes(mandate_id,organization_id,created_by,mode,demo_id) VALUES(legacy,org,actor,'demo',legacy),(live,org,actor,'real',NULL);
 INSERT INTO public.acquisition_workflow_executions(id,organization_id,owner_user_id,mandate_id,input_digest,preset,presentation) VALUES(gen_random_uuid(),org,actor,demo,repeat('a',64),'demo','agent');
 INSERT INTO public.contacts(id,organization_id,mandate_id,display_name,personal_data,provenance) VALUES
 (person,org,legacy,'Synthetic legacy','{"email":"real-legacy@example.invalid"}','{}'),
 (otherperson,org,demo,'Synthetic workflow','{"email":"real-workflow@example.invalid"}','{}'),
 (realperson,org,live,'Synthetic real','{"email":"real-live@example.invalid"}','{}');
 SELECT to_jsonb(m) INTO expected FROM public.agent_mandate_execution_modes m WHERE mandate_id=legacy;
 SELECT to_jsonb(m) INTO result FROM public.agent_effective_execution_modes m WHERE mandate_id=legacy;
 IF result IS DISTINCT FROM expected THEN RAISE EXCEPTION 'Legacy demo row shape changed';END IF;
 SELECT to_jsonb(m) INTO expected FROM public.agent_mandate_execution_modes m WHERE mandate_id=live;
 SELECT to_jsonb(m) INTO result FROM public.agent_effective_execution_modes m WHERE mandate_id=live;
 IF result IS DISTINCT FROM expected THEN RAISE EXCEPTION 'Legacy real row shape changed';END IF;
 SELECT to_jsonb(m) INTO result FROM public.agent_effective_execution_modes m WHERE mandate_id=demo;
 IF result->>'mode' IS DISTINCT FROM 'demo' OR result->>'demo_id' IS DISTINCT FROM demo::text OR (SELECT count(*) FROM public.agent_effective_execution_modes WHERE mandate_id=demo)<>1 THEN RAISE EXCEPTION 'Workflow demo changed v1 mandate identity';END IF;

 PERFORM set_config('app.acquire_org',org,true);PERFORM set_config('app.acquire_user',actor,true);
 FOREACH ch IN ARRAY ARRAY['email','whatsapp','linkedin'] LOOP
  INSERT INTO public.communication_bindings(organization_id,owner_user_id,service_connection_id,service_account_id,generation,channel,platform,backend,authority)
   VALUES(org,actor,gen_random_uuid()::text,gen_random_uuid()::text,1,ch,CASE WHEN ch='email' THEN 'gmail' ELSE ch END,'unipile','service') RETURNING * INTO b;
  senders:=senders||jsonb_build_array(jsonb_build_object('channel',ch,'bindingId',b.id,'bindingDigest',public.agent_recorded_binding_digest(b.id),'accountId',b.service_account_id,'providerAccountId','sim-'||runid||'-'||ch,'sourceId','sim-source-'||ch));
  accounts:=accounts||jsonb_build_array(jsonb_build_object('status','connected','providerAccountId','sim-'||runid||'-'||ch,'sourceId','sim-source-'||ch,'binding',jsonb_build_object('applicationId',b.application_id,'tenantId',org,'ownerId',actor,'connectionId',b.service_connection_id,'accountId',b.service_account_id,'generation',1,'channel',ch,'platform',b.platform,'backend','unipile')));
 END LOOP;
 proof:=jsonb_build_object('version',1,'runId',runid,'integrationId','sim-'||runid,'configurationReference','sim-'||runid||'-v1','serviceOrigin','https://acquire-simulator.mlai.au','scope',jsonb_build_object('applicationId','acquire','tenantId',org,'ownerId',actor),'accounts',accounts,'observedAt',to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'));
 INSERT INTO public.agent_hosted_demo_registrations(organization_id,owner_user_id,run_id,integration_id,configuration_ref,service_origin,senders,attestation,attestation_digest) VALUES(org,actor,runid,'sim-'||runid,'sim-'||runid||'-v1','https://acquire-simulator.mlai.au',senders,proof,encode(sha256(convert_to(proof::text,'UTF8')),'hex'));
 INSERT INTO public.agent_demo_runs(id,organization_id,owner_user_id,run_id,integration_id,configuration_ref,senders) VALUES(runuuid,org,actor,runid,'sim-'||runid,'sim-'||runid||'-v1',senders);
 FOR n IN 1..2 LOOP
  mand:=CASE WHEN n=1 THEN legacy ELSE demo END;c:=CASE WHEN n=1 THEN person ELSE otherperson END;req:=gen_random_uuid();mid:=gen_random_uuid();
  SELECT xmin::text INTO rev FROM public.contacts WHERE id=c;fp:=public.agent_demo_contact_fingerprint(c);
  wire:=jsonb_build_object('sourcePersonId',c,'sourceRevision',rev,'sourceFingerprint',fp,'simulatorLeadId','lead-001','email','lead-001@'||runid||'.leads.acquire.test','phone','+999123456789012','linkedin','https://www.linkedin.com/in/sim-'||runid||'-lead-001','providerId','ACo_sim_'||runid||'_lead-001');
  IF n=2 THEN wire:=wire||jsonb_build_object('simulatorLeadId','lead-002','email','lead-002@'||runid||'.leads.acquire.test','phone','+999123456789013','linkedin','https://www.linkedin.com/in/sim-'||runid||'-lead-002','providerId','ACo_sim_'||runid||'_lead-002');END IF;
  manifest:=jsonb_build_object('version',1,'demoId',mand,'mandateId',mand,'organizationId',org,'userId',actor,'requestKey',req,'people',jsonb_build_array(jsonb_build_object('sourcePersonId',c,'sourceRevision',rev,'sourceFingerprint',fp)));
  batch:=jsonb_build_object('version',1,'demoId',mand,'runId',runid,'mappingDigest',repeat('b',64),'accounts',senders,'mappings',jsonb_build_array(wire),'integrationId','sim-'||runid,'configurationReference','sim-'||runid||'-v1','requestKey',req);
  IF n=1 THEN
   INSERT INTO public.agent_demo_mapping_requests VALUES(req,org,mand,mand,actor,runuuid,manifest,repeat('c',64),clock_timestamp());
   INSERT INTO public.agent_demo_mapping_receipts VALUES(req,org,mand,mand,actor,runuuid,batch,repeat('d',64),clock_timestamp());
   INSERT INTO public.agent_demo_contact_mappings VALUES(mid,org,mand,mand,actor,c,rev,fp,runuuid,req,wire,repeat('b',64),clock_timestamp());
   oldmid:=mid;
   SELECT to_jsonb(x) INTO expected FROM public.agent_demo_contact_mappings x WHERE id=mid;
   SELECT to_jsonb(x) INTO result FROM public.agent_effective_demo_contact_mappings x WHERE id=mid;
   IF result IS DISTINCT FROM expected THEN RAISE EXCEPTION 'Legacy mapping projection changed';END IF;
   SELECT to_jsonb(x) INTO expected FROM public.agent_demo_mapping_receipts x WHERE request_key=req;
   SELECT to_jsonb(x) INTO result FROM public.agent_effective_demo_mapping_receipts x WHERE request_key=req;
   IF result IS DISTINCT FROM expected THEN RAISE EXCEPTION 'Legacy mapping receipt projection changed';END IF;
   denied:=false;
   BEGIN UPDATE public.agent_demo_mapping_receipts SET result=agent_demo_mapping_receipts.result||'{"changed":true}' WHERE request_key=req;
   EXCEPTION WHEN raise_exception THEN GET STACKED DIAGNOSTICS msg=MESSAGE_TEXT;denied:=msg='Demo mapping evidence is immutable';END;
   IF NOT denied THEN RAISE EXCEPTION 'Legacy mapping receipt mutated';END IF;
  ELSE
   SELECT id INTO ex FROM public.acquisition_workflow_executions WHERE mandate_id=mand;
   PERFORM set_config('app.acquire_workflow_version','1',true);PERFORM set_config('app.acquire_workflow_execution',ex::text,true);
   INSERT INTO public.workflow_agent_demo_mapping_requests VALUES(ex,req,org,mand,mand,actor,runuuid,manifest,repeat('c',64),clock_timestamp());
   INSERT INTO public.workflow_agent_demo_mapping_receipts VALUES(ex,req,org,mand,mand,actor,runuuid,batch,repeat('d',64),clock_timestamp());
   FOREACH keyname IN ARRAY ARRAY['email','phone','linkedin','providerId','id'] LOOP
    SELECT x.wire INTO badwire FROM public.agent_demo_contact_mappings x WHERE id=oldmid;
    IF keyname='id' THEN badwire:=wire; ELSE badwire:=wire||jsonb_build_object(keyname,badwire->keyname);END IF;
    denied:=false;
    BEGIN
     INSERT INTO public.workflow_agent_demo_contact_mappings VALUES(ex,CASE WHEN keyname='id' THEN oldmid ELSE mid END,org,mand,mand,actor,c,rev,fp,runuuid,req,badwire,repeat('b',64),clock_timestamp());
    EXCEPTION WHEN raise_exception THEN GET STACKED DIAGNOSTICS msg=MESSAGE_TEXT;denied:=msg='Simulator recipient already has immutable provenance';END;
    IF NOT denied THEN RAISE EXCEPTION 'Cross-namespace collision was not rejected: %',keyname;END IF;
   END LOOP;
   INSERT INTO public.workflow_agent_demo_contact_mappings VALUES(ex,mid,org,mand,mand,actor,c,rev,fp,runuuid,req,wire,repeat('b',64),clock_timestamp());newmid:=mid;
   SELECT to_jsonb(x)-'workflow_execution_id' INTO expected FROM public.workflow_agent_demo_contact_mappings x WHERE id=mid;
   SELECT to_jsonb(x) INTO result FROM public.agent_effective_demo_contact_mappings x WHERE id=mid;
   IF expected IS DISTINCT FROM result THEN RAISE EXCEPTION 'Workflow mapping v1 projection changed';END IF;
   denied:=false;
   BEGIN
    INSERT INTO public.agent_demo_contact_mappings(id,organization_id,mandate_id,demo_id,created_by,contact_id,source_revision,source_fingerprint,demo_run_id,request_key,wire,mapping_digest,created_at)
     SELECT newmid,x.organization_id,x.mandate_id,x.demo_id,x.created_by,x.contact_id,x.source_revision,x.source_fingerprint,x.demo_run_id,x.request_key,x.wire,x.mapping_digest,x.created_at FROM public.agent_demo_contact_mappings x WHERE x.id=oldmid;
   EXCEPTION WHEN raise_exception THEN GET STACKED DIAGNOSTICS msg=MESSAGE_TEXT;denied:=msg='Simulator recipient already has immutable provenance';END;
   IF NOT denied THEN RAISE EXCEPTION 'Reverse mapping id collision not rejected';END IF;
   denied:=false;
   BEGIN UPDATE public.workflow_agent_demo_mapping_receipts SET result=workflow_agent_demo_mapping_receipts.result||'{"changed":true}' WHERE request_key=req;
   EXCEPTION WHEN raise_exception THEN GET STACKED DIAGNOSTICS msg=MESSAGE_TEXT;denied:=msg='Demo mapping evidence is immutable';END;
   IF NOT denied THEN RAISE EXCEPTION 'Workflow receipt mutated';END IF;

  END IF;
 END LOOP;
 SET LOCAL ROLE acquire_agent_user;
 result:=public.agent_effective_contact(legacy,person);
 IF result->>'mode' IS DISTINCT FROM 'demo' OR result->'demoProjection'->'recipients'->>'email' IS DISTINCT FROM 'lead-001@'||runid||'.leads.acquire.test' THEN RAISE EXCEPTION 'Registered legacy simulation projection failed';END IF;
 result:=public.agent_effective_contact(demo,otherperson);
 IF result->'demoProjection'->'recipients'->>'email' IS DISTINCT FROM 'lead-002@'||runid||'.leads.acquire.test' THEN RAISE EXCEPTION 'Workflow registered recipient projection failed';END IF;
 RESET ROLE;
 RAISE NOTICE 'PASS: synthetic registered legacy mapping/receipt projection preserved; workflow receipt accepted; cross-namespace aliases rejected; restricted-role simulated recipient projection';
END $$;
ROLLBACK;
