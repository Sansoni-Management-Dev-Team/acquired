-- Native email receipt association is tied to its original recorded route,
-- which need not be the person's primary account. No send authority is added.
ALTER FUNCTION public.agent_communications_receipt_wake(uuid,uuid,text,text,text) RENAME TO agent_communications_receipt_wake_before_channel_routes;
REVOKE ALL ON FUNCTION public.agent_communications_receipt_wake_before_channel_routes(uuid,uuid,text,text,text) FROM PUBLIC,acquire_campaign_user;
CREATE FUNCTION public.agent_communications_receipt_wake(p_binding uuid,p_operation uuid,p_key text,p_payload text,p_evidence text) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE org text:=current_setting('app.acquire_org',true);actor text:=current_setting('app.acquire_user',true);op public.agent_operations%ROWTYPE;conv public.agent_conversations%ROWTYPE;intent public.communication_dispatch_intents%ROWTYPE;wake_key text;payload jsonb;prior public.agent_events%ROWTYPE;route public.agent_conversation_channels%ROWTYPE;
BEGIN
 IF current_setting('role',true)<>'acquire_campaign_user' OR NOT EXISTS(SELECT 1 FROM public.member WHERE organization_id=org AND user_id=actor) OR NOT EXISTS(SELECT 1 FROM public.communication_send_gates WHERE organization_id=org AND writer_xid=txid_current()) THEN RAISE EXCEPTION 'Held current receipt-recovery scope required'; END IF;
 IF p_key IS NULL OR length(p_key) NOT BETWEEN 1 AND 200 OR p_payload IS NULL OR p_payload!~'^[a-f0-9]{64}$' OR p_evidence IS NULL OR p_evidence!~'^[a-f0-9]{64}$' THEN RAISE EXCEPTION 'Verified original association metadata required'; END IF;
 SELECT * INTO op FROM public.agent_operations WHERE id=p_operation AND organization_id=org AND owner_user_id=actor;
 IF op.id IS NOT NULL AND NOT(op.input ? 'routeId') THEN RETURN public.agent_communications_receipt_wake_before_channel_routes(p_binding,p_operation,p_key,p_payload,p_evidence);END IF;
 IF op.id IS NULL OR jsonb_typeof(op.input->'routeId') IS DISTINCT FROM 'string' OR (op.input->>'routeId')!~'^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$' THEN RAISE EXCEPTION 'Original owned routed native intent required';END IF;
 SELECT * INTO route FROM public.agent_conversation_channels WHERE id=(op.input->>'routeId')::uuid AND conversation_id=op.conversation_id AND thread_id=op.thread_id AND organization_id=org AND owner_user_id=actor;
 SELECT * INTO conv FROM public.agent_conversations WHERE id=op.conversation_id AND thread_id=op.thread_id AND organization_id=org AND owner_user_id=actor;
 SELECT * INTO intent FROM public.communication_dispatch_intents WHERE organization_id=org AND owner_user_id=actor AND source_kind='agent' AND source_id=p_operation AND operation_key=p_key AND binding_id=p_binding AND payload_digest=p_payload;
 IF op.id IS NULL OR conv.id IS NULL OR intent.id IS NULL OR op.name NOT IN('email.initial','email.reply','email.follow_up') OR conv.delivery_mode<>'communications' OR intent.operation IS DISTINCT FROM 'message' OR intent.contact_id IS DISTINCT FROM conv.contact_id OR route.id IS NULL OR route.channel IS DISTINCT FROM 'email' OR route.binding_id IS DISTINCT FROM p_binding OR route.binding_digest IS DISTINCT FROM op.input->>'bindingDigest' OR route.binding_digest IS DISTINCT FROM public.agent_recorded_binding_digest(p_binding) OR NOT EXISTS(SELECT 1 FROM public.communication_bindings b WHERE b.id=p_binding AND b.organization_id=org AND b.owner_user_id=actor AND b.application_id='acquire' AND b.channel='email' AND b.backend='unipile' AND b.authority='service') THEN RAISE EXCEPTION 'Original owned routed native intent required'; END IF;
 PERFORM 1 FROM public.agent_threads WHERE id=op.thread_id AND organization_id=org AND owner_user_id=actor FOR UPDATE;
 wake_key:='provider-association:'||intent.id::text;
 payload:=jsonb_build_object('operationId',op.id,'intentId',intent.id,'associationEvidenceDigest',p_evidence);
 SELECT * INTO prior FROM public.agent_events WHERE thread_id=op.thread_id AND agent_events.event_key=wake_key;
 IF prior.id IS NOT NULL THEN
  IF prior.kind<>'email.reconcile' OR prior.payload IS DISTINCT FROM payload THEN RAISE EXCEPTION 'Original association wake changed'; END IF;
  RETURN 0;
 END IF;
 IF op.state NOT IN('running','uncertain') THEN RETURN 0; END IF;
 INSERT INTO public.agent_events(thread_id,organization_id,mandate_id,owner_user_id,event_key,kind,payload,payload_digest)
 VALUES(op.thread_id,org,op.mandate_id,actor,wake_key,'email.reconcile',payload,encode(sha256(convert_to(payload::text,'UTF8')),'hex'));
 RETURN 1;
END $$;
REVOKE ALL ON FUNCTION public.agent_communications_receipt_wake(uuid,uuid,text,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.agent_communications_receipt_wake(uuid,uuid,text,text,text) TO acquire_campaign_user;
