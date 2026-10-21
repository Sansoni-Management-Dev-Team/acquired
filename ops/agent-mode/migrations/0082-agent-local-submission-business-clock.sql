-- SIM28: one forward receipt consumer for selected local business time.
-- Genuine receipt identity, private permit, digests, membership and held writer
-- fences are unchanged. Unregistered contexts still use real wall time through
-- the immutable0081 helper; registered missing/foreign contexts refuse.
SET LOCAL statement_timeout='15s';SET LOCAL lock_timeout='5s';
SELECT pg_advisory_xact_lock(1094930773,2901);
DO $target$ BEGIN
 IF current_database()<>'acquire_agent_mode'
 OR (SELECT shobj_description(oid,'pg_database') FROM pg_database WHERE datname=current_database()) IS DISTINCT FROM 'acquire-agent-mode-local-only'
 OR (SELECT system_identifier::text FROM pg_control_system())<>'7697400069962248225'
 OR to_regprocedure('public.local_simulator_business_now()') IS NULL THEN RAISE EXCEPTION 'Exact isolated local clock target required';END IF;
END $target$;
DO $predecessors$ BEGIN
 IF (SELECT count(*) FROM public.agent_local_migrations)<>79
 OR (SELECT sha256 FROM public.agent_local_migrations WHERE name='0080-agent-local-business-clock.sql') IS DISTINCT FROM 'f9b2947a2111014fc720be776d3920d4f04881e403bfcc9dacef4fa1255afebd'
 OR (SELECT sha256 FROM public.agent_local_migrations WHERE name='0081-agent-local-business-consumers.sql') IS DISTINCT FROM 'a560cb8cc14d6ed4dbbcbdcba3443a37f07af03e8d767407e217547a85b29797' THEN RAISE EXCEPTION 'Exact installed0080/0081 ledger required';END IF;
 IF (SELECT encode(sha256(convert_to(prosrc,'UTF8')),'hex') FROM pg_proc WHERE oid='public.local_simulator_business_now()'::regprocedure AND pg_get_userbyid(proowner)='project_acquire' AND prosecdef AND proconfig=ARRAY['search_path=pg_catalog, public']::text[]) IS DISTINCT FROM 'c0a72234ad4681cd608471093fea91a721be791724fc990d7dbf43f28644e710' THEN RAISE EXCEPTION 'Exact installed0081 SQL clock required';END IF;
 IF (SELECT encode(sha256(convert_to(pg_get_functiondef(oid),'UTF8')),'hex') FROM pg_proc WHERE oid='public.communications_submission_receipt_guard()'::regprocedure AND pg_get_userbyid(proowner)='project_acquire' AND prosecdef AND proconfig=ARRAY['search_path=pg_catalog, public']::text[] AND proacl::text='{project_acquire=X/project_acquire}') IS DISTINCT FROM '74909218f134348b1c9978fbb42e7f6357afd47c0a2965be5fcbd747a2f057d3' THEN RAISE EXCEPTION 'Changed predecessor: communications_submission_receipt_guard()';END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='public.communication_submission_receipts'::regclass AND tgname='submission_receipt_insert_guard' AND tgfoid='public.communications_submission_receipt_guard()'::regprocedure AND tgtype=7 AND tgenabled='O' AND NOT tgisinternal) THEN RAISE EXCEPTION 'Exact original receipt insert trigger required';END IF;
END $predecessors$;
-- The only function-body change is the future submitted_at clock boundary.
CREATE OR REPLACE FUNCTION public.communications_submission_receipt_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE i public.communication_dispatch_intents%ROWTYPE;
BEGIN
 IF NEW.organization_id IS DISTINCT FROM current_setting('app.acquire_org',true) OR NEW.owner_user_id IS DISTINCT FROM current_setting('app.acquire_user',true)
 OR NOT EXISTS(SELECT 1 FROM public.member WHERE organization_id=NEW.organization_id AND user_id=NEW.owner_user_id)
 OR NOT EXISTS(SELECT 1 FROM public.communication_send_gates WHERE organization_id=NEW.organization_id AND writer_xid=txid_current()) THEN RAISE EXCEPTION 'Held current original receipt scope required';END IF;
 SELECT * INTO i FROM public.communication_dispatch_intents WHERE id=NEW.intent_id AND organization_id=NEW.organization_id AND owner_user_id=NEW.owner_user_id;
 IF i.id IS NULL OR i.binding_id IS DISTINCT FROM NEW.binding_id OR i.source_kind IS DISTINCT FROM NEW.source_kind OR i.source_id IS DISTINCT FROM NEW.source_id
 OR i.operation IS DISTINCT FROM NEW.operation OR i.operation_key IS DISTINCT FROM NEW.operation_key OR i.payload_digest IS DISTINCT FROM NEW.payload_digest
 OR i.source_digest IS DISTINCT FROM NEW.source_digest OR i.intent_digest IS DISTINCT FROM NEW.original_intent_digest
 OR NEW.submitted_at>public.local_simulator_business_now() OR NOT EXISTS(SELECT 1 FROM public.communication_dispatch_permits WHERE intent_id=i.id)
 OR EXISTS(SELECT 1 FROM public.communication_intent_resolutions WHERE intent_id=i.id)
 THEN RAISE EXCEPTION 'Exact authenticated original submission receipt required';END IF;
 RETURN NEW;
END $function$
;
