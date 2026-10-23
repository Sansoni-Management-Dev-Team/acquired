-- Isolated local worktree migration, authorised by the user's local blanket
-- approval. Existing applied artifacts remain immutable. No provider execution.
CREATE FUNCTION agent_public_conversation_facts(conversation uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE org text:=current_setting('app.acquire_org',true);actor text:=current_setting('app.acquire_user',true);result jsonb;metadata text;profile jsonb;buyer jsonb;
BEGIN
 PERFORM public.agent_assert_control_scope();
 SELECT jsonb_build_object('goal',m.natural_language,'contactId',person.id,'contactName',left(person.display_name,300),'companyName',left(company.company_name,300)),g.metadata
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
