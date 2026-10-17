-- PREPARED, NOT APPLIED. Requires separate approval for this exact artifact.
-- New native execution state; no historical enrolment/runtime/backfill changes.
-- Forward expansion; the applied0005 artifact remains immutable.
ALTER TABLE agent_authority_grants DROP CONSTRAINT agent_authority_grants_actions_check;
ALTER TABLE agent_authority_grants ADD CONSTRAINT agent_authority_grants_actions_check CHECK(jsonb_typeof(actions)='array' AND jsonb_array_length(actions) BETWEEN 1 AND 3 AND actions <@ '["initial_email","reply_email","follow_up_email"]'::jsonb);
CREATE ROLE acquire_agent_worker NOLOGIN NOSUPERUSER NOBYPASSRLS;
CREATE UNIQUE INDEX agent_responsibility_scope_idx ON agent_responsibilities(id,organization_id,mandate_id,owner_user_id,thread_id);
CREATE UNIQUE INDEX agent_contact_scope_idx ON contacts(id,organization_id);
CREATE UNIQUE INDEX agent_binding_scope_idx ON communication_bindings(id,organization_id,owner_user_id);
CREATE UNIQUE INDEX agent_enrolment_scope_idx ON campaign_enrolments(id,organization_id,mandate_id,owner_user_id);
CREATE UNIQUE INDEX agent_operation_scope_idx ON agent_operations(id,organization_id,mandate_id,owner_user_id,thread_id);
CREATE UNIQUE INDEX agent_operation_actor_idx ON agent_operations(id,organization_id,owner_user_id);
CREATE UNIQUE INDEX agent_grant_scope_idx ON agent_authority_grants(id,organization_id,mandate_id,owner_user_id,thread_id);
CREATE UNIQUE INDEX agent_review_scope_idx ON agent_review_batches(id,organization_id,mandate_id,owner_user_id,thread_id);
CREATE TABLE agent_conversations(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),thread_id uuid NOT NULL,
 organization_id text NOT NULL,mandate_id uuid NOT NULL,owner_user_id text NOT NULL,
 responsibility_id uuid NOT NULL,contact_id uuid NOT NULL,
 delivery_mode text NOT NULL CHECK(delivery_mode IN('local_sink','communications')),
 binding_id uuid,binding_digest text NOT NULL CHECK(binding_digest~'^[a-f0-9]{64}$'),recipient_email text NOT NULL CHECK(recipient_email=lower(btrim(recipient_email)) AND length(recipient_email) BETWEEN 3 AND 320),
 driver_kind text NOT NULL CHECK(driver_kind IN('agent','sequence','human')),
 sequence_enrolment_id uuid,sequence_runtime text CHECK(sequence_runtime IN('legacy','n8n')),
 human_user_id text REFERENCES "user"(id),driver_generation integer NOT NULL DEFAULT 1 CHECK(driver_generation>0),
 epoch bigint NOT NULL DEFAULT 1 CHECK(epoch BETWEEN 1 AND 9007199254740991),
 revision integer NOT NULL DEFAULT 1 CHECK(revision>0),
 phase text NOT NULL DEFAULT 'paused' CHECK(phase IN('active','paused','quiescing','held','complete')),pause_reason text,
 pending_driver jsonb,retired_enrolments uuid[] NOT NULL DEFAULT '{}',
 history jsonb NOT NULL DEFAULT '[]' CHECK(jsonb_typeof(history)='array' AND jsonb_array_length(history)<=200 AND octet_length(history::text)<=1500000),
 history_revision text NOT NULL CHECK(history_revision~'^[a-f0-9]{64}$'),
 history_complete boolean NOT NULL DEFAULT false,history_observed_at timestamptz,
 history_source text NOT NULL DEFAULT 'unavailable' CHECK(history_source IN('unavailable','local_fixture','communications')),
 engagement text NOT NULL DEFAULT 'cold' CHECK(engagement IN('cold','engaged','handoff','stopped')),
 reminder_generation integer NOT NULL DEFAULT 1 CHECK(reminder_generation>0),next_wakeup_at timestamptz,wakeup_reason text,time_zone text NOT NULL DEFAULT 'UTC',
 coverage_bindings jsonb NOT NULL DEFAULT '[]' CHECK(jsonb_typeof(coverage_bindings)='array' AND jsonb_array_length(coverage_bindings)<=3),
 created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(id,organization_id,mandate_id,owner_user_id,thread_id),UNIQUE(id,organization_id,owner_user_id),
 FOREIGN KEY(thread_id,organization_id,mandate_id,owner_user_id) REFERENCES agent_threads(id,organization_id,mandate_id,owner_user_id),
 FOREIGN KEY(responsibility_id,organization_id,mandate_id,owner_user_id,thread_id) REFERENCES agent_responsibilities(id,organization_id,mandate_id,owner_user_id,thread_id),
 FOREIGN KEY(contact_id,organization_id) REFERENCES contacts(id,organization_id),
 FOREIGN KEY(binding_id,organization_id,owner_user_id) REFERENCES communication_bindings(id,organization_id,owner_user_id),
 FOREIGN KEY(sequence_enrolment_id,organization_id,mandate_id,owner_user_id) REFERENCES campaign_enrolments(id,organization_id,mandate_id,owner_user_id),
 CHECK((delivery_mode='communications')=(binding_id IS NOT NULL)),
 CHECK(history_source<>'local_fixture' OR delivery_mode='local_sink'),
 CHECK((driver_kind='sequence')=(sequence_enrolment_id IS NOT NULL)),
 CHECK((driver_kind='sequence')=(sequence_runtime IS NOT NULL)),
 CHECK((driver_kind='human')=(human_user_id IS NOT NULL)),
 CHECK((phase='quiescing')=(pending_driver IS NOT NULL))
);
CREATE TABLE agent_person_claims(
 organization_id text NOT NULL,identity_key text NOT NULL CHECK(length(identity_key) BETWEEN 3 AND 400),
 conversation_id uuid NOT NULL,owner_user_id text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(organization_id,identity_key),
 FOREIGN KEY(conversation_id,organization_id,owner_user_id) REFERENCES agent_conversations(id,organization_id,owner_user_id)
);
ALTER TABLE agent_operations ADD COLUMN conversation_id uuid;
ALTER TABLE agent_operations ADD CONSTRAINT agent_operation_conversation_scope_fk
 FOREIGN KEY(conversation_id,organization_id,mandate_id,owner_user_id,thread_id) REFERENCES agent_conversations(id,organization_id,mandate_id,owner_user_id,thread_id);
CREATE TABLE agent_authority_uses(
 operation_id uuid PRIMARY KEY,conversation_id uuid NOT NULL,
 organization_id text NOT NULL,mandate_id uuid NOT NULL,owner_user_id text NOT NULL,thread_id uuid NOT NULL,
 grant_id uuid,grant_revision integer,review_batch_id uuid,
 operation_revision integer NOT NULL CHECK(operation_revision>0),operation_fence bigint NOT NULL CHECK(operation_fence>0),operation_digest text NOT NULL CHECK(operation_digest~'^[a-f0-9]{64}$'),context_revision text NOT NULL,binding_digest text NOT NULL,
 state text NOT NULL CHECK(state IN('reserved','admitted','settled','uncertain','released')),
 outcome jsonb,created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(conversation_id,organization_id,mandate_id,owner_user_id,thread_id) REFERENCES agent_conversations(id,organization_id,mandate_id,owner_user_id,thread_id),
 FOREIGN KEY(operation_id,organization_id,mandate_id,owner_user_id,thread_id) REFERENCES agent_operations(id,organization_id,mandate_id,owner_user_id,thread_id),
 FOREIGN KEY(grant_id,organization_id,mandate_id,owner_user_id,thread_id) REFERENCES agent_authority_grants(id,organization_id,mandate_id,owner_user_id,thread_id),
 FOREIGN KEY(review_batch_id,organization_id,mandate_id,owner_user_id,thread_id) REFERENCES agent_review_batches(id,organization_id,mandate_id,owner_user_id,thread_id),
 CHECK((grant_id IS NOT NULL)<>(review_batch_id IS NOT NULL)),CHECK((grant_id IS NOT NULL)=(grant_revision IS NOT NULL))
);
CREATE TABLE agent_budget_accounts(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),organization_id text NOT NULL REFERENCES organization(id),
 scope_key text NOT NULL CHECK(length(scope_key) BETWEEN 1 AND 200),unit text NOT NULL CHECK(unit IN('usd_micro','calls','sends')),
 window_start timestamptz NOT NULL,window_end timestamptz NOT NULL,
 cap bigint NOT NULL CHECK(cap BETWEEN 0 AND 1000000000000),spent bigint NOT NULL DEFAULT 0 CHECK(spent>=0),reserved bigint NOT NULL DEFAULT 0 CHECK(reserved>=0),
 revision integer NOT NULL DEFAULT 1 CHECK(revision>0),approved_by text NOT NULL REFERENCES "user"(id),
 approved_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(id,organization_id),UNIQUE(organization_id,scope_key,window_start),
 CHECK(window_end>window_start AND window_end<=window_start+interval '31 days')
);
CREATE TABLE agent_budget_reservations(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),operation_id uuid NOT NULL,account_id uuid NOT NULL,
 organization_id text NOT NULL,owner_user_id text NOT NULL,
 amount bigint NOT NULL CHECK(amount>0),actual bigint CHECK(actual>=0),
 state text NOT NULL CHECK(state IN('reserved','settled','uncertain','released')),
 created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(operation_id,account_id),FOREIGN KEY(operation_id,organization_id,owner_user_id) REFERENCES agent_operations(id,organization_id,owner_user_id),FOREIGN KEY(account_id,organization_id) REFERENCES agent_budget_accounts(id,organization_id),
 CHECK((state='settled')=(actual IS NOT NULL))
);
CREATE TABLE agent_handoffs(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),conversation_id uuid NOT NULL,
 organization_id text NOT NULL,mandate_id uuid NOT NULL,owner_user_id text NOT NULL,thread_id uuid NOT NULL,
 assignee_user_id text NOT NULL REFERENCES "user"(id),source_history_revision text NOT NULL,
 revision integer NOT NULL DEFAULT 1 CHECK(revision>0),
 state text NOT NULL DEFAULT 'pending' CHECK(state IN('pending','acknowledged','link_sent','meeting_confirmed','dismissed')),
 context jsonb NOT NULL CHECK(octet_length(context::text)<=64000),
 human_evidence jsonb NOT NULL DEFAULT '{}',created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(conversation_id,source_history_revision),
 FOREIGN KEY(conversation_id,organization_id,mandate_id,owner_user_id,thread_id) REFERENCES agent_conversations(id,organization_id,mandate_id,owner_user_id,thread_id)
);
CREATE UNIQUE INDEX agent_handoff_one_active_idx ON agent_handoffs(conversation_id) WHERE state IN('pending','acknowledged','link_sent');
CREATE INDEX agent_handoffs_assignee_idx ON agent_handoffs(organization_id,assignee_user_id,state);
-- Local simulation has an explicit immutable mode and a separate receipt log.
-- It cannot submit to a provider or materialise a live message as sent.
CREATE TABLE agent_sink_messages(
 operation_id uuid PRIMARY KEY,conversation_id uuid NOT NULL,message_id uuid NOT NULL DEFAULT gen_random_uuid(),
 organization_id text NOT NULL,mandate_id uuid NOT NULL,owner_user_id text NOT NULL,thread_id uuid NOT NULL,
 recipient_email text NOT NULL,subject text NOT NULL,body text NOT NULL,payload_digest text NOT NULL,
 simulated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 FOREIGN KEY(operation_id,organization_id,mandate_id,owner_user_id,thread_id) REFERENCES agent_operations(id,organization_id,mandate_id,owner_user_id,thread_id),
 FOREIGN KEY(conversation_id,organization_id,mandate_id,owner_user_id,thread_id) REFERENCES agent_conversations(id,organization_id,mandate_id,owner_user_id,thread_id)
);
-- A narrowly scoped bridge into the EXISTING organisation gate. No existing
-- communications function/role policy is weakened or replaced.
CREATE FUNCTION agent_lock_send_gate() RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE org text:=current_setting('app.acquire_org',true);actor text:=current_setting('app.acquire_user',true);result bigint;
BEGIN
 IF current_setting('role',true)<>'acquire_agent_user' OR org IS NULL OR actor IS NULL
 OR NOT EXISTS(SELECT 1 FROM public.member WHERE organization_id=org AND user_id=actor) THEN RAISE EXCEPTION 'Authenticated agent scope required'; END IF;
 PERFORM pg_advisory_xact_lock_shared(7426619361492031::bigint);
 INSERT INTO public.communication_send_gates(organization_id,writer_xid) VALUES(org,txid_current()) ON CONFLICT(organization_id) DO UPDATE SET writer_xid=txid_current();
 SELECT g.revision INTO STRICT result FROM public.communication_send_gates g WHERE organization_id=org FOR UPDATE;
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION agent_lock_send_gate() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION agent_lock_send_gate() TO acquire_agent_user;
GRANT SELECT ON contacts,communication_bindings,campaign_enrolments,campaign_send_attempts,communication_dispatch_intents,communication_dispatch_permits,communication_intent_resolutions,suppressions,campaign_reply_holds,campaign_contact_holds,communication_reply_review_latches TO acquire_agent_user;
-- Native context is an opaque digest of current persisted facts, driver fence,
-- mandate version, organisation/buyer profile version and approved guidance.
CREATE FUNCTION agent_context_revision(conversation uuid) RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE result text;org text:=current_setting('app.acquire_org',true);actor text:=current_setting('app.acquire_user',true);
BEGIN
 IF current_setting('role',true) NOT IN('acquire_agent_user','acquire_campaign_user') OR NOT EXISTS(SELECT 1 FROM public.member WHERE organization_id=org AND user_id=actor) THEN RAISE EXCEPTION 'Current member scope required'; END IF;
 SELECT encode(sha256(convert_to(jsonb_build_object('conversation',c.id,'revision',c.revision,'epoch',c.epoch,'history',c.history_revision,'coverage',c.history_complete,'mandate',m.xmin::text,'buyer',g.xmin::text,'contact',person.xmin::text,'company',company.xmin::text,
 'evidence',(SELECT COALESCE(jsonb_agg(jsonb_build_object('id',f.id,'revision',f.version) ORDER BY f.id),'[]'::jsonb) FROM(SELECT id,xmin::text AS version FROM public.research_findings WHERE organization_id=c.organization_id AND target_id=person.target_id ORDER BY observed_at DESC,id LIMIT 100)f),
 'guidance',(SELECT COALESCE(jsonb_agg(jsonb_build_object('id',o.id,'revision',o.revision) ORDER BY o.id),'[]'::jsonb) FROM public.agent_operations o WHERE o.thread_id=c.thread_id AND o.name='guidance.memory' AND o.state='approved'))::text,'UTF8')),'hex') INTO result
 FROM public.agent_conversations c JOIN public.mandates m ON m.id=c.mandate_id AND m.organization_id=c.organization_id JOIN public.organization g ON g.id=c.organization_id JOIN public.contacts person ON person.id=c.contact_id AND person.organization_id=c.organization_id LEFT JOIN public.targets company ON company.id=person.target_id AND company.organization_id=c.organization_id
 WHERE c.id=conversation AND c.organization_id=org AND c.owner_user_id=actor;
 IF result IS NULL THEN RAISE EXCEPTION 'Conversation not found'; END IF;RETURN result;
END $$;
REVOKE ALL ON FUNCTION agent_context_revision(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION agent_context_revision(uuid) TO acquire_agent_user,acquire_campaign_user;
-- The worker enumerates identifiers only; all execution re-enters the scoped
-- user role and rechecks membership. No worker BYPASSRLS or prospect-data reads.
CREATE FUNCTION agent_worker_scopes(maximum integer) RETURNS TABLE(organization_id text,owner_user_id text) LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
 IF current_setting('role',true)<>'acquire_agent_worker' OR maximum NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION 'Authenticated agent worker scope required'; END IF;
 RETURN QUERY SELECT r.organization_id,r.owner_user_id FROM public.agent_responsibilities r
 JOIN public.member m ON m.organization_id=r.organization_id AND m.user_id=r.owner_user_id
 JOIN public.agent_events e ON e.thread_id=r.thread_id AND e.organization_id=r.organization_id AND e.owner_user_id=r.owner_user_id
 WHERE r.state IN('ready','waiting') AND e.available_at<=clock_timestamp()
 AND (e.state='pending' OR e.state='leased' AND e.lease_until<=clock_timestamp())
 AND NOT EXISTS(SELECT 1 FROM public.agent_runs run WHERE run.thread_id=r.thread_id AND run.state='running' AND (run.lease_until IS NULL OR run.lease_until>clock_timestamp()))
 GROUP BY r.organization_id,r.owner_user_id ORDER BY min(e.available_at),r.organization_id,r.owner_user_id LIMIT maximum;
END $$;
REVOKE ALL ON FUNCTION agent_worker_scopes(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION agent_worker_scopes(integer) TO acquire_agent_worker;
DO $$ DECLARE name text; BEGIN
 FOREACH name IN ARRAY ARRAY['agent_conversations','agent_person_claims','agent_authority_uses','agent_handoffs','agent_sink_messages'] LOOP
  EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',name);EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY',name);
  EXECUTE format('GRANT SELECT,INSERT,UPDATE ON %I TO acquire_agent_user',name);
  EXECUTE format('CREATE POLICY agent_control_scope ON %I TO acquire_agent_user USING (organization_id=current_setting(''app.acquire_org'',true) AND owner_user_id=current_setting(''app.acquire_user'',true) AND EXISTS(SELECT 1 FROM public.member WHERE organization_id=current_setting(''app.acquire_org'',true) AND user_id=current_setting(''app.acquire_user'',true))) WITH CHECK (organization_id=current_setting(''app.acquire_org'',true) AND owner_user_id=current_setting(''app.acquire_user'',true) AND EXISTS(SELECT 1 FROM public.member WHERE organization_id=current_setting(''app.acquire_org'',true) AND user_id=current_setting(''app.acquire_user'',true)))',name);
 END LOOP;
 FOREACH name IN ARRAY ARRAY['agent_budget_accounts','agent_budget_reservations'] LOOP
  EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',name);EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY',name);EXECUTE format('GRANT SELECT ON %I TO acquire_agent_user',name);
  EXECUTE format('CREATE POLICY agent_budget_read ON %I FOR SELECT TO acquire_agent_user USING (organization_id=current_setting(''app.acquire_org'',true) AND EXISTS(SELECT 1 FROM public.member WHERE organization_id=current_setting(''app.acquire_org'',true) AND user_id=current_setting(''app.acquire_user'',true)))',name);
 END LOOP;
 FOREACH name IN ARRAY ARRAY['agent_conversations','agent_person_claims','agent_authority_uses','agent_handoffs','agent_sink_messages','agent_budget_accounts','agent_budget_reservations','agent_responsibilities','agent_operations','agent_threads'] LOOP
  EXECUTE format('CREATE POLICY agent_control_definer ON %I TO PUBLIC USING(current_user=pg_get_userbyid((SELECT relowner FROM pg_class WHERE oid=%L::regclass))) WITH CHECK(current_user=pg_get_userbyid((SELECT relowner FROM pg_class WHERE oid=%L::regclass)))',name,name,name);
 END LOOP;
 FOREACH name IN ARRAY ARRAY['agent_conversations','agent_person_claims','agent_authority_uses','agent_handoffs','agent_sink_messages','agent_budget_accounts','agent_budget_reservations','agent_operations','agent_responsibilities','agent_review_batches','agent_authority_grants'] LOOP
  EXECUTE format('CREATE TRIGGER agent_control_writer BEFORE INSERT OR UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION public.communications_require_send_gate()',name);
 END LOOP;
END $$;
-- Agent-side source reads stay in current actor/tenant scope.
CREATE POLICY agent_control_contacts_read ON contacts FOR SELECT TO acquire_agent_user USING(organization_id=current_setting('app.acquire_org',true) AND EXISTS(SELECT 1 FROM member WHERE organization_id=current_setting('app.acquire_org',true) AND user_id=current_setting('app.acquire_user',true)));
DO $$ DECLARE name text; BEGIN
 FOREACH name IN ARRAY ARRAY['communication_bindings','campaign_enrolments','campaign_send_attempts','communication_dispatch_intents'] LOOP
  EXECUTE format('CREATE POLICY agent_control_source_read ON %I FOR SELECT TO acquire_agent_user USING(organization_id=current_setting(''app.acquire_org'',true) AND owner_user_id=current_setting(''app.acquire_user'',true))',name);
 END LOOP;
 FOREACH name IN ARRAY ARRAY['suppressions','campaign_reply_holds','campaign_contact_holds','communication_reply_review_latches'] LOOP
  EXECUTE format('CREATE POLICY agent_control_policy_read ON %I FOR SELECT TO acquire_agent_user USING(organization_id=current_setting(''app.acquire_org'',true) AND EXISTS(SELECT 1 FROM public.member WHERE organization_id=current_setting(''app.acquire_org'',true) AND user_id=current_setting(''app.acquire_user'',true)))',name);
 END LOOP;
END $$;
CREATE POLICY agent_control_permit_read ON communication_dispatch_permits FOR SELECT TO acquire_agent_user USING(EXISTS(SELECT 1 FROM communication_dispatch_intents i WHERE i.id=intent_id AND i.organization_id=current_setting('app.acquire_org',true) AND i.owner_user_id=current_setting('app.acquire_user',true)));
CREATE POLICY agent_control_resolution_read ON communication_intent_resolutions FOR SELECT TO acquire_agent_user USING(EXISTS(SELECT 1 FROM communication_dispatch_intents i WHERE i.id=intent_id AND i.organization_id=current_setting('app.acquire_org',true) AND i.owner_user_id=current_setting('app.acquire_user',true)));
CREATE POLICY agent_handoff_assignee_read ON agent_handoffs FOR SELECT TO acquire_agent_user USING(organization_id=current_setting('app.acquire_org',true) AND assignee_user_id=current_setting('app.acquire_user',true) AND EXISTS(SELECT 1 FROM member WHERE organization_id=current_setting('app.acquire_org',true) AND user_id=current_setting('app.acquire_user',true)));
CREATE POLICY agent_handoff_assignee_update ON agent_handoffs FOR UPDATE TO acquire_agent_user USING(organization_id=current_setting('app.acquire_org',true) AND assignee_user_id=current_setting('app.acquire_user',true)) WITH CHECK(organization_id=current_setting('app.acquire_org',true) AND assignee_user_id=current_setting('app.acquire_user',true));
CREATE FUNCTION agent_handoff_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE actor text:=current_setting('app.acquire_user',true);
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.member WHERE organization_id=NEW.organization_id AND user_id=NEW.assignee_user_id) THEN RAISE EXCEPTION 'Handoff assignee must be a current member'; END IF;
 IF TG_OP='UPDATE' THEN
  IF ROW(NEW.id,NEW.conversation_id,NEW.organization_id,NEW.mandate_id,NEW.owner_user_id,NEW.thread_id,NEW.source_history_revision,NEW.context) IS DISTINCT FROM ROW(OLD.id,OLD.conversation_id,OLD.organization_id,OLD.mandate_id,OLD.owner_user_id,OLD.thread_id,OLD.source_history_revision,OLD.context)
  OR NEW.revision<>OLD.revision+1 THEN RAISE EXCEPTION 'Handoff source is immutable; current revision required'; END IF;
  IF actor IS DISTINCT FROM OLD.owner_user_id AND (actor IS DISTINCT FROM OLD.assignee_user_id OR NEW.assignee_user_id IS DISTINCT FROM OLD.assignee_user_id) THEN RAISE EXCEPTION 'Handoff assignment authority unavailable'; END IF;
 END IF;RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION agent_handoff_guard() FROM PUBLIC;
CREATE TRIGGER agent_handoff_scope_guard BEFORE INSERT OR UPDATE ON agent_handoffs FOR EACH ROW EXECUTE FUNCTION agent_handoff_guard();
-- Private assertion used only by bounded definer operations below.
CREATE FUNCTION agent_assert_control_scope() RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE org text:=current_setting('app.acquire_org',true);actor text:=current_setting('app.acquire_user',true);
BEGIN
 IF current_setting('role',true)<>'acquire_agent_user'
 OR NOT EXISTS(SELECT 1 FROM public.member WHERE organization_id=org AND user_id=actor)
 OR NOT EXISTS(SELECT 1 FROM public.communication_send_gates WHERE organization_id=org AND writer_xid=txid_current()) THEN RAISE EXCEPTION 'Held current agent authority required'; END IF;
END $$;
REVOKE ALL ON FUNCTION agent_assert_control_scope() FROM PUBLIC;
CREATE FUNCTION agent_configure_budget(scope_key text,unit text,window_start timestamptz,window_end timestamptz,cap bigint,expected_revision integer) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE org text:=current_setting('app.acquire_org',true);actor text:=current_setting('app.acquire_user',true);prior public.agent_budget_accounts%ROWTYPE;result public.agent_budget_accounts%ROWTYPE;
BEGIN
 PERFORM public.agent_assert_control_scope();
 IF NOT EXISTS(SELECT 1 FROM public.member WHERE organization_id=org AND user_id=actor AND role IN('owner','admin')) THEN RAISE EXCEPTION 'Human workspace administrator required'; END IF;
 IF length(scope_key) NOT BETWEEN 1 AND 200 OR unit NOT IN('usd_micro','calls','sends') OR cap NOT BETWEEN 0 AND 1000000000000 OR window_end<=window_start OR window_end>window_start+interval '31 days' THEN RAISE EXCEPTION 'Invalid bounded budget'; END IF;
 SELECT * INTO prior FROM public.agent_budget_accounts a WHERE a.organization_id=org AND a.scope_key=agent_configure_budget.scope_key AND a.window_start=agent_configure_budget.window_start FOR UPDATE;
 IF prior.id IS NULL THEN
  IF expected_revision<>0 THEN RAISE EXCEPTION 'Budget changed'; END IF;
  INSERT INTO public.agent_budget_accounts(organization_id,scope_key,unit,window_start,window_end,cap,approved_by) VALUES(org,scope_key,unit,window_start,window_end,cap,actor) RETURNING * INTO result;
 ELSE
  IF prior.revision<>expected_revision OR prior.unit<>unit THEN RAISE EXCEPTION 'Budget changed or unit differs'; END IF;
  UPDATE public.agent_budget_accounts a SET cap=agent_configure_budget.cap,window_end=agent_configure_budget.window_end,revision=a.revision+1,approved_by=actor,approved_at=clock_timestamp() WHERE a.id=prior.id RETURNING * INTO result;
 END IF;
 INSERT INTO public.audit_events(organization_id,actor_id,action,entity_type,entity_id,metadata) VALUES(org,actor,'agent.budget_configured','agent_budget',result.id::text,jsonb_build_object('revision',result.revision,'cap',result.cap::text,'previousCap',prior.cap::text,'unit',result.unit,'scopeKey',result.scope_key,'windowStart',result.window_start,'windowEnd',result.window_end));
 RETURN to_jsonb(result)||jsonb_build_object('cap',result.cap::text,'spent',result.spent::text,'reserved',result.reserved::text);
END $$;
REVOKE ALL ON FUNCTION agent_configure_budget(text,text,timestamptz,timestamptz,bigint,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION agent_configure_budget(text,text,timestamptz,timestamptz,bigint,integer) TO acquire_agent_user;
CREATE FUNCTION agent_reserve_budget(operation uuid,requests jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE org text:=current_setting('app.acquire_org',true);actor text:=current_setting('app.acquire_user',true);entry jsonb;account public.agent_budget_accounts%ROWTYPE;prior public.agent_budget_reservations%ROWTYPE;amount bigint;result jsonb:='[]';
BEGIN
 PERFORM public.agent_assert_control_scope();
 IF jsonb_typeof(requests)<>'array' OR jsonb_array_length(requests) NOT BETWEEN 1 AND 10 THEN RAISE EXCEPTION 'Bounded reservation group required'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.agent_operations o WHERE o.id=operation AND o.organization_id=org AND o.owner_user_id=actor AND o.state IN('approved','running')) THEN RAISE EXCEPTION 'Current admitted operation required'; END IF;
 PERFORM 1 FROM public.agent_operations WHERE id=operation FOR UPDATE;
 IF (SELECT count(DISTINCT value->>'accountId') FROM jsonb_array_elements(requests))<>jsonb_array_length(requests) THEN RAISE EXCEPTION 'Duplicate budget account'; END IF;
 -- The shared organisation gate and stable account order cover manual/agent races.
 FOR entry IN SELECT value FROM jsonb_array_elements(requests) ORDER BY value->>'accountId' LOOP
  IF jsonb_typeof(entry)<>'object' OR NOT entry ?& ARRAY['accountId','amount'] OR EXISTS(SELECT 1 FROM jsonb_object_keys(entry) AS keys(key) WHERE key NOT IN('accountId','amount')) OR (entry->>'amount')!~'^[1-9][0-9]{0,11}$' THEN RAISE EXCEPTION 'Invalid reservation'; END IF;
  amount:=(entry->>'amount')::bigint;
  SELECT * INTO STRICT account FROM public.agent_budget_accounts a WHERE a.id=(entry->>'accountId')::uuid AND a.organization_id=org FOR UPDATE;
  SELECT * INTO prior FROM public.agent_budget_reservations r WHERE r.operation_id=operation AND r.account_id=account.id;
  IF prior.id IS NOT NULL THEN
   IF prior.amount<>amount OR prior.owner_user_id<>actor THEN RAISE EXCEPTION 'Reservation key reused with different scope'; END IF;
   IF prior.state IN('reserved','uncertain') AND (account.window_start>clock_timestamp() OR account.window_end<=clock_timestamp()) THEN RAISE EXCEPTION 'Budget window expired; reconcile before reauthorising work'; END IF;
  ELSE
   IF account.window_start>clock_timestamp() OR account.window_end<=clock_timestamp() OR account.spent+account.reserved+amount>account.cap THEN RAISE EXCEPTION 'Shared budget exhausted or expired'; END IF;
   INSERT INTO public.agent_budget_reservations(operation_id,account_id,organization_id,owner_user_id,amount,state) VALUES(operation,account.id,org,actor,amount,'reserved') RETURNING * INTO prior;
   UPDATE public.agent_budget_accounts SET reserved=reserved+amount WHERE id=account.id;
  END IF;result:=result||jsonb_build_array(to_jsonb(prior)||jsonb_build_object('amount',prior.amount::text,'actual',prior.actual::text));
 END LOOP;RETURN result;
END $$;
REVOKE ALL ON FUNCTION agent_reserve_budget(uuid,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION agent_reserve_budget(uuid,jsonb) TO acquire_agent_user;
CREATE FUNCTION agent_settle_budget(operation uuid,actuals jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE org text:=current_setting('app.acquire_org',true);actor text:=current_setting('app.acquire_user',true);entry jsonb;reservation public.agent_budget_reservations%ROWTYPE;actual_units bigint;result jsonb:='[]';
BEGIN
 PERFORM public.agent_assert_control_scope();
 IF jsonb_typeof(actuals)<>'array' OR jsonb_array_length(actuals) NOT BETWEEN 1 AND 10 THEN RAISE EXCEPTION 'Bounded usage group required'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.agent_operations o WHERE o.id=operation AND o.organization_id=org AND o.owner_user_id=actor) THEN RAISE EXCEPTION 'Recorded operation required'; END IF;
 PERFORM 1 FROM public.agent_operations WHERE id=operation FOR UPDATE;
 IF (SELECT count(*) FROM public.agent_budget_reservations r WHERE r.operation_id=operation)<>jsonb_array_length(actuals) OR (SELECT count(DISTINCT value->>'accountId') FROM jsonb_array_elements(actuals))<>jsonb_array_length(actuals) THEN RAISE EXCEPTION 'Exact reservation usage required'; END IF;
 FOR entry IN SELECT value FROM jsonb_array_elements(actuals) ORDER BY value->>'accountId' LOOP
  IF jsonb_typeof(entry)<>'object' OR NOT entry ?& ARRAY['accountId','actual'] OR EXISTS(SELECT 1 FROM jsonb_object_keys(entry) AS keys(key) WHERE key NOT IN('accountId','actual')) OR ((entry->>'actual') IS NOT NULL AND (entry->>'actual')!~'^(0|[1-9][0-9]{0,11})$') THEN RAISE EXCEPTION 'Invalid usage'; END IF;
  SELECT * INTO STRICT reservation FROM public.agent_budget_reservations r WHERE r.operation_id=operation AND r.account_id=(entry->>'accountId')::uuid AND r.organization_id=org AND r.owner_user_id=actor FOR UPDATE;
  IF reservation.state='released' THEN RAISE EXCEPTION 'Released reservation cannot be settled'; END IF;
  IF (entry->>'actual') IS NULL THEN
   IF reservation.state<>'settled' THEN UPDATE public.agent_budget_reservations SET state='uncertain',updated_at=clock_timestamp() WHERE id=reservation.id RETURNING * INTO reservation; END IF;
  ELSE
   actual_units:=(entry->>'actual')::bigint;
   IF reservation.state='settled' THEN IF reservation.actual<>actual_units THEN RAISE EXCEPTION 'Different usage replay'; END IF;
   ELSE
    UPDATE public.agent_budget_accounts SET reserved=reserved-reservation.amount,spent=spent+actual_units WHERE id=reservation.account_id;
    UPDATE public.agent_budget_reservations SET state='settled',actual=actual_units,updated_at=clock_timestamp() WHERE id=reservation.id RETURNING * INTO reservation;
   END IF;
  END IF;result:=result||jsonb_build_array(to_jsonb(reservation)||jsonb_build_object('amount',reservation.amount::text,'actual',reservation.actual::text));
 END LOOP;RETURN result;
END $$;
REVOKE ALL ON FUNCTION agent_settle_budget(uuid,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION agent_settle_budget(uuid,jsonb) TO acquire_agent_user;
-- Resolve all recorded canonical identities under the held organisation gate.
-- Includes verified channel mappings already used by legacy sequence admission.
CREATE FUNCTION agent_person_keys(org text,contact uuid) RETURNS text[] LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE result text[];
BEGIN
 IF current_setting('role',true) NOT IN('acquire_agent_user','acquire_campaign_user') OR org IS DISTINCT FROM current_setting('app.acquire_org',true)
 OR NOT EXISTS(SELECT 1 FROM public.member WHERE organization_id=org AND user_id=current_setting('app.acquire_user',true))
 OR NOT EXISTS(SELECT 1 FROM public.communication_send_gates WHERE organization_id=org AND writer_xid=txid_current()) THEN RAISE EXCEPTION 'Held canonical identity scope required'; END IF;
 SELECT array_agg(DISTINCT key ORDER BY key) INTO result FROM(
  SELECT 'contact:'||c.id::text AS key FROM public.contacts c WHERE c.id=contact AND c.organization_id=org
  UNION SELECT 'email:'||lower(btrim(c.personal_data->>'email')) FROM public.contacts c WHERE c.id=contact AND c.organization_id=org AND length(btrim(c.personal_data->>'email'))>0
  UNION SELECT 'firmable:'||c.firmable_person_id FROM public.contacts c WHERE c.id=contact AND c.organization_id=org AND c.firmable_person_id IS NOT NULL
  UNION SELECT r.channel||':'||r.identity FROM public.campaign_reply_identities r WHERE r.organization_id=org AND r.contact_id=contact AND length(r.identity)>0
  UNION SELECT r.channel||':'||r.source_identity FROM public.campaign_reply_identities r WHERE r.organization_id=org AND r.contact_id=contact AND length(r.source_identity)>0
 ) identities WHERE length(key) BETWEEN 3 AND 400;
 IF result IS NULL THEN RAISE EXCEPTION 'Canonical contact not found'; END IF;RETURN result;
END $$;
REVOKE ALL ON FUNCTION agent_person_keys(text,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION agent_person_keys(text,uuid) TO acquire_agent_user,acquire_campaign_user;
-- A boolean-only global alias check fences BOTH old n8n callbacks and native
-- work, including aliases owned by another member that RLS correctly hides.
CREATE FUNCTION agent_driver_allows(org text,actor text,contact uuid,address text,source_kind text,source_ref uuid,expected_epoch bigint) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE candidates uuid[];identities text[];current public.agent_conversations%ROWTYPE;
BEGIN
 IF current_setting('role',true) NOT IN('acquire_agent_user','acquire_campaign_user') OR org IS DISTINCT FROM current_setting('app.acquire_org',true) OR actor IS DISTINCT FROM current_setting('app.acquire_user',true)
 OR NOT EXISTS(SELECT 1 FROM public.member WHERE organization_id=org AND user_id=actor)
 OR NOT EXISTS(SELECT 1 FROM public.communication_send_gates WHERE organization_id=org AND writer_xid=txid_current()) THEN RAISE EXCEPTION 'Held authenticated dispatch authority required'; END IF;
 identities:=public.agent_person_keys(org,contact);
 SELECT array_agg(DISTINCT conversation_id) INTO candidates FROM public.agent_person_claims WHERE organization_id=org AND identity_key=ANY(identities);
 IF candidates IS NULL THEN RETURN source_kind IN('campaign','draft'); END IF;
 IF cardinality(candidates)<>1 THEN RETURN false; END IF;
 SELECT * INTO current FROM public.agent_conversations WHERE id=candidates[1] AND organization_id=org;
 IF current.owner_user_id<>actor OR current.phase<>'active' THEN RETURN false; END IF;
 IF source_kind='campaign' THEN RETURN current.driver_kind='sequence' AND current.sequence_enrolment_id=source_ref AND NOT source_ref=ANY(current.retired_enrolments); END IF;
 IF source_kind='draft' THEN RETURN current.driver_kind='human' AND current.human_user_id=actor; END IF;
 IF source_kind='agent' THEN RETURN current.driver_kind='agent' AND current.id=source_ref AND expected_epoch IS NOT NULL AND current.epoch=expected_epoch AND EXISTS(SELECT 1 FROM public.agent_responsibilities r WHERE r.id=current.responsibility_id AND r.state IN('ready','waiting')); END IF;
 RETURN false;
END $$;
REVOKE ALL ON FUNCTION agent_driver_allows(text,text,uuid,text,text,uuid,bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION agent_driver_allows(text,text,uuid,text,text,uuid,bigint) TO acquire_agent_user,acquire_campaign_user;
-- Legacy occupancy is checked globally without exposing other members' rows.
CREATE FUNCTION agent_legacy_sequence_occupied(contact uuid) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE org text:=current_setting('app.acquire_org',true);
BEGIN
 PERFORM public.agent_assert_control_scope();
 RETURN EXISTS(SELECT 1 FROM public.campaign_enrolments e JOIN public.contacts c ON c.id=e.contact_id AND c.organization_id=e.organization_id WHERE e.organization_id=org AND e.state IN('active','paused','needs_review') AND (e.contact_id=contact OR public.agent_person_keys(org,e.contact_id)&&public.agent_person_keys(org,contact)));
END $$;
REVOKE ALL ON FUNCTION agent_legacy_sequence_occupied(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION agent_legacy_sequence_occupied(uuid) TO acquire_agent_user;
CREATE FUNCTION agent_conversation_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
 IF TG_OP='INSERT' THEN
  IF NOT EXISTS(SELECT 1 FROM public.contacts c WHERE c.id=NEW.contact_id AND c.organization_id=NEW.organization_id AND (c.mandate_id=NEW.mandate_id OR EXISTS(SELECT 1 FROM public.mandate_targets mt WHERE mt.organization_id=c.organization_id AND mt.target_id=c.target_id AND mt.mandate_id=NEW.mandate_id))) THEN RAISE EXCEPTION 'Contact must belong to the mandate'; END IF;
 ELSE
  IF ROW(NEW.id,NEW.thread_id,NEW.organization_id,NEW.mandate_id,NEW.owner_user_id,NEW.responsibility_id,NEW.contact_id,NEW.delivery_mode,NEW.binding_id,NEW.binding_digest,NEW.recipient_email) IS DISTINCT FROM ROW(OLD.id,OLD.thread_id,OLD.organization_id,OLD.mandate_id,OLD.owner_user_id,OLD.responsibility_id,OLD.contact_id,OLD.delivery_mode,OLD.binding_id,OLD.binding_digest,OLD.recipient_email)
  THEN RAISE EXCEPTION 'Conversation identity/account is immutable'; END IF;
  IF (to_jsonb(NEW)-'history_observed_at'-'updated_at') IS DISTINCT FROM (to_jsonb(OLD)-'history_observed_at'-'updated_at') AND NEW.revision<>OLD.revision+1 THEN RAISE EXCEPTION 'Current conversation revision required'; END IF;
 END IF;RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION agent_conversation_guard() FROM PUBLIC;
CREATE TRIGGER agent_conversation_scope_guard BEFORE INSERT OR UPDATE ON agent_conversations FOR EACH ROW EXECUTE FUNCTION agent_conversation_guard();

REVOKE UPDATE ON agent_sink_messages FROM acquire_agent_user;
CREATE FUNCTION agent_operation_authorised(operation uuid) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE org text:=current_setting('app.acquire_org',true);actor text:=current_setting('app.acquire_user',true);latest_inbound timestamptz;latest_body text;op public.agent_operations%ROWTYPE;conversation public.agent_conversations%ROWTYPE;authority public.agent_authority_uses%ROWTYPE;delegation public.agent_authority_grants%ROWTYPE;batch public.agent_review_batches%ROWTYPE;kind text;
BEGIN
 IF current_setting('role',true) NOT IN('acquire_agent_user','acquire_campaign_user') OR NOT EXISTS(SELECT 1 FROM public.member WHERE organization_id=org AND user_id=actor)
 OR NOT EXISTS(SELECT 1 FROM public.communication_send_gates WHERE organization_id=org AND writer_xid=txid_current()) THEN RAISE EXCEPTION 'Held current dispatch authority required'; END IF;
 SELECT * INTO op FROM public.agent_operations WHERE id=operation AND organization_id=org AND owner_user_id=actor;
 IF op.id IS NULL OR op.name NOT IN('email.initial','email.reply','email.follow_up','email.manual_link') OR op.state<>'running' OR op.lease_until IS NULL OR op.lease_until<=clock_timestamp() THEN RETURN false; END IF;
 SELECT * INTO conversation FROM public.agent_conversations WHERE id=op.conversation_id AND organization_id=org AND owner_user_id=actor;
 IF conversation.id IS NULL OR conversation.phase<>'active' OR NOT conversation.history_complete OR conversation.history_observed_at IS NULL OR conversation.history_observed_at>clock_timestamp() OR conversation.history_observed_at<clock_timestamp()-interval '5 minutes'
 OR op.input->>'contextRevision' IS DISTINCT FROM public.agent_context_revision(conversation.id) OR op.input->>'recipientKey' IS DISTINCT FROM 'email:'||conversation.recipient_email OR op.input->>'bindingDigest' IS DISTINCT FROM conversation.binding_digest THEN RETURN false; END IF;
 IF op.name='email.manual_link' THEN
  IF conversation.driver_kind<>'human' OR conversation.human_user_id<>actor THEN RETURN false; END IF;
 ELSE
  IF conversation.driver_kind<>'agent' OR NOT EXISTS(SELECT 1 FROM public.agent_responsibilities r WHERE r.id=conversation.responsibility_id AND r.state IN('ready','waiting')) THEN RETURN false; END IF;
  IF (op.input->>'body')~*'(https?://|www[.]|calendly|cal[.]com)' OR op.input->>'intent' IN('meeting_ready','opt_out','uncertain') THEN RETURN false; END IF;
 END IF;
 IF NOT EXISTS(SELECT 1 FROM public.contacts person WHERE person.id=conversation.contact_id AND person.organization_id=org AND person.fictionalised=false AND COALESCE(person.personal_data->>'doNotContact','false')='false' AND lower(btrim(person.personal_data->>'email'))=conversation.recipient_email)
 OR EXISTS(SELECT 1 FROM public.suppressions WHERE organization_id=org AND (lower(address)=conversation.recipient_email OR lower(domain)=split_part(conversation.recipient_email,'@',2)))
 OR EXISTS(SELECT 1 FROM public.communication_reply_review_latches WHERE organization_id=org AND resolved_at IS NULL) THEN RETURN false; END IF;
 SELECT (value->>'at')::timestamptz,value->>'text' INTO latest_inbound,latest_body FROM jsonb_array_elements(conversation.history) WHERE value->>'direction'='inbound' ORDER BY (value->>'at')::timestamptz DESC,value->>'id' LIMIT 1;
 IF latest_inbound>clock_timestamp() OR latest_body~*'(unsubscribe|do not (contact|email|message)|don[''’]t (contact|email|message)|stop (contacting|emailing|messaging)|remove me|no further (emails|messages|contact))' THEN RETURN false; END IF;
 IF op.name IN('email.reply','email.manual_link') AND latest_inbound IS NULL THEN RETURN false; END IF;
 IF EXISTS(SELECT 1 FROM public.campaign_reply_holds h WHERE h.organization_id=org AND (h.contact_id=conversation.contact_id OR public.agent_person_keys(org,h.contact_id)&&public.agent_person_keys(org,conversation.contact_id)) AND (op.name='email.initial' OR op.name='email.follow_up' AND conversation.engagement='cold' OR h.reason<>'reply_received' OR latest_inbound IS NULL OR h.received_at>latest_inbound))
 OR EXISTS(SELECT 1 FROM public.campaign_contact_holds h WHERE h.organization_id=org AND EXISTS(SELECT 1 FROM public.agent_person_claims p WHERE p.conversation_id=conversation.id AND p.organization_id=org AND p.identity_key='email:'||lower(h.email)) AND (op.name='email.initial' OR op.name='email.follow_up' AND conversation.engagement='cold' OR h.reason<>'reply_received' OR latest_inbound IS NULL)) THEN RETURN false; END IF;
 SELECT * INTO authority FROM public.agent_authority_uses WHERE operation_id=operation AND organization_id=org AND owner_user_id=actor;
 IF authority.operation_id IS NULL OR authority.state<>'reserved' OR authority.operation_revision<>op.revision OR authority.operation_fence<>op.fence OR authority.operation_digest<>op.input_digest OR authority.context_revision IS DISTINCT FROM op.input->>'contextRevision' OR authority.binding_digest<>conversation.binding_digest THEN RETURN false; END IF;
 IF authority.grant_id IS NOT NULL THEN
  IF jsonb_array_length(conversation.history)>0 AND NOT EXISTS(SELECT 1 FROM public.agent_sink_messages m WHERE m.conversation_id=conversation.id) AND NOT EXISTS(SELECT 1 FROM public.agent_operations p WHERE p.conversation_id=conversation.id AND p.state='complete' AND p.result->'delivery'->>'status'='submitted') THEN RETURN false; END IF;
  kind:=CASE op.name WHEN 'email.initial' THEN 'initial_email' WHEN 'email.reply' THEN 'reply_email' WHEN 'email.follow_up' THEN 'follow_up_email' ELSE NULL END;
  SELECT * INTO delegation FROM public.agent_authority_grants WHERE id=authority.grant_id AND thread_id=op.thread_id AND organization_id=org AND owner_user_id=actor;
  IF kind IS NULL OR delegation.id IS NULL OR delegation.revision<>authority.grant_revision OR delegation.revoked_at IS NOT NULL OR delegation.expires_at<=clock_timestamp() OR delegation.used_sends>delegation.max_sends OR delegation.binding_digest<>conversation.binding_digest OR NOT delegation.actions ? kind OR NOT delegation.recipient_keys ? ('email:'||conversation.recipient_email) THEN RETURN false; END IF;
 ELSE
  SELECT * INTO batch FROM public.agent_review_batches WHERE id=authority.review_batch_id AND thread_id=op.thread_id AND organization_id=org AND owner_user_id=actor;
  IF batch.id IS NULL OR batch.state<>'approved' OR NOT batch.manifest @> jsonb_build_array(jsonb_build_object('operationId',op.id,'revision',op.revision,'digest',op.input_digest,'contextRevision',op.input->>'contextRevision')) THEN RETURN false; END IF;
 END IF;
 -- Reservations remain charged while outcomes/usage are uncertain. Require an
 -- active send-count reservation in the current window immediately at dispatch.
 IF NOT EXISTS(SELECT 1 FROM public.agent_budget_reservations r JOIN public.agent_budget_accounts a ON a.id=r.account_id AND a.organization_id=r.organization_id WHERE r.operation_id=operation AND r.state='reserved' AND a.unit='sends' AND a.window_start<=clock_timestamp() AND a.window_end>clock_timestamp() AND a.spent+a.reserved<=a.cap) THEN RETURN false; END IF;
 RETURN true;
END $$;
REVOKE ALL ON FUNCTION agent_operation_authorised(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION agent_operation_authorised(uuid) TO acquire_agent_user,acquire_campaign_user;
CREATE FUNCTION agent_sink_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE op public.agent_operations%ROWTYPE;conversation public.agent_conversations%ROWTYPE;
BEGIN
 IF NOT public.agent_operation_authorised(NEW.operation_id) THEN RAISE EXCEPTION 'Current local simulation authority unavailable'; END IF;
 SELECT * INTO STRICT op FROM public.agent_operations WHERE id=NEW.operation_id;
 SELECT * INTO STRICT conversation FROM public.agent_conversations WHERE id=NEW.conversation_id;
 IF conversation.delivery_mode<>'local_sink' OR op.conversation_id<>conversation.id OR NEW.payload_digest<>op.input_digest OR NEW.recipient_email<>conversation.recipient_email OR NEW.body IS DISTINCT FROM op.input->>'body' OR NEW.subject IS DISTINCT FROM op.input->>'subject' THEN RAISE EXCEPTION 'Local simulation snapshot mismatch'; END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION agent_sink_guard() FROM PUBLIC;
CREATE TRIGGER agent_sink_admission BEFORE INSERT ON agent_sink_messages FOR EACH ROW EXECUTE FUNCTION agent_sink_guard();
