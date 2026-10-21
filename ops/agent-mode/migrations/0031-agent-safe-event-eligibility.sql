-- Preserve original actor/membership scope while allowing only internal
-- notifications and original-receipt reconciliation after supervision stops.
-- This does not permit a model, research, sequence or send to resume.
CREATE FUNCTION public.agent_event_eligible(p_thread uuid,p_kind text) RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE t public.agent_threads%ROWTYPE;r public.agent_responsibilities%ROWTYPE;invoker text:=current_setting('role',true);
BEGIN
 IF invoker NOT IN('acquire_agent_user','acquire_agent_worker') THEN RAISE EXCEPTION 'Authenticated native event scope required'; END IF;
 SELECT * INTO t FROM public.agent_threads WHERE id=p_thread;
 IF t.id IS NULL OR NOT EXISTS(SELECT 1 FROM public.member m WHERE m.organization_id=t.organization_id AND m.user_id=t.owner_user_id) THEN RETURN false; END IF;
 IF invoker='acquire_agent_user' AND (t.organization_id IS DISTINCT FROM current_setting('app.acquire_org',true) OR t.owner_user_id IS DISTINCT FROM current_setting('app.acquire_user',true)) THEN RETURN false; END IF;
 SELECT * INTO r FROM public.agent_responsibilities WHERE thread_id=t.id AND organization_id=t.organization_id AND owner_user_id=t.owner_user_id;
 -- Generic saved-conversation events predate native responsibilities. Only the
 -- scoped user claimer retains that compatibility; worker enumeration below
 -- always joins a persisted responsibility.
 IF r.id IS NULL THEN RETURN invoker='acquire_agent_user' AND NOT EXISTS(SELECT 1 FROM public.agent_responsibilities WHERE thread_id=t.id); END IF;
 IF r.state IN('ready','waiting') THEN RETURN true; END IF;
 RETURN r.state IN('paused','human_owned','complete') AND p_kind IN('human.handoff_reminder','email.reconcile','conversation.history_changed','human.handoff_required','human.handoff_updated','agent.review_required');
END $$;
REVOKE ALL ON FUNCTION public.agent_event_eligible(uuid,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.agent_event_eligible(uuid,text) TO acquire_agent_user,acquire_agent_worker;
CREATE OR REPLACE FUNCTION public.agent_worker_scopes(maximum integer) RETURNS TABLE(organization_id text,owner_user_id text) LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
 IF current_setting('role',true)<>'acquire_agent_worker' OR maximum NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION 'Authenticated agent worker scope required'; END IF;
 RETURN QUERY SELECT r.organization_id,r.owner_user_id FROM public.agent_responsibilities r
 JOIN public.member m ON m.organization_id=r.organization_id AND m.user_id=r.owner_user_id
 JOIN public.agent_events e ON e.thread_id=r.thread_id AND e.organization_id=r.organization_id AND e.owner_user_id=r.owner_user_id
 WHERE public.agent_event_eligible(e.thread_id,e.kind) AND e.available_at<=clock_timestamp()
 AND (e.state='pending' OR e.state='leased' AND e.lease_until<=clock_timestamp())
 AND NOT EXISTS(SELECT 1 FROM public.agent_runs run WHERE run.thread_id=r.thread_id AND run.state='running' AND (run.lease_until IS NULL OR run.lease_until>clock_timestamp()))
 GROUP BY r.organization_id,r.owner_user_id ORDER BY min(e.available_at),r.organization_id,r.owner_user_id LIMIT maximum;
END $$;
REVOKE ALL ON FUNCTION public.agent_worker_scopes(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.agent_worker_scopes(integer) TO acquire_agent_worker;
