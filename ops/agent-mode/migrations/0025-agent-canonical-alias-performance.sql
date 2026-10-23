-- Preserve the existing one-hop canonical identity match while avoiding a
-- membership/gate/function lookup for every contact in an organisation.
-- This helper is private: callers remain the existing guarded definer functions.
CREATE FUNCTION agent_canonical_contact_aliases(p_contact uuid) RETURNS uuid[] LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE org text:=current_setting('app.acquire_org',true);keys text[];result uuid[];
BEGIN
 keys:=public.agent_person_keys(org,p_contact);
 SELECT array_agg(DISTINCT p.id ORDER BY p.id) INTO result FROM public.contacts p WHERE p.organization_id=org AND (
  'contact:'||p.id::text=ANY(keys) OR 'email:'||lower(btrim(p.personal_data->>'email'))=ANY(keys)
  OR 'firmable:'||p.firmable_person_id=ANY(keys)
  OR EXISTS(SELECT 1 FROM public.campaign_reply_identities i WHERE i.organization_id=org AND i.contact_id=p.id AND (i.channel||':'||i.identity=ANY(keys) OR i.channel||':'||i.source_identity=ANY(keys)))
 );
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION agent_canonical_contact_aliases(uuid) FROM PUBLIC;

-- All unresolved-send states, ignored-operation scope and positive-receipt
-- exceptions remain byte-for-byte the original policy after alias resolution.
CREATE OR REPLACE FUNCTION agent_person_has_unresolved_sends(contact uuid,ignored_operation uuid DEFAULT NULL) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE org text:=current_setting('app.acquire_org',true);actor text:=current_setting('app.acquire_user',true);identities text[];contacts uuid[];
BEGIN
 IF current_setting('role',true) NOT IN('acquire_agent_user','acquire_campaign_user')
 OR NOT EXISTS(SELECT 1 FROM public.member WHERE organization_id=org AND user_id=actor)
 OR NOT EXISTS(SELECT 1 FROM public.communication_send_gates WHERE organization_id=org AND writer_xid=txid_current()) THEN RAISE EXCEPTION 'Held current send scope required'; END IF;
 identities:=public.agent_person_keys(org,contact);
 contacts:=public.agent_canonical_contact_aliases(contact);
 IF ignored_operation IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.agent_operations o JOIN public.agent_conversations c ON c.id=o.conversation_id AND c.organization_id=o.organization_id WHERE o.id=ignored_operation AND o.organization_id=org AND o.owner_user_id=actor AND c.contact_id=ANY(contacts)) THEN RAISE EXCEPTION 'Only this owned send operation may be excluded'; END IF;
 IF EXISTS(SELECT 1 FROM public.campaign_send_attempts a JOIN public.campaign_enrolments e ON e.id=a.enrolment_id AND e.organization_id=a.organization_id WHERE a.organization_id=org AND e.contact_id=ANY(contacts) AND a.state IN('claimed','unknown')) THEN RETURN true; END IF;
 IF EXISTS(SELECT 1 FROM public.messages m JOIN public.sequence_enrolments e ON e.id=m.enrolment_id AND e.organization_id=m.organization_id WHERE m.organization_id=org AND e.contact_id=ANY(contacts) AND m.state='queued') THEN RETURN true; END IF;
 IF EXISTS(SELECT 1 FROM public.agent_operations o JOIN public.agent_conversations c ON c.id=o.conversation_id AND c.organization_id=o.organization_id WHERE o.organization_id=org AND c.contact_id=ANY(contacts) AND o.name IN('email.initial','email.reply','email.follow_up','email.manual_link') AND o.state IN('running','uncertain') AND o.id IS DISTINCT FROM ignored_operation) THEN RETURN true; END IF;
 -- A prepared/admitted intent stays unresolved until its original no-submission
 -- proof or a positively materialised original delivery receipt is saved.
 RETURN EXISTS(SELECT 1 FROM public.communication_dispatch_intents i
 WHERE i.organization_id=org AND i.contact_id=ANY(contacts)
 AND NOT EXISTS(SELECT 1 FROM public.communication_intent_resolutions r WHERE r.intent_id=i.id)
 AND NOT(i.source_kind='campaign' AND EXISTS(SELECT 1 FROM public.campaign_send_attempts a WHERE a.id=i.source_id AND a.organization_id=org AND a.state='sent' AND a.provider_message_id IS NOT NULL AND a.sent_at IS NOT NULL))
 AND NOT(i.source_kind='draft' AND EXISTS(SELECT 1 FROM public.messages m WHERE m.id=i.source_id AND m.organization_id=org AND m.state='sent' AND m.provider_message_id IS NOT NULL AND m.sent_at IS NOT NULL))
 AND NOT(i.source_kind='agent' AND EXISTS(SELECT 1 FROM public.agent_operations o WHERE o.id=i.source_id AND o.organization_id=org AND o.state='complete' AND o.result->'delivery'->>'status'='submitted'))
 AND (ignored_operation IS NULL OR i.source_kind<>'agent' OR i.source_id<>ignored_operation));
END $$;
REVOKE ALL ON FUNCTION agent_person_has_unresolved_sends(uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION agent_person_has_unresolved_sends(uuid,uuid) TO acquire_agent_user,acquire_campaign_user;

-- Tenant-scoped cached target facts and source tokens; no global cache or send tool.
CREATE OR REPLACE FUNCTION agent_target_snapshot(p_thread uuid,p_contacts uuid[] DEFAULT NULL) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE org text:=current_setting('app.acquire_org',true);actor text:=current_setting('app.acquire_user',true);t public.agent_threads%ROWTYPE;r public.agent_responsibilities%ROWTYPE;m public.mandates%ROWTYPE;c record;ids text[];aliases uuid[];items jsonb:='[]';reasons jsonb;source text;findings jsonb;mandate_revision text;
BEGIN
 PERFORM public.agent_assert_control_scope();
 SELECT * INTO t FROM public.agent_threads WHERE id=p_thread AND organization_id=org AND owner_user_id=actor;
 IF t.id IS NULL OR cardinality(p_contacts)>50 THEN RAISE EXCEPTION 'Owned bounded target scope required'; END IF;
 SELECT * INTO r FROM public.agent_responsibilities WHERE thread_id=t.id;
 SELECT * INTO m FROM public.mandates WHERE id=t.mandate_id AND organization_id=org;
 SELECT xmin::text INTO mandate_revision FROM public.mandates WHERE id=t.mandate_id AND organization_id=org;
 IF r.id IS NULL OR r.state NOT IN('ready','waiting') OR r.mandate_revision IS DISTINCT FROM mandate_revision THEN RAISE EXCEPTION 'Current active mandate supervision required'; END IF;
 FOR c IN SELECT p.*,p.xmin::text contact_revision,g.xmin::text target_revision,g.company_name,g.domain,g.identifiers,g.firmographics,g.status target_status,g.qualification,g.fit_score,g.ripeness_score,g.financeability_score,g.confidence_score,g.band,mt.version membership_version,mt.assessment
 FROM public.contacts p JOIN public.mandate_targets mt ON mt.organization_id=p.organization_id AND mt.target_id=p.target_id AND mt.mandate_id=t.mandate_id JOIN public.targets g ON g.id=p.target_id AND g.organization_id=org
 WHERE p.organization_id=org AND (p_contacts IS NULL OR p.id=ANY(p_contacts)) ORDER BY EXISTS(SELECT 1 FROM public.agent_person_claims claim WHERE claim.organization_id=org AND claim.identity_key='contact:'||p.id::text),p.fictionalised,coalesce(p.personal_data->>'doNotContact','false')<>'false',coalesce(p.personal_data->>'email','')='',p.id LIMIT 50 LOOP
  ids:=public.agent_person_keys(org,c.id);
  aliases:=public.agent_canonical_contact_aliases(c.id);
  reasons:='[]';
  IF c.fictionalised OR coalesce(c.personal_data->>'doNotContact','false')<>'false' THEN reasons:=reasons||'"contact_not_admissible"'::jsonb;END IF;
  IF EXISTS(SELECT 1 FROM public.suppressions s WHERE s.organization_id=org AND EXISTS(SELECT 1 FROM public.contacts a WHERE a.id=ANY(aliases) AND (lower(s.address)=lower(btrim(a.personal_data->>'email')) OR lower(s.domain)=split_part(lower(btrim(a.personal_data->>'email')),'@',2)))) OR EXISTS(SELECT 1 FROM public.contacts p WHERE p.id=ANY(aliases) AND coalesce(p.personal_data->>'doNotContact','false')<>'false') THEN reasons:=reasons||'"suppressed"'::jsonb;END IF;
  IF EXISTS(SELECT 1 FROM public.agent_person_claims k WHERE k.organization_id=org AND k.identity_key=ANY(ids)) THEN reasons:=reasons||'"conversation_already_owned"'::jsonb;END IF;
  IF EXISTS(SELECT 1 FROM public.campaign_enrolments e WHERE e.organization_id=org AND e.contact_id=ANY(aliases) AND e.state IN('active','paused','needs_review')) THEN reasons:=reasons||'"structured_sequence_owner"'::jsonb;END IF;
  IF public.agent_person_has_unresolved_sends(c.id,NULL::uuid) THEN reasons:=reasons||'"unresolved_send"'::jsonb;END IF;
  IF c.assessment->>'stage' IN('contacted','in-conversation') OR EXISTS(SELECT 1 FROM public.messages x JOIN public.sequence_enrolments se ON se.id=x.enrolment_id WHERE x.organization_id=org AND se.contact_id=ANY(aliases) AND x.state='sent') OR EXISTS(SELECT 1 FROM public.campaign_send_attempts a JOIN public.campaign_enrolments e ON e.id=a.enrolment_id WHERE a.organization_id=org AND e.contact_id=ANY(aliases) AND (a.state='sent' OR a.sent_at IS NOT NULL)) OR EXISTS(SELECT 1 FROM public.campaign_inbound_events x WHERE x.organization_id=org AND x.contact_id=ANY(aliases)) THEN reasons:=reasons||'"previously_contacted"'::jsonb;END IF;
  SELECT coalesce(jsonb_agg(jsonb_build_object('id',f.id,'jobId',f.job_id,'targetId',f.target_id,'sourceUrl',f.source_url,'observedAt',f.observed_at,'evidence',f.evidence,'confidence',f.confidence) ORDER BY f.observed_at DESC,f.id),'[]') INTO findings FROM(SELECT * FROM public.research_findings WHERE organization_id=org AND mandate_id=t.mandate_id AND target_id=c.target_id ORDER BY observed_at DESC,id LIMIT 20)f;
  source:=encode(sha256(convert_to(jsonb_build_object('contact',c.contact_revision,'target',c.target_revision,'membership',c.membership_version,'assessment',c.assessment,'findings',findings)::text,'UTF8')),'hex');
  items:=items||jsonb_build_array(jsonb_build_object('contactId',c.id,'targetId',c.target_id,'name',c.display_name,'email',coalesce(c.personal_data->>'email',''),'sourceRevision',source,'assessment',c.assessment,'findings',findings,'blockedReasons',reasons,'identityKeys',to_jsonb(ids),
   'target',jsonb_build_object('id',c.target_id,'organizationId',org,'companyName',c.company_name,'domain',c.domain,'identifiers',c.identifiers,'firmographics',c.firmographics,'status',c.target_status,'qualification',c.qualification,'fitScore',c.fit_score,'ripenessScore',c.ripeness_score,'financeabilityScore',c.financeability_score,'confidenceScore',c.confidence_score,'band',c.band)));
 END LOOP;
 RETURN jsonb_build_object('mandateRevision',mandate_revision,'responsibilityId',r.id,'responsibilityRevision',r.revision,'brief',m.filters->'brief','candidates',items,'companies',(SELECT count(*) FROM public.mandate_targets WHERE organization_id=org AND mandate_id=t.mandate_id),'contacts',(SELECT count(*) FROM public.contacts p JOIN public.mandate_targets mt ON mt.target_id=p.target_id AND mt.organization_id=p.organization_id WHERE p.organization_id=org AND mt.mandate_id=t.mandate_id));
END $$;
REVOKE ALL ON FUNCTION agent_target_snapshot(uuid,uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION agent_target_snapshot(uuid,uuid[]) TO acquire_agent_user;
