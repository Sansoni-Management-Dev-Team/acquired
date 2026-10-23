-- SIM28: forward only the cold-person historical-outbound quiet comparison.
-- Applied0051/0070/0080-0084 stay immutable. Default business-clock fallback
-- remains real time; actor/run guards, MAX(all-person outbound), NULL delay,
-- private owner/ACL and every other predicate are unchanged.
-- The reviewed migration runner owns the atomic transaction/ledger insert.
SET LOCAL statement_timeout='15s';SET LOCAL lock_timeout='5s';
SELECT pg_advisory_xact_lock(1094930773,2901);
DO $target$ BEGIN
 IF current_database()<>'acquire_agent_mode'
 OR (SELECT shobj_description(oid,'pg_database') FROM pg_database WHERE datname=current_database()) IS DISTINCT FROM 'acquire-agent-mode-local-only'
 OR (SELECT system_identifier::text FROM pg_control_system())<>'7697400069962248225'
 OR current_user IS DISTINCT FROM 'project_acquire' THEN RAISE EXCEPTION 'Exact isolated local cold-quiet target required';END IF;
END $target$;
DO $predecessors$ BEGIN
 IF (SELECT count(*) FROM public.agent_local_migrations)<>82
 OR (SELECT sha256 FROM public.agent_local_migrations WHERE name='0084-agent-email-causal-optional-conversation.sql') IS DISTINCT FROM 'e3055a868b9e50eae6a8505489d78c26a675fb53bbea11b03e4101304d87d867'
 OR (SELECT sha256 FROM public.agent_local_migrations WHERE name='0081-agent-local-business-consumers.sql') IS DISTINCT FROM 'a560cb8cc14d6ed4dbbcbdcba3443a37f07af03e8d767407e217547a85b29797' THEN RAISE EXCEPTION 'Exact installed0084 and scoped-clock ledger required';END IF;
 IF (SELECT encode(sha256(convert_to(pg_get_functiondef(oid),'UTF8')),'hex') FROM pg_proc WHERE oid='public.agent_channel_proposal_before_execution_context(uuid,text)'::regprocedure AND pg_get_userbyid(proowner)='project_acquire' AND prosecdef AND proconfig=ARRAY['search_path=pg_catalog, public']::text[] AND proacl::text='{project_acquire=X/project_acquire}') IS DISTINCT FROM '6b6cc9729270cd85d115f4c60637fc52d64a9d4636e26b8fca422259ad33d96e' THEN RAISE EXCEPTION 'Changed private cold-quiet predecessor';END IF;
END $predecessors$;

CREATE OR REPLACE FUNCTION public.agent_channel_proposal_before_execution_context(p_route uuid, p_stage text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE last_out timestamptz;delay integer;c public.agent_conversations%ROWTYPE;
BEGIN
 IF NOT public.agent_channel_proposal_permitted_before_history_quiet(p_route,p_stage) THEN RETURN false;END IF;
 SELECT person.* INTO c FROM public.agent_conversations person JOIN public.agent_conversation_channels r ON r.conversation_id=person.id WHERE r.id=p_route;
 IF c.engagement='cold' AND p_stage IN('initial','follow_up','invitation') THEN
  SELECT max((m->>'at')::timestamptz) INTO last_out FROM jsonb_array_elements(c.history) m WHERE m->>'direction'='outbound';
  SELECT delay_seconds INTO delay FROM public.agent_channel_policies WHERE thread_id=c.thread_id;
  IF last_out IS NOT NULL AND (delay IS NULL OR last_out+make_interval(secs=>delay)>public.local_simulator_business_now()) THEN RETURN false;END IF;
 END IF;RETURN true;
END $function$;

DO $postcondition$ BEGIN
 IF (SELECT encode(sha256(convert_to(pg_get_functiondef(oid),'UTF8')),'hex') FROM pg_proc WHERE oid='public.agent_channel_proposal_before_execution_context(uuid,text)'::regprocedure AND pg_get_userbyid(proowner)='project_acquire' AND prosecdef AND proconfig=ARRAY['search_path=pg_catalog, public']::text[] AND proacl::text='{project_acquire=X/project_acquire}') IS DISTINCT FROM '3ec4002c066391d95d41f70266103e3f5d18826ecf6189353cfc50b334be6b07' THEN RAISE EXCEPTION 'Cold-quiet business clock postcondition failed';END IF;
END $postcondition$;
