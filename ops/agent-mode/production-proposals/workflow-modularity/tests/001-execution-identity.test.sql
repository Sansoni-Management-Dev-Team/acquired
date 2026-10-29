-- PREPARED ONLY. Run only after exact migration/test target approval.
-- No DDL, no persistent fixture functions, no trigger disabling, no provider calls.
-- Every fixture and assertion runs inside one transaction that is rolled back.
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '20s';

DO $identity_target$
BEGIN
  IF current_database() IS DISTINCT FROM 'acquire_hosted_demo_rehearsal'
     OR shobj_description((SELECT oid FROM pg_database WHERE datname=current_database()), 'pg_database')
        IS DISTINCT FROM 'acquire-hosted-demo-rehearsal-only'
     OR (SELECT system_identifier::text FROM pg_control_system())
        IS DISTINCT FROM '7699248227334438947' THEN
    RAISE EXCEPTION 'Exact isolated workflow rehearsal database and cluster required';
  END IF;
  IF current_user IS DISTINCT FROM pg_get_userbyid(
    (SELECT relowner FROM pg_class WHERE oid='public.acquisition_workflow_executions'::regclass)
  ) THEN
    RAISE EXCEPTION 'Run rehearsal assertions as the workflow schema owner';
  END IF;
END
$identity_target$;

DO $execution_identity_tests$
DECLARE
  org text := gen_random_uuid()::text;
  foreign_org text := gen_random_uuid()::text;
  actor text := gen_random_uuid()::text;
  other_actor text := gen_random_uuid()::text;
  foreign_actor text := gen_random_uuid()::text;
  research_mandate uuid := gen_random_uuid();
  demo_mandate uuid := gen_random_uuid();
  other_mandate uuid := gen_random_uuid();
  foreign_mandate uuid := gen_random_uuid();
  research_execution uuid := gen_random_uuid();
  demo_execution uuid := gen_random_uuid();
  other_execution uuid := gen_random_uuid();
  foreign_execution uuid := gen_random_uuid();
  denied boolean;
  observed_constraint text;
  observed_message text;
  statement text;
  actor_role text;
  moment timestamptz;
  observed_count integer;
BEGIN
  -- Existing statement/row policy fences remain enabled and run normally.
  -- Schema-only rehearsal omits the baseline singleton data; seed transactionally.
 INSERT INTO public.communication_member_fence(singleton,writer_xid) VALUES(true,0) ON CONFLICT DO NOTHING;
 INSERT INTO public."user"(id,name,email) VALUES
    (actor,'Workflow identity owner',actor||'@example.invalid'),
    (other_actor,'Workflow identity second owner',other_actor||'@example.invalid'),
    (foreign_actor,'Workflow identity foreign owner',foreign_actor||'@example.invalid');
  INSERT INTO public.organization(id,name,slug) VALUES
    (org,'Workflow identity rehearsal',org),
    (foreign_org,'Workflow identity foreign rehearsal',foreign_org);
  INSERT INTO public.member(id,organization_id,user_id,role) VALUES
    (gen_random_uuid()::text,org,actor,'member'),
    (gen_random_uuid()::text,org,other_actor,'member'),
    (gen_random_uuid()::text,foreign_org,foreign_actor,'member');
  INSERT INTO public.mandates(id,organization_id,created_by,natural_language,filters,provenance) VALUES
    (research_mandate,org,actor,'Rehearsal only','{}','{}'),
    (demo_mandate,org,actor,'Rehearsal only','{}','{}'),
    (other_mandate,org,other_actor,'Rehearsal only','{}','{}'),
    (foreign_mandate,foreign_org,foreign_actor,'Rehearsal only','{}','{}');
  INSERT INTO public.acquisition_workflow_executions
    (id,organization_id,owner_user_id,mandate_id,input_digest,preset,presentation)
  VALUES
    (research_execution,org,actor,research_mandate,repeat('a',64),'live-research-test','agent'),
    (demo_execution,org,actor,demo_mandate,repeat('b',64),'demo','agent'),
    (other_execution,org,other_actor,other_mandate,repeat('c',64),'live-research-test','workspace'),
    (foreign_execution,foreign_org,foreign_actor,foreign_mandate,repeat('d',64),'live-research-test','workspace');

  -- Identity is immutable even for the table owner, independent of RLS grants.
  FOREACH statement IN ARRAY ARRAY[
    'id=gen_random_uuid()',
    'organization_id='||quote_literal(foreign_org),
    'owner_user_id='||quote_literal(other_actor),
    'mandate_id='||quote_literal(other_mandate::text)||'::uuid',
    'input_digest=repeat(''e'',64)',
    'preset=''live''',
    'presentation=''workspace''',
    'created_at=created_at-interval ''1 second'''
  ] LOOP
    denied:=false;
    BEGIN
      EXECUTE 'UPDATE public.acquisition_workflow_executions SET '||statement||
        ',revision=revision+1,updated_at=greatest(clock_timestamp(),updated_at) WHERE id=$1'
        USING research_execution;
    EXCEPTION WHEN SQLSTATE 'P0001' THEN
      GET STACKED DIAGNOSTICS observed_message=MESSAGE_TEXT;
      IF observed_message IS DISTINCT FROM 'Workflow execution identity and preset are immutable' THEN
        RAISE EXCEPTION 'Identity denial came from an unexpected guard: %',observed_message;
      END IF;
      denied:=true;
    END;
    IF NOT denied THEN RAISE EXCEPTION 'Identity mutation was accepted: %',statement; END IF;
  END LOOP;
  denied:=false;
  BEGIN
    DELETE FROM public.acquisition_workflow_executions WHERE id=research_execution;
  EXCEPTION WHEN SQLSTATE 'P0001' THEN
    GET STACKED DIAGNOSTICS observed_message=MESSAGE_TEXT;
    IF observed_message IS DISTINCT FROM 'Workflow execution identity and history cannot be deleted' THEN
      RAISE EXCEPTION 'Delete denial came from an unexpected guard: %',observed_message;
    END IF;
    denied:=true;
  END;
  IF NOT denied THEN RAISE EXCEPTION 'Execution deletion was accepted'; END IF;

  -- The active reservation index rejects a second research start for a mandate.
  denied:=false;
  BEGIN
    INSERT INTO public.acquisition_workflow_executions
      (id,organization_id,owner_user_id,mandate_id,input_digest,preset,presentation)
    VALUES(gen_random_uuid(),org,actor,research_mandate,repeat('e',64),'live-research-test','agent');
  EXCEPTION WHEN SQLSTATE '23505' THEN
    GET STACKED DIAGNOSTICS observed_constraint=CONSTRAINT_NAME;
    IF observed_constraint IS DISTINCT FROM 'acquisition_workflow_active_mandate_idx' THEN
      RAISE EXCEPTION 'Expected active-reservation uniqueness, got %',observed_constraint;
    END IF;
    denied:=true;
  END;
  IF NOT denied THEN RAISE EXCEPTION 'Concurrent active reservation was accepted'; END IF;

  -- Completing an outreach execution releases active uniqueness, but never its
  -- lifetime delivery identity. A new demo or real execution must still fail.
  SELECT greatest(clock_timestamp(),updated_at) INTO moment
    FROM public.acquisition_workflow_executions WHERE id=demo_execution;
  UPDATE public.acquisition_workflow_executions
    SET state='complete',revision=revision+1,updated_at=moment,finished_at=moment
    WHERE id=demo_execution;
  FOREACH statement IN ARRAY ARRAY['demo','live'] LOOP
    denied:=false;
    BEGIN
      INSERT INTO public.acquisition_workflow_executions
        (id,organization_id,owner_user_id,mandate_id,input_digest,preset,presentation)
      VALUES(gen_random_uuid(),org,actor,demo_mandate,repeat('e',64),statement,'agent');
    EXCEPTION WHEN SQLSTATE '23505' THEN
      GET STACKED DIAGNOSTICS observed_constraint=CONSTRAINT_NAME;
      IF observed_constraint IS DISTINCT FROM 'acquisition_workflow_outreach_mandate_idx' THEN
        RAISE EXCEPTION 'Expected lifetime-outreach uniqueness, got %',observed_constraint;
      END IF;
      denied:=true;
    END;
    IF NOT denied THEN RAISE EXCEPTION 'Second lifetime outreach execution was accepted'; END IF;
  END LOOP;

  denied:=false;
  BEGIN
    UPDATE public.acquisition_workflow_executions
      SET state='outreach',revision=revision+1,updated_at=greatest(clock_timestamp(),updated_at)
      WHERE id=research_execution;
  EXCEPTION WHEN SQLSTATE '23514' THEN
    GET STACKED DIAGNOSTICS observed_constraint=CONSTRAINT_NAME;
    IF observed_constraint IS DISTINCT FROM 'acquisition_workflow_research_only_state_check' THEN
      RAISE EXCEPTION 'Expected research-only prohibition, got %',observed_constraint;
    END IF;
    denied:=true;
  END;
  IF NOT denied THEN RAISE EXCEPTION 'Research-only outreach state was accepted'; END IF;

  -- Both exposed application roles must see only the exact current owner in a
  -- shared organization. Neither direct writes nor another organization leak.
  FOREACH actor_role IN ARRAY ARRAY['acquire_agent_user','acquire_campaign_user'] LOOP
    EXECUTE format('SET LOCAL ROLE %I',actor_role);
    PERFORM set_config('app.acquire_org',org,true);
    PERFORM set_config('app.acquire_user',actor,true);
    SELECT count(*) INTO observed_count FROM public.acquisition_workflow_executions
      WHERE organization_id=org;
    IF observed_count<>2 THEN RAISE EXCEPTION 'Owner did not see exactly its two executions under %',actor_role; END IF;
    IF EXISTS(SELECT 1 FROM public.acquisition_workflow_executions WHERE id IN(other_execution,foreign_execution)) THEN
      RAISE EXCEPTION 'Foreign owner/organization execution leaked under %',actor_role;
    END IF;
    PERFORM set_config('app.acquire_user',other_actor,true);
    SELECT count(*) INTO observed_count FROM public.acquisition_workflow_executions WHERE organization_id=org;
    IF observed_count<>1 OR NOT EXISTS(SELECT 1 FROM public.acquisition_workflow_executions WHERE id=other_execution) THEN
      RAISE EXCEPTION 'Same-organization owner isolation failed under %',actor_role;
    END IF;
    PERFORM set_config('app.acquire_user',actor,true);
    FOREACH statement IN ARRAY ARRAY['INSERT','UPDATE','DELETE','TRUNCATE'] LOOP
      IF has_table_privilege(current_user,'public.acquisition_workflow_executions',statement) THEN
        RAISE EXCEPTION 'Unexpected direct % privilege under %',statement,actor_role;
      END IF;
    END LOOP;
    FOREACH statement IN ARRAY ARRAY[
      'INSERT INTO public.acquisition_workflow_executions(id,organization_id,owner_user_id,mandate_id,input_digest,preset,presentation) VALUES(gen_random_uuid(),$1,$2,$4,repeat(''e'',64),''demo'',''agent'')',
      'UPDATE public.acquisition_workflow_executions SET state=''ready'',revision=revision+1,updated_at=clock_timestamp() WHERE id=$3',
      'DELETE FROM public.acquisition_workflow_executions WHERE id=$3'
    ] LOOP
      denied:=false;
      BEGIN
        EXECUTE statement USING org,actor,research_execution,research_mandate;
      EXCEPTION WHEN SQLSTATE '42501' THEN denied:=true;
      END;
      IF NOT denied THEN RAISE EXCEPTION 'Direct actor write was accepted under %',actor_role; END IF;
    END LOOP;
    EXECUTE 'RESET ROLE';
  END LOOP;

  -- Revocation must remove read visibility without deleting historical rows.
  DELETE FROM public.member WHERE organization_id=org AND user_id=actor;
  FOREACH actor_role IN ARRAY ARRAY['acquire_agent_user','acquire_campaign_user'] LOOP
    EXECUTE format('SET LOCAL ROLE %I',actor_role);
    PERFORM set_config('app.acquire_org',org,true);
    PERFORM set_config('app.acquire_user',actor,true);
    IF EXISTS(SELECT 1 FROM public.acquisition_workflow_executions WHERE organization_id=org) THEN
      RAISE EXCEPTION 'Revoked membership retained workflow visibility under %',actor_role;
    END IF;
    EXECUTE 'RESET ROLE';
  END LOOP;
  SELECT count(*) INTO observed_count FROM public.acquisition_workflow_executions
    WHERE id IN(research_execution,demo_execution,other_execution,foreign_execution);
  IF observed_count<>4 THEN RAISE EXCEPTION 'Historical fixture execution rows were unexpectedly changed'; END IF;
  RAISE NOTICE 'PASS: execution identity, reservation uniqueness, lifetime uniqueness, research-only state, actor isolation and revoked membership';
END
$execution_identity_tests$;

ROLLBACK;
