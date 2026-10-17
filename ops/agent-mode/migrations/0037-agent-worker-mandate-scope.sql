-- Exact optional server-owned mandate enumeration. Claiming independently
-- applies the same mandate filter under the existing actor RLS scope.
-- No responsibility/event/state/permission/budget is started or changed here.
CREATE FUNCTION public.agent_worker_scopes_for_mandate(maximum integer,selected_mandate uuid)
RETURNS TABLE(organization_id text,owner_user_id text) LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
 IF current_setting('role',true)<>'acquire_agent_worker' OR maximum IS NULL OR maximum NOT BETWEEN 1 AND 10 OR selected_mandate IS NULL THEN RAISE EXCEPTION 'Exact authenticated native mandate scope required'; END IF;
 RETURN QUERY SELECT r.organization_id,r.owner_user_id FROM public.agent_responsibilities r
 JOIN public.member m ON m.organization_id=r.organization_id AND m.user_id=r.owner_user_id
 JOIN public.agent_events e ON e.thread_id=r.thread_id AND e.organization_id=r.organization_id AND e.owner_user_id=r.owner_user_id
 WHERE r.mandate_id=selected_mandate AND e.mandate_id=selected_mandate
 AND public.agent_event_eligible(e.thread_id,e.kind) AND e.available_at<=clock_timestamp()
 AND (e.state='pending' OR e.state='leased' AND e.lease_until<=clock_timestamp())
 AND NOT EXISTS(SELECT 1 FROM public.agent_runs run WHERE run.thread_id=r.thread_id AND run.state='running' AND (run.lease_until IS NULL OR run.lease_until>clock_timestamp()))
 GROUP BY r.organization_id,r.owner_user_id ORDER BY min(e.available_at),r.organization_id,r.owner_user_id LIMIT maximum;
END $$;
REVOKE ALL ON FUNCTION public.agent_worker_scopes_for_mandate(integer,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.agent_worker_scopes_for_mandate(integer,uuid) TO acquire_agent_worker;
