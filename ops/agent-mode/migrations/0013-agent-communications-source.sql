-- Native conversations join the existing durable communications admission
-- journal; original UI campaign/draft rules and reply holds are unchanged.
ALTER TABLE public.communication_dispatch_intents DROP CONSTRAINT communication_dispatch_intents_source_kind_check;
ALTER TABLE public.communication_dispatch_intents ADD CONSTRAINT communication_dispatch_intents_source_kind_check CHECK(source_kind IN('campaign','draft','agent'));
CREATE FUNCTION public.agent_communications_source(operation uuid,conversation uuid,expected_epoch bigint,expected_fence bigint,binding uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE org text:=current_setting('app.acquire_org',true);actor text:=current_setting('app.acquire_user',true);op public.agent_operations%ROWTYPE;conv public.agent_conversations%ROWTYPE;
BEGIN
 IF current_setting('role',true)<>'acquire_campaign_user'
 OR NOT EXISTS(SELECT 1 FROM public.member WHERE organization_id=org AND user_id=actor)
 OR NOT EXISTS(SELECT 1 FROM public.communication_send_gates WHERE organization_id=org AND writer_xid=txid_current()) THEN RAISE EXCEPTION 'Held current application authority required'; END IF;
 SELECT * INTO op FROM public.agent_operations WHERE id=operation AND organization_id=org AND owner_user_id=actor;
 SELECT * INTO conv FROM public.agent_conversations WHERE id=conversation AND organization_id=org AND owner_user_id=actor;
 IF op.id IS NULL OR conv.id IS NULL OR op.conversation_id<>conv.id OR op.fence<>expected_fence OR conv.epoch<>expected_epoch
 OR op.name NOT IN('email.initial','email.reply','email.follow_up') OR conv.delivery_mode<>'communications' OR conv.history_source<>'communications'
 OR conv.binding_id IS DISTINCT FROM binding OR NOT EXISTS(SELECT 1 FROM public.communication_bindings b WHERE b.id=binding AND b.organization_id=org AND b.owner_user_id=actor AND b.application_id='acquire' AND b.backend='unipile' AND b.authority='service' AND b.channel='email')
 OR NOT public.agent_operation_authorised(operation) THEN RETURN NULL; END IF;
 -- The generic native admission historically needed one reservation. Actual
 -- communications dispatch additionally requires all three exact send scopes.
 IF (SELECT count(DISTINCT a.scope_key) FROM public.agent_budget_reservations r JOIN public.agent_budget_accounts a ON a.id=r.account_id AND a.organization_id=r.organization_id WHERE r.operation_id=operation AND r.organization_id=org AND r.state='reserved' AND r.amount=1 AND a.unit='sends' AND a.scope_key=ANY(ARRAY['organization:sends','user:'||actor||':sends','mandate:'||conv.mandate_id::text||':sends']) AND a.window_start<=clock_timestamp() AND a.window_end>clock_timestamp() AND a.spent+a.reserved<=a.cap)<>3 THEN RETURN NULL; END IF;
 RETURN jsonb_build_object('contactId',conv.contact_id,'recipient',conv.recipient_email,'subject',op.input->>'subject','body',op.input->>'body','contextDigest',op.input_digest,'requiredSince',to_char(LEAST('1970-01-01T00:00:00Z'::timestamptz,COALESCE((SELECT min((item->>'since')::timestamptz) FROM jsonb_array_elements(conv.coverage_bindings) item WHERE item->>'bindingId'=binding::text AND item->>'channel'='email'),'1970-01-01T00:00:00Z'::timestamptz)) AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'));
END $$;
REVOKE ALL ON FUNCTION public.agent_communications_source(uuid,uuid,bigint,bigint,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.agent_communications_source(uuid,uuid,bigint,bigint,uuid) TO acquire_campaign_user;
CREATE FUNCTION public.agent_communications_intent_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE op public.agent_operations%ROWTYPE;proof jsonb;
BEGIN
 IF NEW.source_kind<>'agent' THEN RETURN NEW; END IF;
 SELECT * INTO op FROM public.agent_operations WHERE id=NEW.source_id AND organization_id=NEW.organization_id AND owner_user_id=NEW.owner_user_id;
 IF op.id IS NULL THEN RAISE EXCEPTION 'Current native source required'; END IF;
 proof:=public.agent_communications_source(op.id,op.conversation_id,(op.input->>'epoch')::bigint,op.fence,NEW.binding_id);
 IF proof IS NULL OR proof->>'contactId' IS DISTINCT FROM NEW.contact_id::text OR NEW.operation<>'message' THEN RAISE EXCEPTION 'Current native source required'; END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.agent_communications_intent_guard() FROM PUBLIC;
CREATE TRIGGER agent_communications_intent_admission BEFORE INSERT ON public.communication_dispatch_intents FOR EACH ROW EXECUTE FUNCTION public.agent_communications_intent_guard();
