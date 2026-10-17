-- Explicit authenticated starts register this thread; no legacy backfill.
-- Runtime identity is server configuration, never a chat/tool argument.
CREATE TABLE public.agent_runtime_registrations(
 thread_id uuid PRIMARY KEY REFERENCES public.agent_threads(id),
 organization_id text NOT NULL REFERENCES public.organization(id),
 owner_user_id text NOT NULL REFERENCES public."user"(id),
 mandate_id uuid NOT NULL REFERENCES public.mandates(id),
 responsibility_id uuid NOT NULL REFERENCES public.agent_responsibilities(id),
 responsibility_revision integer NOT NULL CHECK(responsibility_revision>0),
 runtime_id text NOT NULL CHECK(runtime_id ~ '^[a-z][a-z0-9-]{2,99}$'),
 state text NOT NULL CHECK(state IN('enabled','paused')),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
ALTER TABLE public.agent_runtime_registrations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_runtime_registrations FORCE ROW LEVEL SECURITY;
GRANT SELECT ON public.agent_runtime_registrations TO acquire_agent_user;
CREATE POLICY agent_runtime_owned_read ON public.agent_runtime_registrations FOR SELECT TO acquire_agent_user
 USING(organization_id=current_setting('app.acquire_org',true) AND owner_user_id=current_setting('app.acquire_user',true)
 AND EXISTS(SELECT 1 FROM public.member m WHERE m.organization_id=agent_runtime_registrations.organization_id AND m.user_id=agent_runtime_registrations.owner_user_id));
CREATE POLICY agent_runtime_definer ON public.agent_runtime_registrations TO PUBLIC
 USING(current_user=pg_get_userbyid((SELECT relowner FROM pg_class WHERE oid='public.agent_runtime_registrations'::regclass)))
 WITH CHECK(current_user=pg_get_userbyid((SELECT relowner FROM pg_class WHERE oid='public.agent_runtime_registrations'::regclass)));
CREATE TRIGGER agent_runtime_writer BEFORE INSERT OR UPDATE OR DELETE ON public.agent_runtime_registrations
 FOR EACH ROW EXECUTE FUNCTION public.communications_require_send_gate();

CREATE FUNCTION public.agent_register_runtime(p_thread uuid,p_responsibility_revision integer,p_runtime_id text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE org text:=current_setting('app.acquire_org',true);actor text:=current_setting('app.acquire_user',true);
 t public.agent_threads%ROWTYPE;r public.agent_responsibilities%ROWTYPE;prior public.agent_runtime_registrations%ROWTYPE;
 scope_prefix text;budget_unit text;budget_key text;budget_cap bigint;account public.agent_budget_accounts%ROWTYPE;
 started timestamptz:=clock_timestamp();created_defaults jsonb:='[]';notice jsonb;
BEGIN
 PERFORM public.agent_assert_control_scope();
 IF p_runtime_id IS NULL OR p_runtime_id!~'^[a-z][a-z0-9-]{2,99}$' OR p_runtime_id IS DISTINCT FROM current_setting('app.acquire_runtime_id',true) OR p_responsibility_revision IS NULL THEN RAISE EXCEPTION 'Configured registered runtime required';END IF;
 SELECT * INTO t FROM public.agent_threads WHERE id=p_thread AND organization_id=org AND owner_user_id=actor FOR UPDATE;
 IF t.id IS NULL THEN RAISE EXCEPTION 'Owned runtime thread required';END IF;
 SELECT * INTO r FROM public.agent_responsibilities WHERE thread_id=t.id AND organization_id=org AND owner_user_id=actor FOR UPDATE;
 IF r.id IS NULL OR r.revision<>p_responsibility_revision OR r.state NOT IN('ready','waiting','paused') THEN RAISE EXCEPTION 'Current controlled responsibility required';END IF;
 SELECT * INTO prior FROM public.agent_runtime_registrations WHERE thread_id=t.id FOR UPDATE;
 IF prior.thread_id IS NOT NULL AND (prior.runtime_id<>p_runtime_id OR prior.responsibility_id<>r.id OR prior.organization_id<>org OR prior.owner_user_id<>actor OR prior.mandate_id<>t.mandate_id) THEN RAISE EXCEPTION 'Runtime migration requires a separate reconciled handover';END IF;
 INSERT INTO public.agent_runtime_registrations(thread_id,organization_id,owner_user_id,mandate_id,responsibility_id,responsibility_revision,runtime_id,state)
 VALUES(t.id,org,actor,t.mandate_id,r.id,r.revision,p_runtime_id,CASE WHEN r.state='paused' THEN 'paused' ELSE 'enabled' END)
 ON CONFLICT(thread_id) DO UPDATE SET responsibility_revision=EXCLUDED.responsibility_revision,state=EXCLUDED.state,updated_at=clock_timestamp();
 -- Only current administrators may provision workspace budget authority. A
 -- member can register a runtime and sees missing limits until an admin acts.
 -- An existing current OR future window is never reset, extended or increased.
 IF r.state IN('ready','waiting') AND EXISTS(SELECT 1 FROM public.member WHERE organization_id=org AND user_id=actor AND role IN('owner','admin')) THEN
  FOREACH scope_prefix IN ARRAY ARRAY['organization','user:'||actor,'mandate:'||t.mandate_id::text] LOOP
   FOREACH budget_unit IN ARRAY ARRAY['calls','sends','usd_micro'] LOOP
    budget_key:=scope_prefix||':'||budget_unit;
    IF NOT EXISTS(SELECT 1 FROM public.agent_budget_accounts WHERE organization_id=org AND scope_key=budget_key AND window_end>started) THEN
     budget_cap:=CASE budget_unit WHEN 'calls' THEN 100 WHEN 'sends' THEN 30 ELSE 10000000 END;
     INSERT INTO public.agent_budget_accounts(organization_id,scope_key,unit,window_start,window_end,cap,approved_by)
     VALUES(org,budget_key,budget_unit,started,started+interval '24 hours',budget_cap,actor) RETURNING * INTO account;
     created_defaults:=created_defaults||jsonb_build_array(jsonb_build_object('id',account.id,'scopeKey',budget_key,'unit',budget_unit,'cap',budget_cap::text,'windowEnd',account.window_end));
     INSERT INTO public.audit_events(organization_id,actor_id,action,entity_type,entity_id,metadata)
     VALUES(org,actor,'agent.budget_default_created','agent_budget',account.id::text,jsonb_build_object('scopeKey',budget_key,'cap',budget_cap::text,'unit',budget_unit,'windowStart',started,'windowEnd',account.window_end,'runtimeId',p_runtime_id));
    END IF;
   END LOOP;
  END LOOP;
 END IF;
 IF prior.thread_id IS NULL OR prior.responsibility_revision<>r.revision THEN
  notice:=jsonb_build_object('text',CASE WHEN r.state='paused' THEN 'This mandate is paused in its registered background runtime.' ELSE 'This mandate is registered for background work. Budget limits do not approve messages; outreach still requires its current review and exact account.' END,'details',jsonb_build_object('runtimeId',p_runtime_id,'responsibilityId',r.id,'responsibilityRevision',r.revision,'createdDefaultBudgets',created_defaults));
  INSERT INTO public.agent_messages(thread_id,organization_id,mandate_id,owner_user_id,request_key,role,content,content_digest)
  VALUES(t.id,org,t.mandate_id,actor,'runtime-registration:'||r.id::text||':'||r.revision::text,'assistant',notice,encode(sha256(convert_to(jsonb_build_object('role','assistant','content',notice)::text,'UTF8')),'hex')) ON CONFLICT(thread_id,request_key) DO NOTHING;
  INSERT INTO public.audit_events(organization_id,actor_id,action,entity_type,entity_id,metadata)
  VALUES(org,actor,'agent.runtime_registered','agent_responsibility',r.id::text,jsonb_build_object('runtimeId',p_runtime_id,'revision',r.revision,'state',r.state));
 END IF;
 RETURN jsonb_build_object('runtimeId',p_runtime_id,'responsibilityRevision',r.revision,'createdDefaultBudgets',created_defaults);
END $$;
REVOKE ALL ON FUNCTION public.agent_register_runtime(uuid,integer,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.agent_register_runtime(uuid,integer,text) TO acquire_agent_user;

-- Keep exact-pilot and old saved-UI behavior when no registered runtime GUC is
-- present. Registered callers independently recheck this persisted tuple at
-- claim, begin, and every current-run fence via the existing eligibility API.
ALTER FUNCTION public.agent_event_eligible(uuid,text) RENAME TO agent_event_eligible_before_registry;
CREATE FUNCTION public.agent_event_eligible(p_thread uuid,p_kind text) RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE runtime text:=nullif(current_setting('app.acquire_runtime_id',true),'');
BEGIN
 IF runtime IS NOT NULL AND NOT EXISTS(
  SELECT 1 FROM public.agent_runtime_registrations g JOIN public.agent_responsibilities r ON r.id=g.responsibility_id AND r.thread_id=g.thread_id
  JOIN public.member m ON m.organization_id=g.organization_id AND m.user_id=g.owner_user_id
  WHERE g.thread_id=p_thread AND g.runtime_id=runtime AND g.responsibility_revision=r.revision
  AND g.organization_id=r.organization_id AND g.owner_user_id=r.owner_user_id AND g.mandate_id=r.mandate_id
 ) THEN RETURN false;END IF;
 RETURN public.agent_event_eligible_before_registry(p_thread,p_kind);
END $$;
REVOKE ALL ON FUNCTION public.agent_event_eligible(uuid,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.agent_event_eligible(uuid,text) TO acquire_agent_user,acquire_agent_worker;
REVOKE ALL ON FUNCTION public.agent_event_eligible_before_registry(uuid,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.agent_event_eligible_before_registry(uuid,text) FROM acquire_agent_user,acquire_agent_worker;
CREATE FUNCTION public.agent_registered_worker_scopes(p_max integer,p_runtime_id text)
RETURNS TABLE(organization_id text,owner_user_id text,mandate_id uuid,thread_id uuid,responsibility_id uuid,responsibility_revision integer)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
 IF current_setting('role',true)<>'acquire_agent_worker' OR p_max IS NULL OR p_max NOT BETWEEN 1 AND 100 OR p_runtime_id IS NULL OR p_runtime_id!~'^[a-z][a-z0-9-]{2,99}$' OR p_runtime_id IS DISTINCT FROM current_setting('app.acquire_runtime_id',true) THEN RAISE EXCEPTION 'Configured registered worker runtime required';END IF;
 RETURN QUERY SELECT g.organization_id,g.owner_user_id,g.mandate_id,g.thread_id,g.responsibility_id,g.responsibility_revision
 FROM public.agent_runtime_registrations g JOIN public.agent_responsibilities r ON r.id=g.responsibility_id AND r.thread_id=g.thread_id
 JOIN public.member m ON m.organization_id=g.organization_id AND m.user_id=g.owner_user_id
 JOIN public.agent_events e ON e.thread_id=g.thread_id AND e.organization_id=g.organization_id AND e.owner_user_id=g.owner_user_id AND e.mandate_id=g.mandate_id
 WHERE g.runtime_id=p_runtime_id AND g.responsibility_revision=r.revision AND public.agent_event_eligible(e.thread_id,e.kind)
 AND e.available_at<=clock_timestamp() AND (e.state='pending' OR e.state='leased' AND e.lease_until<=clock_timestamp())
 AND NOT EXISTS(SELECT 1 FROM public.agent_runs run WHERE run.thread_id=g.thread_id AND run.state='running' AND (run.lease_until IS NULL OR run.lease_until>clock_timestamp()))
 GROUP BY g.organization_id,g.owner_user_id,g.mandate_id,g.thread_id,g.responsibility_id,g.responsibility_revision
 ORDER BY min(e.available_at),g.organization_id,g.owner_user_id,g.mandate_id LIMIT p_max;
END $$;
REVOKE ALL ON FUNCTION public.agent_registered_worker_scopes(integer,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.agent_registered_worker_scopes(integer,text) TO acquire_agent_worker;
