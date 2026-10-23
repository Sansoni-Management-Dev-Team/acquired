-- Owned normal manual-contact selection; no synthetic target/company or data repair.
-- Current contact revisions and immutable normal contact-created receipts are
-- projected only inside actor/organisation/mandate scope. No new table grants.
CREATE FUNCTION public.agent_manual_target_snapshot(p_thread uuid,p_contacts uuid[] DEFAULT NULL) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE org text:=current_setting('app.acquire_org',true);actor text:=current_setting('app.acquire_user',true);t public.agent_threads%ROWTYPE;r public.agent_responsibilities%ROWTYPE;m public.mandates%ROWTYPE;c record;ids text[];aliases uuid[];items jsonb:='[]';reasons jsonb;source text;mandate_revision text;total integer;
BEGIN
 PERFORM public.agent_assert_control_scope();
 SELECT * INTO t FROM public.agent_threads WHERE id=p_thread AND organization_id=org AND owner_user_id=actor;
 IF t.id IS NULL OR cardinality(p_contacts)>50 THEN RAISE EXCEPTION 'Owned bounded manual contact scope required'; END IF;
 SELECT * INTO r FROM public.agent_responsibilities WHERE thread_id=t.id FOR SHARE;
 SELECT * INTO m FROM public.mandates WHERE id=t.mandate_id AND organization_id=org FOR SHARE;
 SELECT xmin::text INTO mandate_revision FROM public.mandates WHERE id=t.mandate_id AND organization_id=org;
 IF r.id IS NULL OR r.state NOT IN('ready','waiting') OR r.mandate_revision IS DISTINCT FROM mandate_revision THEN RAISE EXCEPTION 'Current active mandate supervision required'; END IF;
 FOR c IN SELECT p.*,p.xmin::text AS contact_revision,receipt.id AS creation_receipt,NULL::jsonb AS assessment
 FROM public.contacts p JOIN LATERAL(SELECT a.id FROM public.audit_events a
 WHERE a.organization_id=org AND a.actor_id=actor AND a.action='contact.created' AND a.entity_type='contact' AND a.entity_id=p.id::text AND a.metadata->>'mandateId'=t.mandate_id::text AND a.metadata->>'source'='Manual entry' ORDER BY a.created_at,a.id LIMIT 1)receipt ON true
 WHERE p.organization_id=org AND p.mandate_id=t.mandate_id AND p.target_id IS NULL AND p.provenance->>'source'='Manual entry' AND p.provenance->>'createdBy'=actor AND (p_contacts IS NULL OR p.id=ANY(p_contacts))
 ORDER BY EXISTS(SELECT 1 FROM public.agent_person_claims claim WHERE claim.organization_id=org AND claim.identity_key='contact:'||p.id::text),p.fictionalised,coalesce(p.personal_data->>'doNotContact','false')<>'false',coalesce(p.personal_data->>'email','')='',p.id LIMIT 50 FOR SHARE OF p LOOP
  ids:=public.agent_person_keys(org,c.id);
  aliases:=public.agent_canonical_contact_aliases(c.id);
  reasons:='[]';
  IF c.fictionalised OR coalesce(c.personal_data->>'doNotContact','false')<>'false' THEN reasons:=reasons||'"contact_not_admissible"'::jsonb;END IF;
  IF EXISTS(SELECT 1 FROM public.suppressions s WHERE s.organization_id=org AND EXISTS(SELECT 1 FROM public.contacts a WHERE a.id=ANY(aliases) AND (lower(s.address)=lower(btrim(a.personal_data->>'email')) OR lower(s.domain)=split_part(lower(btrim(a.personal_data->>'email')),'@',2)))) OR EXISTS(SELECT 1 FROM public.contacts p WHERE p.id=ANY(aliases) AND coalesce(p.personal_data->>'doNotContact','false')<>'false') THEN reasons:=reasons||'"suppressed"'::jsonb;END IF;
  IF EXISTS(SELECT 1 FROM public.agent_person_claims k WHERE k.organization_id=org AND k.identity_key=ANY(ids)) THEN reasons:=reasons||'"conversation_already_owned"'::jsonb;END IF;
  IF EXISTS(SELECT 1 FROM public.campaign_enrolments e WHERE e.organization_id=org AND e.contact_id=ANY(aliases) AND e.state IN('active','paused','needs_review')) THEN reasons:=reasons||'"structured_sequence_owner"'::jsonb;END IF;
  IF public.agent_person_has_unresolved_sends(c.id,NULL::uuid) THEN reasons:=reasons||'"unresolved_send"'::jsonb;END IF;
  IF c.assessment->>'stage' IN('contacted','in-conversation') OR EXISTS(SELECT 1 FROM public.messages x JOIN public.sequence_enrolments se ON se.id=x.enrolment_id WHERE x.organization_id=org AND se.contact_id=ANY(aliases) AND x.state='sent') OR EXISTS(SELECT 1 FROM public.campaign_send_attempts a JOIN public.campaign_enrolments e ON e.id=a.enrolment_id WHERE a.organization_id=org AND e.contact_id=ANY(aliases) AND (a.state='sent' OR a.sent_at IS NOT NULL)) OR EXISTS(SELECT 1 FROM public.campaign_inbound_events x WHERE x.organization_id=org AND x.contact_id=ANY(aliases)) THEN reasons:=reasons||'"previously_contacted"'::jsonb;END IF;
  source:=encode(sha256(convert_to(jsonb_build_object('sourceKind','manual_contact','contact',c.contact_revision,'mandate',t.mandate_id,'actor',actor,'creationReceipt',c.creation_receipt)::text,'UTF8')),'hex');
  items:=items||jsonb_build_array(jsonb_build_object('sourceKind','manual_contact','contactId',c.id,'targetId',NULL,'target',NULL,'companyName',coalesce(c.personal_data->>'companyName',''),'name',c.display_name,'email',coalesce(c.personal_data->>'email',''),'sourceRevision',source,'assessment',NULL,'findings','[]'::jsonb,'blockedReasons',reasons,'identityKeys',to_jsonb(ids)));
 END LOOP;
 SELECT count(*) INTO total FROM public.contacts p WHERE p.organization_id=org AND p.mandate_id=t.mandate_id AND p.target_id IS NULL AND p.provenance->>'source'='Manual entry' AND p.provenance->>'createdBy'=actor
 AND EXISTS(SELECT 1 FROM public.audit_events a WHERE a.organization_id=org AND a.actor_id=actor AND a.action='contact.created' AND a.entity_type='contact' AND a.entity_id=p.id::text AND a.metadata->>'mandateId'=t.mandate_id::text AND a.metadata->>'source'='Manual entry');
 PERFORM public.agent_assert_control_scope();
 RETURN jsonb_build_object('mandateRevision',mandate_revision,'responsibilityId',r.id,'responsibilityRevision',r.revision,'brief',m.filters->'brief','candidates',items,'companies',0,'contacts',total);
END $$;
REVOKE ALL ON FUNCTION public.agent_manual_target_snapshot(uuid,uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.agent_manual_target_snapshot(uuid,uuid[]) TO acquire_agent_user;

CREATE FUNCTION public.agent_owned_target_snapshot(p_thread uuid,p_contacts uuid[] DEFAULT NULL) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE researched jsonb;manual jsonb;items jsonb;
BEGIN
 researched:=public.agent_target_snapshot(p_thread,p_contacts);
 manual:=public.agent_manual_target_snapshot(p_thread,p_contacts);
 IF researched->>'mandateRevision' IS DISTINCT FROM manual->>'mandateRevision' OR researched->>'responsibilityId' IS DISTINCT FROM manual->>'responsibilityId' OR researched->>'responsibilityRevision' IS DISTINCT FROM manual->>'responsibilityRevision' THEN RAISE EXCEPTION 'Target context changed during projection'; END IF;
 SELECT coalesce(jsonb_agg(candidate ORDER BY blocked,contact),'[]') INTO items FROM(SELECT candidate,jsonb_array_length(candidate->'blockedReasons')<>0 AS blocked,candidate->>'contactId' AS contact FROM jsonb_array_elements((researched->'candidates')||(manual->'candidates'))candidate ORDER BY blocked,contact LIMIT 50)bounded;
 RETURN researched||jsonb_build_object('candidates',items,'contacts',(researched->>'contacts')::integer+(manual->>'contacts')::integer);
END $$;
REVOKE ALL ON FUNCTION public.agent_owned_target_snapshot(uuid,uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.agent_owned_target_snapshot(uuid,uuid[]) TO acquire_agent_user;

-- Preserve exact approved manifest/delivery checks; only broaden the owned source projection.
CREATE OR REPLACE FUNCTION agent_assert_target_allocation(p_thread uuid,p_operation uuid,p_contact uuid,p_source text,p_mode text,p_binding uuid,p_binding_digest text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE op public.agent_operations%ROWTYPE;snapshot jsonb;candidate jsonb;selected jsonb;
BEGIN
 PERFORM public.agent_assert_control_scope();
 SELECT * INTO op FROM public.agent_operations WHERE id=p_operation AND thread_id=p_thread AND organization_id=current_setting('app.acquire_org',true) AND owner_user_id=current_setting('app.acquire_user',true) AND name='target.select' AND state IN('approved','running');
 IF op.id IS NULL OR NOT EXISTS(SELECT 1 FROM public.agent_review_batches b WHERE b.thread_id=p_thread AND b.state='approved' AND b.manifest @> jsonb_build_array(jsonb_build_object('operationId',op.id,'revision',op.revision,'digest',op.input_digest,'contextRevision',op.input->>'contextRevision'))) THEN RAISE EXCEPTION 'Exact current target approval required'; END IF;
 SELECT item INTO selected FROM jsonb_array_elements(op.input->'selected') item WHERE item->>'contactId'=p_contact::text AND item->>'sourceRevision'=p_source;
 IF selected IS NULL THEN RAISE EXCEPTION 'Contact not in approved selection'; END IF;
 snapshot:=public.agent_owned_target_snapshot(p_thread,ARRAY[p_contact]);
 IF snapshot->>'mandateRevision' IS DISTINCT FROM op.input->>'mandateRevision' OR snapshot->>'responsibilityId' IS DISTINCT FROM op.input->>'responsibilityId' OR snapshot->>'responsibilityRevision' IS DISTINCT FROM op.input->>'responsibilityRevision' THEN RAISE EXCEPTION 'Target supervision changed'; END IF;
 candidate:=snapshot->'candidates'->0;
 IF candidate IS NULL OR candidate->>'sourceRevision' IS DISTINCT FROM p_source OR jsonb_array_length(candidate->'blockedReasons')<>0 THEN RAISE EXCEPTION 'Target contact evidence or ownership needs review'; END IF;
 IF p_mode IS DISTINCT FROM op.input->'delivery'->>'mode' THEN RAISE EXCEPTION 'Approved delivery mode changed'; END IF;
 IF p_mode='communications' THEN
  IF p_binding::text IS DISTINCT FROM op.input->'delivery'->>'bindingId' OR p_binding_digest IS DISTINCT FROM op.input->'delivery'->>'bindingDigest' THEN RAISE EXCEPTION 'Approved email account changed'; END IF;
 ELSIF p_mode<>'local_sink' OR p_binding IS NOT NULL THEN RAISE EXCEPTION 'Explicit delivery mode required'; END IF;
END $$;
REVOKE ALL ON FUNCTION agent_assert_target_allocation(uuid,uuid,uuid,text,text,uuid,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION agent_assert_target_allocation(uuid,uuid,uuid,text,text,uuid,text) TO acquire_agent_user;

-- Operator-entered company names are address context, never researched qualification.
CREATE OR REPLACE FUNCTION agent_public_conversation_facts(conversation uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE org text:=current_setting('app.acquire_org',true);actor text:=current_setting('app.acquire_user',true);result jsonb;metadata text;profile jsonb;buyer jsonb;
BEGIN
 PERFORM public.agent_assert_control_scope();
 SELECT jsonb_build_object('goal',m.natural_language,'contactId',person.id,'contactName',left(person.display_name,300),'companyName',left(COALESCE(company.company_name,CASE WHEN person.target_id IS NULL AND person.provenance->>'source'='Manual entry' THEN person.personal_data->>'companyName' END),300),'companySource',CASE WHEN company.id IS NOT NULL THEN 'saved_company_record' WHEN person.target_id IS NULL AND person.provenance->>'source'='Manual entry' THEN 'operator_entered_unverified' ELSE 'unavailable' END),g.metadata
 INTO result,metadata FROM public.agent_conversations c
 JOIN public.mandates m ON m.id=c.mandate_id AND m.organization_id=c.organization_id
 JOIN public.organization g ON g.id=c.organization_id
 JOIN public.contacts person ON person.id=c.contact_id AND person.organization_id=c.organization_id
 LEFT JOIN public.targets company ON company.id=person.target_id AND company.organization_id=c.organization_id
 WHERE c.id=conversation AND c.organization_id=org AND c.owner_user_id=actor;
 IF result IS NULL THEN RAISE EXCEPTION 'Owned conversation required'; END IF;
 BEGIN profile:=COALESCE(metadata,'{}')::jsonb->'buyerProfile';EXCEPTION WHEN invalid_text_representation THEN profile:=NULL;END;
 -- Public approval is distinct from having saved private buyer financial data.
 -- Copy only this explicit allow-list; never return all organisation metadata.
 IF profile->>'publicProfileApproved'='true' AND length(profile->>'senderName') BETWEEN 2 AND 100 AND length(profile->>'signature') BETWEEN 2 AND 300 THEN
  buyer:=jsonb_strip_nulls(jsonb_build_object('senderName',profile->>'senderName','about',left(COALESCE(profile->>'about',profile->>'background'),1500),'investmentThesis',left(profile->>'investmentThesis',500),'operatingIntent',left(profile->>'operatingIntent',500),'signature',profile->>'signature'));
 END IF;
 RETURN result||jsonb_build_object('buyerProfile',buyer);
END $$;
REVOKE ALL ON FUNCTION agent_public_conversation_facts(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION agent_public_conversation_facts(uuid) TO acquire_agent_user;
