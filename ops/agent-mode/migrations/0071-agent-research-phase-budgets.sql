-- Whole-phase escrow. Unknown physical receipts retain their own reservations;
-- transfers never reset usage or count the same money twice.
CREATE TABLE public.agent_research_phase_budgets(
 operation_id uuid PRIMARY KEY REFERENCES public.agent_operations(id) ON DELETE CASCADE,
 organization_id text NOT NULL REFERENCES public.organization(id),owner_user_id text NOT NULL REFERENCES public."user"(id),
 input_digest text NOT NULL CHECK(input_digest~'^[a-f0-9]{64}$'),calls_ceiling bigint NOT NULL CHECK(calls_ceiling BETWEEN 1 AND 1000),usd_ceiling bigint NOT NULL CHECK(usd_ceiling BETWEEN 1 AND 1000000000),
 deadline timestamptz NOT NULL,state text NOT NULL DEFAULT 'active' CHECK(state IN('active','released')),released_reason text,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE public.agent_research_phase_allocations(
 operation_id uuid NOT NULL REFERENCES public.agent_research_phase_budgets(operation_id) ON DELETE CASCADE,
 account_id uuid NOT NULL REFERENCES public.agent_budget_accounts(id) ON DELETE CASCADE,
 organization_id text NOT NULL,owner_user_id text NOT NULL,
 initial_amount bigint NOT NULL CHECK(initial_amount>0),remaining_amount bigint NOT NULL CHECK(remaining_amount>=0 AND remaining_amount<=initial_amount),
 PRIMARY KEY(operation_id,account_id)
);
ALTER TABLE public.agent_research_phase_budgets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_research_phase_budgets FORCE ROW LEVEL SECURITY;
ALTER TABLE public.agent_research_phase_allocations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_research_phase_allocations FORCE ROW LEVEL SECURITY;
CREATE POLICY agent_phase_budget_read ON public.agent_research_phase_budgets FOR SELECT TO acquire_agent_user USING(organization_id=current_setting('app.acquire_org',true) AND owner_user_id=current_setting('app.acquire_user',true) AND EXISTS(SELECT 1 FROM public.member WHERE organization_id=current_setting('app.acquire_org',true) AND user_id=current_setting('app.acquire_user',true)));
CREATE POLICY agent_phase_allocation_read ON public.agent_research_phase_allocations FOR SELECT TO acquire_agent_user USING(organization_id=current_setting('app.acquire_org',true) AND owner_user_id=current_setting('app.acquire_user',true) AND EXISTS(SELECT 1 FROM public.member WHERE organization_id=current_setting('app.acquire_org',true) AND user_id=current_setting('app.acquire_user',true)));
REVOKE ALL ON public.agent_research_phase_budgets,public.agent_research_phase_allocations FROM PUBLIC,acquire_agent_user,acquire_campaign_user,acquire_agent_worker;
CREATE POLICY agent_phase_definer ON public.agent_research_phase_budgets TO PUBLIC USING(current_user=pg_get_userbyid((SELECT relowner FROM pg_class WHERE oid='public.agent_research_phase_budgets'::regclass))) WITH CHECK(current_user=pg_get_userbyid((SELECT relowner FROM pg_class WHERE oid='public.agent_research_phase_budgets'::regclass)));
CREATE POLICY agent_phase_definer ON public.agent_research_phase_allocations TO PUBLIC USING(current_user=pg_get_userbyid((SELECT relowner FROM pg_class WHERE oid='public.agent_research_phase_allocations'::regclass))) WITH CHECK(current_user=pg_get_userbyid((SELECT relowner FROM pg_class WHERE oid='public.agent_research_phase_allocations'::regclass)));
GRANT SELECT ON public.agent_research_phase_budgets,public.agent_research_phase_allocations TO acquire_agent_user;
CREATE FUNCTION public.agent_research_phase_budget_status(p_operation uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE org text:=current_setting('app.acquire_org',true);actor text:=current_setting('app.acquire_user',true);p public.agent_research_phase_budgets%ROWTYPE;valid integer;
BEGIN
 PERFORM public.agent_assert_control_scope();
 IF NOT EXISTS(SELECT 1 FROM public.agent_operations WHERE id=p_operation AND organization_id=org AND owner_user_id=actor AND name IN('research.start','research.people','research.fields')) THEN RAISE EXCEPTION 'Owned research phase required';END IF;
 SELECT * INTO p FROM public.agent_research_phase_budgets WHERE operation_id=p_operation AND organization_id=org AND owner_user_id=actor;
 IF p.operation_id IS NULL THEN RETURN jsonb_build_object('ready',false,'reason','phase_funding_required');END IF;
 SELECT count(*) INTO valid FROM public.agent_research_phase_allocations x JOIN public.agent_budget_accounts a ON a.id=x.account_id AND a.organization_id=x.organization_id WHERE x.operation_id=p_operation AND x.organization_id=org AND x.owner_user_id=actor AND a.window_start<=clock_timestamp() AND a.window_end>clock_timestamp() AND a.spent+a.reserved<=a.cap;
 RETURN jsonb_build_object('ready',p.state='active' AND p.deadline>clock_timestamp() AND valid=6 AND EXISTS(SELECT 1 FROM public.agent_operations o WHERE o.id=p_operation AND o.input_digest=p.input_digest AND EXISTS(SELECT 1 FROM public.agent_responsibilities r JOIN public.mandates m ON m.id=r.mandate_id AND m.organization_id=r.organization_id WHERE r.id=(o.input->>'responsibilityId')::uuid AND r.thread_id=o.thread_id AND r.organization_id=org AND r.owner_user_id=actor AND r.state IN('ready','waiting') AND r.revision::text=o.input->>'responsibilityRevision' AND r.mandate_revision=o.input->>'mandateRevision' AND m.xmin::text=r.mandate_revision)),'state',p.state,'reason',CASE WHEN p.state<>'active' THEN 'phase_closed' WHEN p.deadline<=clock_timestamp() THEN 'phase_expired_review_required' WHEN valid<>6 THEN 'phase_limits_changed' ELSE NULL END,'calls',p.calls_ceiling::text,'usdMicro',p.usd_ceiling::text,'deadline',p.deadline);
END $$;
REVOKE ALL ON FUNCTION public.agent_research_phase_budget_status(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.agent_research_phase_budget_status(uuid) TO acquire_agent_user;
CREATE FUNCTION public.agent_reserve_research_phase(p_operation uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE org text:=current_setting('app.acquire_org',true);actor text:=current_setting('app.acquire_user',true);o public.agent_operations%ROWTYPE;p public.agent_research_phase_budgets%ROWTYPE;j public.research_jobs%ROWTYPE;a public.agent_budget_accounts%ROWTYPE;entry record;count_scopes integer:=0;calls bigint;usd bigint;n integer;deadline timestamptz;accounts uuid[]:='{}';shortfalls jsonb:='[]';needed bigint;
BEGIN
 PERFORM public.agent_assert_control_scope();
 SELECT * INTO o FROM public.agent_operations WHERE id=p_operation AND organization_id=org AND owner_user_id=actor AND name IN('research.start','research.people','research.fields') AND state IN('approved','running') FOR UPDATE;
 IF o.id IS NULL THEN RAISE EXCEPTION 'Approved owned research phase required';END IF;
 IF NOT EXISTS(SELECT 1 FROM public.agent_responsibilities r JOIN public.mandates m ON m.id=r.mandate_id AND m.organization_id=r.organization_id WHERE r.id=(o.input->>'responsibilityId')::uuid AND r.thread_id=o.thread_id AND r.organization_id=org AND r.owner_user_id=actor AND r.state IN('ready','waiting') AND r.revision::text=o.input->>'responsibilityRevision' AND r.mandate_revision=o.input->>'mandateRevision' AND m.xmin::text=r.mandate_revision) THEN RAISE EXCEPTION 'Current research phase supervision required';END IF;
 IF NOT EXISTS(SELECT 1 FROM public.agent_review_batches b WHERE b.thread_id=o.thread_id AND b.organization_id=org AND b.owner_user_id=actor AND b.state='approved' AND b.manifest @> jsonb_build_array(jsonb_build_object('operationId',o.id,'revision',o.revision,'digest',o.input_digest,'contextRevision',o.input->>'contextRevision'))) THEN RAISE EXCEPTION 'Exact research phase approval required';END IF;
 IF o.name='research.start' AND o.input->>'nativeResearchPlanVersion'='1' AND o.input->'execution'->>'productionPipeline'='hybrid-firmable-v1' AND o.input->'providerPolicy'->'maxAttempts'='{"search":6,"page":5,"ai":0,"firmable":60}'::jsonb THEN calls:=71;
 ELSIF o.name='research.start' AND o.input->>'nativeResearchPlanVersion'='1' AND o.input->'execution'->>'productionPipeline'='firmable-v1' AND o.input->'providerPolicy'->'maxAttempts'='{"search":6,"page":5,"ai":5,"firmable":60}'::jsonb THEN calls:=76;
 ELSIF o.name='research.people' AND o.input->>'nativePeoplePlanVersion'='1' AND o.input->'providerPolicy'->'maxAttempts'='{"search":0,"page":0,"ai":0,"firmable":60}'::jsonb THEN calls:=60;
 ELSIF o.name='research.fields' AND o.input->>'nativeFieldsPlanVersion'='1' AND o.input->'providerPolicy'->'maxAttempts'='{"search":60,"page":320,"ai":0,"firmable":0}'::jsonb AND o.input->'providerPolicy'->'perCompany'='{"search":12,"page":64}'::jsonb THEN n:=jsonb_array_length(o.input->'selected');IF n IS NULL OR n NOT BETWEEN 1 AND 5 THEN RAISE EXCEPTION 'Exact bounded public-field selection required';END IF;calls:=n*76;
 ELSE RAISE EXCEPTION 'Frozen physical research policy required';END IF;
 IF o.input->'providerPolicy'->>'requestCeilingMicroUsd' IS DISTINCT FROM '1000000' THEN RAISE EXCEPTION 'Frozen request reservation ceiling required';END IF;usd:=calls*1000000;
 SELECT * INTO p FROM public.agent_research_phase_budgets WHERE operation_id=o.id FOR UPDATE;
 IF p.operation_id IS NOT NULL THEN IF p.input_digest IS DISTINCT FROM o.input_digest THEN RAISE EXCEPTION 'Research funding belongs to another manifest';END IF;RETURN public.agent_research_phase_budget_status(o.id);END IF;
 SELECT * INTO j FROM public.research_jobs WHERE id=(o.input->'config'->>'requestId')::uuid AND organization_id=org AND mandate_id=o.mandate_id AND created_by=actor AND config->'nativeAgent'->>'operationId'=o.id::text FOR UPDATE;
 IF j.id IS NULL OR j.status NOT IN('queued','discovering','extracting','crawling') THEN RAISE EXCEPTION 'Saved unfinished research job required';END IF;
 IF EXISTS(SELECT 1 FROM public.agent_operations child WHERE child.thread_id=o.thread_id AND child.input->>'researchOperationId'=o.id::text AND child.name IN('research.provider','research.worker_dispatch')) THEN RAISE EXCEPTION 'Original research attempts require reconciliation before phase funding';END IF;
 deadline:=clock_timestamp()+interval '10 minutes';
 FOR entry IN SELECT scope_key,unit FROM(VALUES('organization:calls','calls'),('organization:usd_micro','usd_micro'),('user:'||actor||':calls','calls'),('user:'||actor||':usd_micro','usd_micro'),('mandate:'||o.mandate_id::text||':calls','calls'),('mandate:'||o.mandate_id::text||':usd_micro','usd_micro'))x(scope_key,unit) ORDER BY scope_key LOOP
  SELECT * INTO a FROM public.agent_budget_accounts b WHERE b.organization_id=org AND b.scope_key=entry.scope_key AND b.unit=entry.unit AND b.window_start<=clock_timestamp() AND b.window_end>clock_timestamp() ORDER BY b.window_start DESC,b.id LIMIT 1 FOR UPDATE;
  needed:=CASE WHEN entry.unit='calls' THEN calls ELSE usd END;
  IF a.id IS NULL OR a.window_end<deadline+interval '2 minutes' OR a.cap-a.spent-a.reserved<needed THEN shortfalls:=shortfalls||jsonb_build_array(jsonb_build_object('scopeKey',entry.scope_key,'unit',entry.unit,'needed',needed::text,'available',greatest(coalesce(a.cap-a.spent-a.reserved,0),0)::text,'windowCoversPhase',coalesce(a.window_end>=deadline+interval '2 minutes',false)));ELSE accounts:=array_append(accounts,a.id);count_scopes:=count_scopes+1;END IF;
 END LOOP;
 IF count_scopes<>6 THEN RETURN jsonb_build_object('ready',false,'reason','phase_funding_required','calls',calls::text,'usdMicro',usd::text,'shortfalls',shortfalls);END IF;
 INSERT INTO public.agent_research_phase_budgets(operation_id,organization_id,owner_user_id,input_digest,calls_ceiling,usd_ceiling,deadline)VALUES(o.id,org,actor,o.input_digest,calls,usd,deadline);
 FOR a IN SELECT * FROM public.agent_budget_accounts WHERE id=ANY(accounts) ORDER BY id LOOP needed:=CASE WHEN a.unit='calls' THEN calls ELSE usd END;INSERT INTO public.agent_research_phase_allocations(operation_id,account_id,organization_id,owner_user_id,initial_amount,remaining_amount)VALUES(o.id,a.id,org,actor,needed,needed);UPDATE public.agent_budget_accounts SET reserved=reserved+needed WHERE id=a.id;END LOOP;
 UPDATE public.research_jobs SET config=config||jsonb_build_object('automaticDeadline',(extract(epoch FROM deadline)*1000)::bigint),updated_at=clock_timestamp() WHERE id=j.id;
 RETURN public.agent_research_phase_budget_status(o.id);
END $$;
REVOKE ALL ON FUNCTION public.agent_reserve_research_phase(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.agent_reserve_research_phase(uuid) TO acquire_agent_user;
CREATE FUNCTION public.agent_transfer_research_phase_attempt(p_parent uuid,p_attempt uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE org text:=current_setting('app.acquire_org',true);actor text:=current_setting('app.acquire_user',true);parent public.agent_operations%ROWTYPE;child public.agent_operations%ROWTYPE;p public.agent_research_phase_budgets%ROWTYPE;x record;amount bigint;prior integer;result jsonb:='[]';
BEGIN
 PERFORM public.agent_assert_control_scope();
 SELECT * INTO parent FROM public.agent_operations WHERE id=p_parent AND organization_id=org AND owner_user_id=actor AND name IN('research.start','research.people','research.fields') AND state='running' FOR UPDATE;
 SELECT * INTO child FROM public.agent_operations WHERE id=p_attempt AND thread_id=parent.thread_id AND organization_id=org AND owner_user_id=actor AND name='research.provider' AND state='running' FOR UPDATE;
 IF parent.id IS NULL OR child.id IS NULL OR child.input->>'researchOperationId' IS DISTINCT FROM parent.id::text OR child.input->>'researchJobId' IS DISTINCT FROM parent.input->'config'->>'requestId' THEN RAISE EXCEPTION 'Exact current research attempt required';END IF;
 SELECT * INTO p FROM public.agent_research_phase_budgets WHERE operation_id=parent.id AND organization_id=org AND owner_user_id=actor FOR UPDATE;
 IF p.operation_id IS NULL OR p.state<>'active' OR p.input_digest IS DISTINCT FROM parent.input_digest OR p.deadline<=clock_timestamp() OR NOT(public.agent_research_phase_budget_status(parent.id)->>'ready')::boolean THEN RAISE EXCEPTION 'Complete current phase funding required';END IF;
 IF child.input->>'provider' IS NULL OR child.input->>'provider' NOT IN('search','page','ai','firmable') OR NOT(parent.input->'providerPolicy'->'maxAttempts' ? (child.input->>'provider')) OR (SELECT count(*) FROM public.agent_operations a WHERE a.thread_id=parent.thread_id AND a.name='research.provider' AND a.input->>'researchOperationId'=parent.id::text AND a.input->>'provider'=child.input->>'provider')>(parent.input->'providerPolicy'->'maxAttempts'->>(child.input->>'provider'))::integer THEN RAISE EXCEPTION 'Frozen provider attempt ceiling required';END IF;
 IF parent.name='research.fields' AND (NOT EXISTS(SELECT 1 FROM jsonb_array_elements(parent.input->'selected')s WHERE s->>'targetId'=child.input->>'targetId') OR child.input->>'provider' NOT IN('search','page') OR (SELECT count(*) FROM public.agent_operations a WHERE a.thread_id=parent.thread_id AND a.name='research.provider' AND a.input->>'researchOperationId'=parent.id::text AND a.input->>'targetId'=child.input->>'targetId' AND a.input->>'provider'=child.input->>'provider')>(parent.input->'providerPolicy'->'perCompany'->>(child.input->>'provider'))::integer) THEN RAISE EXCEPTION 'Frozen public company attempt ceiling required';END IF;
 SELECT count(*) INTO prior FROM public.agent_budget_reservations WHERE operation_id=child.id;
 IF prior NOT IN(0,6) THEN RAISE EXCEPTION 'Partial research attempt reservation';END IF;
 IF prior=6 THEN IF(SELECT count(*) FROM public.agent_budget_reservations r JOIN public.agent_research_phase_allocations a ON a.operation_id=parent.id AND a.account_id=r.account_id JOIN public.agent_budget_accounts b ON b.id=r.account_id WHERE r.operation_id=child.id AND r.organization_id=org AND r.owner_user_id=actor AND r.state='reserved' AND r.amount=CASE WHEN b.unit='calls' THEN 1 WHEN b.unit='usd_micro' THEN 1000000 ELSE NULL END)<>6 THEN RAISE EXCEPTION 'Original research attempt allocation changed';END IF;RETURN jsonb_build_object('replay',true);END IF;
 IF(SELECT count(*) FROM public.agent_research_phase_allocations WHERE operation_id=parent.id)<>6 THEN RAISE EXCEPTION 'Exact six-account research allocation required';END IF;
 FOR x IN SELECT a.account_id,a.remaining_amount,b.unit FROM public.agent_research_phase_allocations a JOIN public.agent_budget_accounts b ON b.id=a.account_id AND b.organization_id=org WHERE a.operation_id=parent.id ORDER BY a.account_id FOR UPDATE OF a,b LOOP
  amount:=CASE WHEN x.unit='calls' THEN 1 WHEN x.unit='usd_micro' THEN 1000000 ELSE NULL END;
  IF amount IS NULL OR x.remaining_amount<amount THEN RAISE EXCEPTION 'Research phase allocation exhausted';END IF;
  UPDATE public.agent_research_phase_allocations SET remaining_amount=remaining_amount-amount WHERE operation_id=parent.id AND account_id=x.account_id;
  INSERT INTO public.agent_budget_reservations(operation_id,account_id,organization_id,owner_user_id,amount,state)VALUES(child.id,x.account_id,org,actor,amount,'reserved');
  result:=result||jsonb_build_array(jsonb_build_object('accountId',x.account_id,'amount',amount::text));
 END LOOP;RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.agent_transfer_research_phase_attempt(uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.agent_transfer_research_phase_attempt(uuid,uuid) TO acquire_agent_user;
CREATE FUNCTION public.agent_release_research_phase_internal(p_operation uuid,p_reason text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE p public.agent_research_phase_budgets%ROWTYPE;x record;
BEGIN
 SELECT * INTO p FROM public.agent_research_phase_budgets WHERE operation_id=p_operation FOR UPDATE;IF p.operation_id IS NULL OR p.state='released' THEN RETURN;END IF;
 IF NOT EXISTS(SELECT 1 FROM public.communication_send_gates WHERE organization_id=p.organization_id AND writer_xid=txid_current()) THEN RAISE EXCEPTION 'Held research budget writer required';END IF;
 FOR x IN SELECT a.account_id,a.remaining_amount FROM public.agent_research_phase_allocations a WHERE a.operation_id=p_operation ORDER BY a.account_id FOR UPDATE LOOP UPDATE public.agent_budget_accounts SET reserved=reserved-x.remaining_amount WHERE id=x.account_id AND organization_id=p.organization_id;UPDATE public.agent_research_phase_allocations SET remaining_amount=0 WHERE operation_id=p_operation AND account_id=x.account_id;END LOOP;
 UPDATE public.agent_research_phase_budgets SET state='released',released_reason=left(p_reason,100),updated_at=clock_timestamp() WHERE operation_id=p_operation;
END $$;
REVOKE ALL ON FUNCTION public.agent_release_research_phase_internal(uuid,text) FROM PUBLIC;
CREATE FUNCTION public.agent_release_finished_research_budget() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN PERFORM public.agent_release_research_phase_internal(NEW.id,'phase_'||NEW.state);RETURN NEW;END $$;
REVOKE ALL ON FUNCTION public.agent_release_finished_research_budget() FROM PUBLIC;
CREATE TRIGGER agent_research_budget_terminal AFTER UPDATE OF state ON public.agent_operations FOR EACH ROW WHEN(OLD.state IS DISTINCT FROM NEW.state AND NEW.name IN('research.start','research.people','research.fields') AND NEW.state IN('complete','failed','cancelled','rejected')) EXECUTE FUNCTION public.agent_release_finished_research_budget();
CREATE FUNCTION public.agent_release_changed_research_budget() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE o record;
BEGIN FOR o IN SELECT p.operation_id FROM public.agent_research_phase_budgets p JOIN public.agent_operations op ON op.id=p.operation_id WHERE p.organization_id=NEW.organization_id AND p.state='active' AND op.thread_id=NEW.thread_id AND op.input->>'responsibilityId'=NEW.id::text AND (NEW.state NOT IN('ready','waiting') OR op.input->>'responsibilityRevision' IS DISTINCT FROM NEW.revision::text OR op.input->>'mandateRevision' IS DISTINCT FROM NEW.mandate_revision) LOOP PERFORM public.agent_release_research_phase_internal(o.operation_id,'supervision_changed');END LOOP;RETURN NEW;END $$;
REVOKE ALL ON FUNCTION public.agent_release_changed_research_budget() FROM PUBLIC;
CREATE TRIGGER agent_research_budget_supervision AFTER UPDATE OF state,revision,mandate_revision ON public.agent_responsibilities FOR EACH ROW EXECUTE FUNCTION public.agent_release_changed_research_budget();

-- Each immutable child owns its normal background execution slot; the root
-- retains the unique phase slot. No saved job is rewritten.
CREATE OR REPLACE FUNCTION public.agent_create_fields_job(operation uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE org text:=current_setting('app.acquire_org',true);actor text:=current_setting('app.acquire_user',true);o public.agent_operations%ROWTYPE;j public.research_jobs%ROWTYPE;child public.research_jobs%ROWTYPE;snapshot jsonb;item jsonb;current_item jsonb;ids uuid[];job uuid;cfg jsonb;child_cfg jsonb;scope_count integer;
BEGIN
 PERFORM public.agent_assert_control_scope();
 SELECT * INTO o FROM public.agent_operations WHERE id=operation AND organization_id=org AND owner_user_id=actor AND name='research.fields' AND state IN('approved','running') FOR UPDATE;
 IF o.id IS NULL OR o.input->>'nativeFieldsPlanVersion' IS DISTINCT FROM '1' OR o.input->'execution' IS DISTINCT FROM '{"pipeline":"public-fields-v1","peopleResearch":false,"ai":false}'::jsonb OR o.input->'providerPolicy' IS DISTINCT FROM '{"version":1,"requestCeilingMicroUsd":"1000000","perCompany":{"search":12,"page":64},"maxAttempts":{"search":60,"page":320,"ai":0,"firmable":0}}'::jsonb OR jsonb_typeof(o.input->'selected') IS DISTINCT FROM 'array' OR coalesce(jsonb_array_length(o.input->'selected'),0) NOT BETWEEN 1 AND 5 THEN RAISE EXCEPTION 'Exact reviewed bounded public-field plan required';END IF;
 IF NOT EXISTS(SELECT 1 FROM public.agent_review_batches b WHERE b.thread_id=o.thread_id AND b.organization_id=org AND b.owner_user_id=actor AND b.state='approved' AND b.manifest @> jsonb_build_array(jsonb_build_object('operationId',o.id,'revision',o.revision,'digest',o.input_digest,'contextRevision',o.input->>'contextRevision'))) THEN RAISE EXCEPTION 'Exact public-field approval required';END IF;
 SELECT array_agg((s->>'targetId')::uuid) INTO ids FROM jsonb_array_elements(o.input->'selected') s;
 IF cardinality(ids)<>(SELECT count(DISTINCT x) FROM unnest(ids)x) THEN RAISE EXCEPTION 'Distinct company selection required';END IF;
 snapshot:=public.agent_fields_company_snapshot(o.thread_id,(o.input->>'sourceRootId')::uuid,ids,o.id);
 IF snapshot->>'mandateRevision' IS DISTINCT FROM o.input->>'mandateRevision' OR snapshot->>'responsibilityId' IS DISTINCT FROM o.input->>'responsibilityId' OR snapshot->>'responsibilityRevision' IS DISTINCT FROM o.input->>'responsibilityRevision' THEN RAISE EXCEPTION 'Public-field supervision changed';END IF;
 FOR item IN SELECT value FROM jsonb_array_elements(o.input->'selected') LOOP
  SELECT value INTO current_item FROM jsonb_array_elements(snapshot->'companies') WHERE value->>'targetId'=item->>'targetId';
  IF current_item IS NULL OR current_item->>'sourceRevision' IS DISTINCT FROM item->>'sourceRevision' OR current_item->>'domain' IS DISTINCT FROM item->>'domain' OR jsonb_array_length(current_item->'blockedReasons')<>0 OR jsonb_typeof(item->'verifyAbn') IS DISTINCT FROM 'boolean' OR jsonb_typeof(item->'fields') IS DISTINCT FROM 'array' OR jsonb_array_length(item->'fields')>9 OR EXISTS(SELECT 1 FROM jsonb_array_elements_text(item->'fields')f WHERE f NOT IN('description','company_emails','company_phones','year_founded','acn','website_address','employee_count','revenue','accreditations')) OR (jsonb_array_length(item->'fields')=0 AND item->>'verifyAbn'<>'true') THEN RAISE EXCEPTION 'Saved public company or field scope changed';END IF;
 END LOOP;
 job:=(o.input->'config'->>'requestId')::uuid;
 SELECT * INTO j FROM public.research_jobs WHERE id=job FOR UPDATE;
 IF j.id IS NOT NULL AND (j.organization_id IS DISTINCT FROM org OR j.mandate_id IS DISTINCT FROM o.mandate_id OR j.created_by IS DISTINCT FROM actor OR j.config->'nativeAgent'->>'operationId' IS DISTINCT FROM o.id::text) THEN RAISE EXCEPTION 'Public-field handle belongs to different work';END IF;
 cfg:=jsonb_build_object('approved',true,'workflow','business','mode','automatic','discover',false,'findPeople',false,'includeCompanyPeople',false,'seeds','[]'::jsonb,'searchTerms','[]'::jsonb,'geography','Australia','researchScope','Reviewed public company fields','researchRunId',job,'executionSlot','agent-fields:'||o.thread_id,'automaticDeadline',0,'nativeFieldsSourceRootId',o.input->>'sourceRootId','budget',jsonb_build_object('maxPages',320,'maxDomains',50,'maxMinutes',10,'maxModelCalls',0),'nativeAgent',jsonb_build_object('version',1,'operationId',o.id,'threadId',o.thread_id,'responsibilityId',o.input->>'responsibilityId','responsibilityRevision',(o.input->>'responsibilityRevision')::integer,'mandateRevision',o.input->>'mandateRevision','contextRevision',o.input->>'contextRevision','providerAdmission','required'));
 IF j.id IS NULL THEN INSERT INTO public.research_jobs(id,organization_id,mandate_id,created_by,status,config,seeds,message) VALUES(job,org,o.mandate_id,actor,'queued',cfg,'[]','Reviewed public company fields saved');ELSE cfg:=j.config;END IF;
 FOR item IN SELECT value FROM jsonb_array_elements(o.input->'selected') LOOP
  SELECT * INTO child FROM public.research_jobs WHERE id=(item->>'childJobId')::uuid FOR UPDATE;
  IF child.id IS NOT NULL AND (child.organization_id IS DISTINCT FROM org OR child.mandate_id IS DISTINCT FROM o.mandate_id OR child.created_by IS DISTINCT FROM actor OR child.config->'nativeAgent'->>'operationId' IS DISTINCT FROM o.id::text OR child.config->>'targetId' IS DISTINCT FROM item->>'targetId' OR child.config->>'parentJobId' IS DISTINCT FROM job::text OR child.config->>'executionSlot' IS DISTINCT FROM 'company-background:'||(item->>'childJobId') OR child.config->>'nativeFieldsSourceRevision' IS DISTINCT FROM item->>'sourceRevision' OR child.config->'companyBackgroundResearch'->'fields' IS DISTINCT FROM item->'fields' OR child.config->'companyBackgroundResearch'->'verifyAbn' IS DISTINCT FROM item->'verifyAbn') THEN RAISE EXCEPTION 'Public-field child handle belongs to different work';END IF;
  child_cfg:=cfg||jsonb_build_object('executionSlot','company-background:'||(item->>'childJobId'),'researchTask','field','purpose','firmographics','parentJobId',job,'targetId',item->>'targetId','companyName',item->>'name','companyDomain',item->>'domain','nativeFieldsSourceRevision',item->>'sourceRevision','companyBackgroundResearch',jsonb_build_object('version',1,'fields',item->'fields','sourceRootId',o.input->>'sourceRootId','profileCapturedAt',clock_timestamp(),'verifyAbn',(item->>'verifyAbn')::boolean));
  IF child.id IS NULL THEN INSERT INTO public.research_jobs(id,organization_id,mandate_id,created_by,status,config,seeds,message) VALUES((item->>'childJobId')::uuid,org,o.mandate_id,actor,'queued',child_cfg,'[]','Exact public-field child saved; separate native root dispatch required');END IF;
 END LOOP;
 SELECT count(*) INTO scope_count FROM(SELECT DISTINCT ON(scope_key)scope_key,unit,cap,spent,reserved FROM public.agent_budget_accounts WHERE organization_id=org AND window_start<=clock_timestamp() AND window_end>clock_timestamp() AND scope_key=ANY(ARRAY['organization:calls','organization:usd_micro','user:'||actor||':calls','user:'||actor||':usd_micro','mandate:'||o.mandate_id::text||':calls','mandate:'||o.mandate_id::text||':usd_micro'])ORDER BY scope_key,window_start DESC,id)a WHERE scope_key LIKE '%:'||unit AND((unit='calls' AND cap-spent-reserved>=1)OR(unit='usd_micro' AND cap-spent-reserved>=1000000));
 IF scope_count<>6 THEN RETURN jsonb_build_object('jobId',job,'status',coalesce(j.status,'queued'),'dispatchReady',false,'blockedReason','provider_budget_required');END IF;
 IF cfg->'nativeAgent'->>'providerAdmission' IS DISTINCT FROM 'public-fields-v1' THEN UPDATE public.research_jobs SET config=jsonb_set(config||jsonb_build_object('automaticDeadline',(extract(epoch FROM clock_timestamp())*1000)::bigint+600000),'{nativeAgent,providerAdmission}','"public-fields-v1"'),message='Exact public company fields ready' WHERE id=job;END IF;
 RETURN jsonb_build_object('jobId',job,'status',coalesce(j.status,'queued'),'dispatchReady',true);
END $$;
