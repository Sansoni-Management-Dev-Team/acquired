-- All replaced safety functions must match the reviewed applied preimages.
DO $preimages$ BEGIN
 IF encode(sha256(convert_to(pg_get_functiondef('public.agent_person_keys(text,uuid)'::regprocedure),'UTF8')),'hex')<>'f48c7b5f211b73cec37c85d5f36a9b77e05ea2f656be1f2940e36e9478b852a7' THEN RAISE EXCEPTION 'Identity function preimage changed: agent_person_keys';END IF;
 IF encode(sha256(convert_to(pg_get_functiondef('public.agent_canonical_contact_aliases(uuid)'::regprocedure),'UTF8')),'hex')<>'0db9bd0ad692d133b7a91b8a795f31bb47a8ee514ea60a6d4a4662fe249facfc' THEN RAISE EXCEPTION 'Identity function preimage changed: agent_canonical_contact_aliases';END IF;
 IF encode(sha256(convert_to(pg_get_functiondef('public.agent_person_unresolved_before_invitations(uuid,uuid)'::regprocedure),'UTF8')),'hex')<>'f64cd48776e091f4aebcea85e374b75ef37cb423182dc12ed9860c46aa65ae1d' THEN RAISE EXCEPTION 'Identity function preimage changed: agent_person_unresolved_before_invitations';END IF;
 IF encode(sha256(convert_to(pg_get_functiondef('public.agent_person_has_unresolved_sends(uuid,uuid)'::regprocedure),'UTF8')),'hex')<>'18f629fc4646ef08aee021a3cd6bbed02df91ab3ad091e254ac979566620e8b8' THEN RAISE EXCEPTION 'Identity function preimage changed: agent_person_has_unresolved_sends';END IF;
END $preimages$;
-- PREPARED ONLY: shared identity readiness kernel; no persistent cache or new authority.
-- Preserve the existing direct-key/one-hop-contact expansion exactly. In
-- particular this is NOT a recursive connected-component merge of person facts.
CREATE FUNCTION public.agent_contact_identity_batch(p_org text,p_contacts uuid[])
RETURNS TABLE(contact_id uuid,identity_keys text[],contact_aliases uuid[])
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $function$
BEGIN
 IF current_setting('role',true) NOT IN('acquire_agent_user','acquire_campaign_user')
 OR p_org IS DISTINCT FROM current_setting('app.acquire_org',true)
 OR NOT EXISTS(SELECT 1 FROM public.member WHERE organization_id=p_org AND user_id=current_setting('app.acquire_user',true))
 OR NOT EXISTS(SELECT 1 FROM public.communication_send_gates WHERE organization_id=p_org AND writer_xid=txid_current())
 THEN RAISE EXCEPTION 'Held canonical identity scope required';END IF;
 IF p_contacts IS NULL OR cardinality(p_contacts)>10000 OR array_position(p_contacts,NULL) IS NOT NULL THEN RAISE EXCEPTION 'Bounded canonical contacts required';END IF;
 RETURN QUERY
 WITH people AS MATERIALIZED(SELECT c.id,c.personal_data,c.firmable_person_id FROM public.contacts c WHERE c.organization_id=p_org),
 -- Matching keys intentionally retain the old raw comparison semantics. Only
 -- seed keys are length-bounded, as in the original agent_person_keys function.
 raw_keys AS MATERIALIZED(
  SELECT p.id,'contact:'||p.id::text AS key,true AS contact_key,true AS seedable FROM people p
  UNION ALL SELECT p.id,'email:'||lower(btrim(p.personal_data->>'email')),false,length(btrim(p.personal_data->>'email'))>0 FROM people p
  UNION ALL SELECT p.id,'firmable:'||p.firmable_person_id,false,true FROM people p WHERE p.firmable_person_id IS NOT NULL
  UNION ALL SELECT p.id,'whatsapp:'||(p.personal_data->>'phone'),false,true FROM people p WHERE p.personal_data->>'phone'~'^[+][1-9][0-9]{6,14}$'
  UNION ALL SELECT p.id,'linkedin:'||regexp_replace(p.personal_data->>'linkedinUrl','/$',''),false,true FROM people p WHERE p.personal_data->>'linkedinUrl'~'^https://www[.]linkedin[.]com/in/[A-Za-z0-9_%.-]+/?$'
  UNION ALL SELECT i.contact_id,i.channel||':'||i.identity,false,length(i.identity)>0 FROM public.campaign_reply_identities i JOIN people p ON p.id=i.contact_id WHERE i.organization_id=p_org
  UNION ALL SELECT i.contact_id,i.channel||':'||i.source_identity,false,length(i.source_identity)>0 FROM public.campaign_reply_identities i JOIN people p ON p.id=i.contact_id WHERE i.organization_id=p_org
 ),
 requested AS MATERIALIZED(SELECT p.id FROM people p WHERE p.id=ANY(p_contacts)),
 seeds AS MATERIALIZED(
  SELECT DISTINCT r.id,k.key FROM requested r JOIN raw_keys k ON k.id=r.id
  WHERE k.seedable AND length(k.key) BETWEEN 3 AND 400
 ),
 expanded AS MATERIALIZED(
  SELECT s.id,s.key FROM seeds s
  UNION SELECT s.id,'contact:'||k.id::text FROM seeds s JOIN raw_keys k ON k.key=s.key AND NOT k.contact_key
 ),
 aliases AS MATERIALIZED(SELECT DISTINCT e.id,k.id AS alias_id FROM expanded e JOIN raw_keys k ON k.key=e.key),
 key_sets AS(SELECT e.id,array_agg(e.key ORDER BY e.key) AS keys FROM expanded e GROUP BY e.id),
 alias_sets AS(SELECT a.id,array_agg(a.alias_id ORDER BY a.alias_id) AS ids FROM aliases a GROUP BY a.id)
 SELECT r.id,k.keys,a.ids FROM requested r JOIN key_sets k ON k.id=r.id JOIN alias_sets a ON a.id=r.id;
END $function$;
REVOKE ALL ON FUNCTION public.agent_contact_identity_batch(text,uuid[]) FROM PUBLIC;
-- This is a held-scope read, equivalent to the existing person-key entry point.
GRANT EXECUTE ON FUNCTION public.agent_contact_identity_batch(text,uuid[]) TO acquire_agent_user,acquire_campaign_user;

CREATE OR REPLACE FUNCTION public.agent_aliases_have_unresolved_sends(p_aliases uuid[], ignored_operation uuid, p_invitations boolean)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE org text:=current_setting('app.acquire_org',true);actor text:=current_setting('app.acquire_user',true);contacts uuid[]:=p_aliases;
BEGIN
 IF current_setting('role',true) NOT IN('acquire_agent_user','acquire_campaign_user')
 OR NOT EXISTS(SELECT 1 FROM public.member WHERE organization_id=org AND user_id=actor)
 OR NOT EXISTS(SELECT 1 FROM public.communication_send_gates WHERE organization_id=org AND writer_xid=txid_current()) THEN RAISE EXCEPTION 'Held current send scope required'; END IF;
 IF p_aliases IS NULL THEN RAISE EXCEPTION 'Canonical aliases required';END IF;
 IF ignored_operation IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.agent_operations o JOIN public.agent_conversations c ON c.id=o.conversation_id AND c.organization_id=o.organization_id WHERE o.id=ignored_operation AND o.organization_id=org AND o.owner_user_id=actor AND c.contact_id=ANY(contacts) AND NOT public.agent_is_original_demo_source('agent',o.id)) THEN RAISE EXCEPTION 'Only this owned send operation may be excluded'; END IF;
 IF EXISTS(SELECT 1 FROM public.campaign_send_attempts a JOIN public.campaign_enrolments e ON e.id=a.enrolment_id AND e.organization_id=a.organization_id WHERE a.organization_id=org AND e.contact_id=ANY(contacts) AND NOT public.agent_is_original_demo_source('campaign',a.id) AND a.state IN('claimed','unknown')) THEN RETURN true; END IF;
 IF EXISTS(SELECT 1 FROM public.messages m JOIN public.sequence_enrolments e ON e.id=m.enrolment_id AND e.organization_id=m.organization_id WHERE m.organization_id=org AND e.contact_id=ANY(contacts) AND NOT public.agent_is_original_demo_source('draft',m.id) AND m.state='queued') THEN RETURN true; END IF;
 IF EXISTS(SELECT 1 FROM public.agent_operations o JOIN public.agent_conversations c ON c.id=o.conversation_id AND c.organization_id=o.organization_id WHERE o.organization_id=org AND c.contact_id=ANY(contacts) AND NOT public.agent_is_original_demo_source('agent',o.id) AND o.name IN('email.initial','email.reply','email.follow_up','whatsapp.initial','whatsapp.reply','whatsapp.follow_up','linkedin.initial','linkedin.reply','linkedin.follow_up','email.manual_link') AND o.state IN('running','uncertain') AND o.id IS DISTINCT FROM ignored_operation) THEN RETURN true; END IF;
 -- A prepared/admitted intent stays unresolved until its original no-submission
 -- proof or a positively materialised original delivery receipt is saved.
 IF EXISTS(SELECT 1 FROM public.communication_dispatch_intents i
 WHERE i.organization_id=org AND i.contact_id=ANY(contacts) AND NOT (i.execution_mandate_id IS NOT NULL AND i.execution_context_digest IS NOT NULL AND i.execution_mode='demo')
 AND NOT EXISTS(SELECT 1 FROM public.communication_intent_resolutions r WHERE r.intent_id=i.id)
 AND NOT(i.source_kind='campaign' AND EXISTS(SELECT 1 FROM public.campaign_send_attempts a WHERE a.id=i.source_id AND a.organization_id=org AND a.state='sent' AND a.provider_message_id IS NOT NULL AND a.sent_at IS NOT NULL))
 AND NOT(i.source_kind='draft' AND EXISTS(SELECT 1 FROM public.messages m WHERE m.id=i.source_id AND m.organization_id=org AND m.state='sent' AND m.provider_message_id IS NOT NULL AND m.sent_at IS NOT NULL))
 AND NOT(i.source_kind='agent' AND EXISTS(SELECT 1 FROM public.agent_operations o WHERE o.id=i.source_id AND o.organization_id=org AND o.state='complete' AND o.result->'delivery'->>'status'='submitted'))
 AND (ignored_operation IS NULL OR i.source_kind<>'agent' OR i.source_id<>ignored_operation)) THEN RETURN true;END IF;
 RETURN p_invitations AND EXISTS(SELECT 1 FROM public.agent_operations o JOIN public.agent_conversations c ON c.id=o.conversation_id AND c.organization_id=o.organization_id WHERE o.organization_id=org AND c.contact_id=ANY(contacts) AND NOT public.agent_is_original_demo_source('agent',o.id) AND o.name='linkedin.invitation' AND o.state IN('running','uncertain') AND o.id IS DISTINCT FROM ignored_operation);
END $function$
;
REVOKE ALL ON FUNCTION public.agent_aliases_have_unresolved_sends(uuid[],uuid,boolean) FROM PUBLIC;
CREATE OR REPLACE FUNCTION public.agent_person_keys(org text,contact uuid) RETURNS text[] LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE result text[];BEGIN
 SELECT b.identity_keys INTO result FROM public.agent_contact_identity_batch(org,ARRAY[contact]) b;
 IF result IS NULL THEN RAISE EXCEPTION 'Canonical contact not found';END IF;RETURN result;END $$;
CREATE OR REPLACE FUNCTION public.agent_canonical_contact_aliases(p_contact uuid) RETURNS uuid[] LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE result uuid[];BEGIN
 SELECT b.contact_aliases INTO result FROM public.agent_contact_identity_batch(current_setting('app.acquire_org',true),ARRAY[p_contact]) b;
 IF result IS NULL THEN RAISE EXCEPTION 'Canonical contact not found';END IF;RETURN result;END $$;
CREATE OR REPLACE FUNCTION public.agent_person_unresolved_before_invitations(contact uuid,ignored_operation uuid DEFAULT NULL) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN RETURN public.agent_aliases_have_unresolved_sends(public.agent_canonical_contact_aliases(contact),ignored_operation,false);END $$;
CREATE OR REPLACE FUNCTION public.agent_person_has_unresolved_sends(contact uuid,ignored_operation uuid DEFAULT NULL) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN RETURN public.agent_aliases_have_unresolved_sends(public.agent_canonical_contact_aliases(contact),ignored_operation,true);END $$;
DO $check$ BEGIN IF encode(sha256(convert_to(pg_get_functiondef('public.agent_people_company_snapshot_before_company_projection(uuid,uuid[],uuid)'::regprocedure),'UTF8')),'hex')<>'159facf8e6c446b3566f6e81048f54f1436ee6910f0ac48d9fd8c6cc38f2149d' THEN RAISE EXCEPTION 'People identity kernel preimage changed';END IF;END $check$;
CREATE OR REPLACE FUNCTION public.agent_people_company_snapshot_before_company_projection(p_thread uuid, p_targets uuid[] DEFAULT NULL::uuid[], p_ignore_operation uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE org text:=current_setting('app.acquire_org',true);actor text:=current_setting('app.acquire_user',true);t public.agent_threads%ROWTYPE;r public.agent_responsibilities%ROWTYPE;mr text;c record;items jsonb:='[]';reasons jsonb;source text;findings jsonb;aliases uuid[];company_person_keys text[];company_person_aliases uuid[];
BEGIN
 PERFORM public.agent_assert_control_scope();
 SELECT * INTO t FROM public.agent_threads WHERE id=p_thread AND organization_id=org AND owner_user_id=actor;
 SELECT * INTO r FROM public.agent_responsibilities WHERE thread_id=t.id;
 SELECT xmin::text INTO mr FROM public.mandates WHERE id=t.mandate_id AND organization_id=org;
 IF t.id IS NULL OR cardinality(p_targets)>50 OR r.id IS NULL OR r.state NOT IN('ready','waiting') OR r.mandate_revision IS DISTINCT FROM mr THEN RAISE EXCEPTION 'Current owned people research scope required';END IF;
 IF p_ignore_operation IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.agent_operations WHERE id=p_ignore_operation AND thread_id=t.id AND organization_id=org AND owner_user_id=actor AND name='research.people') THEN RAISE EXCEPTION 'Owned people operation required';END IF;
 FOR c IN SELECT g.*,g.xmin::text source_xmin,mt.version membership_version,mt.assessment FROM public.targets g JOIN public.mandate_targets mt ON mt.organization_id=g.organization_id AND mt.target_id=g.id AND mt.mandate_id=t.mandate_id WHERE g.organization_id=org AND (p_targets IS NULL OR g.id=ANY(p_targets)) ORDER BY EXISTS(SELECT 1 FROM public.contacts cached WHERE cached.organization_id=org AND cached.target_id=g.id AND NOT cached.fictionalised AND coalesce(cached.personal_data->>'email','')<>''),g.id LIMIT 50 LOOP
  reasons:='[]';
  IF coalesce(c.firmable_company_id,'')!~'^f[0-9]+$' THEN reasons:=reasons||'"missing_firmable_company"'::jsonb;END IF;
  IF c.qualification::text='excluded' OR c.band::text='excluded' OR c.firmographics->'screening'->>'eligibility'='excluded' OR c.assessment->>'stage' IN('excluded','parked') THEN reasons:=reasons||'"company_excluded"'::jsonb;END IF;
  SELECT array_agg(p.id) INTO aliases FROM public.contacts p JOIN public.targets g ON g.id=p.target_id AND g.organization_id=org WHERE p.organization_id=org AND (g.id=c.id OR lower(regexp_replace(g.domain,'^www[.]',''))=lower(regexp_replace(c.domain,'^www[.]','')));
  WITH batch AS MATERIALIZED(SELECT * FROM public.agent_contact_identity_batch(org,coalesce(aliases,'{}'::uuid[])))
  SELECT ARRAY(SELECT DISTINCT unnest(b.identity_keys) FROM batch b),ARRAY(SELECT DISTINCT unnest(b.contact_aliases) FROM batch b) INTO company_person_keys,company_person_aliases;
  IF c.assessment->>'stage' IN('contacted','in-conversation') OR EXISTS(SELECT 1 FROM public.campaign_enrolments e WHERE e.organization_id=org AND e.contact_id=ANY(aliases)) OR EXISTS(SELECT 1 FROM public.messages x JOIN public.sequence_enrolments se ON se.id=x.enrolment_id WHERE x.organization_id=org AND se.contact_id=ANY(aliases) AND x.state='sent') OR EXISTS(SELECT 1 FROM public.campaign_inbound_events e WHERE e.organization_id=org AND e.contact_id=ANY(aliases)) OR EXISTS(SELECT 1 FROM public.agent_person_claims claim WHERE claim.organization_id=org AND claim.identity_key=ANY(company_person_keys)) THEN reasons:=reasons||'"previous_outreach_or_owned_company"'::jsonb;END IF;
  IF (EXISTS(SELECT 1 FROM public.contacts p WHERE p.id=ANY(aliases) AND coalesce(p.personal_data->>'doNotContact','false')<>'false') OR public.agent_aliases_have_unresolved_sends(company_person_aliases,NULL::uuid,true)) OR EXISTS(SELECT 1 FROM public.suppressions s WHERE s.organization_id=org AND (lower(regexp_replace(s.domain,'^www[.]',''))=lower(regexp_replace(c.domain,'^www[.]','')) OR EXISTS(SELECT 1 FROM public.contacts p WHERE p.id=ANY(aliases) AND lower(s.address)=lower(p.personal_data->>'email')))) THEN reasons:=reasons||'"suppressed_or_unresolved"'::jsonb;END IF;
  IF EXISTS(SELECT 1 FROM public.contacts p WHERE p.id=ANY(aliases) AND NOT p.fictionalised AND coalesce(p.personal_data->>'email','')~'^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$' AND (p_ignore_operation IS NULL OR p.provenance->>'nativePeopleOperationId' IS DISTINCT FROM p_ignore_operation::text)) THEN reasons:=reasons||'"usable_cached_contact"'::jsonb;END IF;
  SELECT coalesce(jsonb_agg(jsonb_build_object('id',f.id,'evidence',f.evidence,'observedAt',f.observed_at) ORDER BY f.observed_at DESC,f.id),'[]') INTO findings FROM(SELECT * FROM public.research_findings WHERE organization_id=org AND mandate_id=t.mandate_id AND target_id=c.id ORDER BY observed_at DESC,id LIMIT 20)f;
  source:=encode(sha256(convert_to(jsonb_build_object('target',c.source_xmin,'membership',c.membership_version,'assessment',c.assessment,'findings',findings)::text,'UTF8')),'hex');
  items:=items||jsonb_build_array(jsonb_build_object('targetId',c.id,'name',left(c.company_name,300),'firmableId',coalesce(c.firmable_company_id,''),'sourceRevision',source,'blockedReasons',reasons));
 END LOOP;
 RETURN jsonb_build_object('mandateRevision',mr,'responsibilityId',r.id,'responsibilityRevision',r.revision,'companies',items);
END $function$
;
