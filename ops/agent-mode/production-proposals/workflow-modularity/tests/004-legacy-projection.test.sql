-- Rollback-only exact rehearsal: legacy row-shape and no real-recipient fallback.
BEGIN;
SET LOCAL lock_timeout='3s';
SET LOCAL statement_timeout='20s';
DO $$ BEGIN
 IF current_database() IS DISTINCT FROM 'acquire_hosted_demo_rehearsal' OR (SELECT system_identifier::text FROM pg_control_system()) IS DISTINCT FROM '7699248227334438947' OR shobj_description((SELECT oid FROM pg_database WHERE datname=current_database()),'pg_database') IS DISTINCT FROM 'acquire-hosted-demo-rehearsal-only' THEN RAISE EXCEPTION 'Exact isolated rehearsal required'; END IF;
END $$;
DO $$
DECLARE org text:=gen_random_uuid()::text; actor text:=gen_random_uuid()::text; legacy uuid:=gen_random_uuid(); live uuid:=gen_random_uuid(); demo uuid:=gen_random_uuid(); person uuid:=gen_random_uuid(); otherperson uuid:=gen_random_uuid(); realperson uuid:=gen_random_uuid(); result jsonb; expected jsonb; denied boolean; msg text;
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
 SET LOCAL ROLE acquire_agent_user;
 PERFORM set_config('app.acquire_org',org,true);PERFORM set_config('app.acquire_user',actor,true);
 result:=public.agent_effective_contact(live,realperson);
 IF result->>'mode' IS DISTINCT FROM 'real' OR result->'demoProjection' IS DISTINCT FROM 'null'::jsonb OR result->'sourceContact'->>'id' IS DISTINCT FROM realperson::text THEN RAISE EXCEPTION 'Legacy real contact changed';END IF;
 denied:=false;
 BEGIN PERFORM public.agent_effective_contact(legacy,person);EXCEPTION WHEN raise_exception THEN GET STACKED DIAGNOSTICS msg=MESSAGE_TEXT;denied:=msg='Current immutable demo recipients are unavailable; real contact fallback is disabled.';END;
 IF NOT denied THEN RAISE EXCEPTION 'Legacy demo missing mapping did not reject real fallback';END IF;
 denied:=false;
 BEGIN PERFORM public.agent_effective_contact(demo,otherperson);EXCEPTION WHEN raise_exception THEN GET STACKED DIAGNOSTICS msg=MESSAGE_TEXT;denied:=msg='Current immutable demo recipients are unavailable; real contact fallback is disabled.';END;
 IF NOT denied THEN RAISE EXCEPTION 'Workflow demo missing mapping did not reject real fallback';END IF;
 RESET ROLE;
 RAISE NOTICE 'PASS: unchanged legacy real/demo mode row shape; workflow v1 demo identity; restricted-role real projection; missing legacy/workflow mappings reject real fallback';
END $$;
ROLLBACK;
