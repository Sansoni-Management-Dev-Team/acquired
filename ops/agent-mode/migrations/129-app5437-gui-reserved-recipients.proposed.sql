-- PROPOSED ONLY. Requires specific user approval before application.
-- APP5437 only. Adds the exact existing5991 run's reserved email/LinkedIn aliases.
-- Phone grammar, historical aliases, ownership/binding/admission checks and quotas remain unchanged.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='15s';
DO $guard$
DECLARE p pg_catalog.pg_proc%ROWTYPE;
BEGIN
 IF current_database() IS DISTINCT FROM 'acquire_agent_mode'
 OR shobj_description((SELECT oid FROM pg_database WHERE datname=current_database()),'pg_database') IS DISTINCT FROM 'acquire-agent-mode-local-only'
 OR (SELECT system_identifier::text FROM pg_control_system()) IS DISTINCT FROM '7697400069962248225'
 OR current_user IS DISTINCT FROM 'project_acquire' OR session_user IS DISTINCT FROM 'project_acquire'
 THEN RAISE EXCEPTION 'Exact isolated APP5437 database owner required';END IF;
 SELECT * INTO p FROM pg_catalog.pg_proc WHERE oid=to_regprocedure('public.agent_channel_reserved_recipient(text,text)');
 IF p.oid IS NULL OR encode(sha256(convert_to(p.prosrc,'UTF8')),'hex') IS DISTINCT FROM 'e935e46c9e95d732ab3fa6a7a4e9b99a776e1c4c638a60c3b45f555187289370'
 OR pg_get_userbyid(p.proowner) IS DISTINCT FROM 'project_acquire'
 OR p.prosecdef IS DISTINCT FROM false OR p.provolatile IS DISTINCT FROM 'i'
 OR p.proacl::text IS DISTINCT FROM '{project_acquire=X/project_acquire}'
 OR p.proconfig IS DISTINCT FROM ARRAY['search_path=pg_catalog, public']::text[]
 OR p.prorettype IS DISTINCT FROM 'boolean'::regtype OR p.prolang IS DISTINCT FROM (SELECT oid FROM pg_language WHERE lanname='sql')
 THEN RAISE EXCEPTION 'Exact reserved-recipient predecessor and authority required';END IF;
END $guard$;
CREATE OR REPLACE FUNCTION public.agent_channel_reserved_recipient(p_channel text,p_value text)
 RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path TO 'pg_catalog','public'
AS $function$
 SELECT CASE p_channel WHEN 'email' THEN p_value~'^lead-[0-9]{3}@agent-(multichannel-20261017|real-research-demos|deep-gui-20261020)[.]leads[.]acquire[.]test$'
 WHEN 'whatsapp' THEN p_value~'^[+]999[0-9]{12}$'
 WHEN 'linkedin' THEN p_value~'^https://www[.]linkedin[.]com/in/sim-agent-(multichannel-20261017|real-research-demos|deep-gui-20261020)-lead-[0-9]{3}$' ELSE false END;
$function$;
DO $readback$
DECLARE p pg_catalog.pg_proc%ROWTYPE;
BEGIN
 SELECT * INTO p FROM pg_catalog.pg_proc WHERE oid=to_regprocedure('public.agent_channel_reserved_recipient(text,text)');
 IF encode(sha256(convert_to(p.prosrc,'UTF8')),'hex') IS DISTINCT FROM '30882392c63325bb454efdb8eae9579815228c1c5674de3d52d48c16197979af'
 OR pg_get_userbyid(p.proowner) IS DISTINCT FROM 'project_acquire'
 OR p.prosecdef IS DISTINCT FROM false OR p.provolatile IS DISTINCT FROM 'i'
 OR p.proacl::text IS DISTINCT FROM '{project_acquire=X/project_acquire}'
 OR p.proconfig IS DISTINCT FROM ARRAY['search_path=pg_catalog, public']::text[]
 THEN RAISE EXCEPTION 'Reserved-recipient body or original authority differs';END IF;
END $readback$;
COMMIT;
