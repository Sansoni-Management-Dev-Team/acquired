-- Service message metadata becomes a durable wake inside the SAME application
-- receipt transaction, before service ACK. Bodies stay in trusted history reads.
CREATE FUNCTION public.agent_communications_change(p_binding uuid,p_event text,p_receipt_fingerprint text,p_change_fingerprint text,p_sender text,p_message text,p_occurred timestamptz,p_review boolean) RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE org text:=current_setting('app.acquire_org',true);actor text:=current_setting('app.acquire_user',true);candidate record;conv public.agent_conversations%ROWTYPE;incoming_key text;notice jsonb;payload jsonb;affected integer:=0;
BEGIN
 IF current_setting('role',true)<>'acquire_campaign_user' OR NOT EXISTS(SELECT 1 FROM public.member WHERE organization_id=org AND user_id=actor) OR NOT EXISTS(SELECT 1 FROM public.communication_send_gates WHERE organization_id=org AND writer_xid=txid_current()) THEN RAISE EXCEPTION 'Held current incoming-message scope required'; END IF;
 IF p_event IS NULL OR p_receipt_fingerprint IS NULL OR p_change_fingerprint IS NULL OR p_sender IS NULL OR p_message IS NULL OR length(p_event) NOT BETWEEN 1 AND 200 OR p_receipt_fingerprint!~'^[a-f0-9]{64}$' OR p_change_fingerprint!~'^[a-f0-9]{64}$' OR p_sender IS DISTINCT FROM lower(btrim(p_sender)) OR p_sender!~'^[^[:space:]<>@]+@[^[:space:]<>@]+[.][^[:space:]<>@]+$' OR length(p_message) NOT BETWEEN 1 AND 2048 OR p_occurred IS NULL OR p_occurred>clock_timestamp()+interval '1 minute' OR p_review IS NULL THEN RAISE EXCEPTION 'Verified incoming metadata required'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.communication_bindings b WHERE b.id=p_binding AND b.organization_id=org AND b.owner_user_id=actor AND b.application_id='acquire' AND b.channel='email' AND b.backend='unipile' AND b.authority='service') THEN RAISE EXCEPTION 'Original owned email account required'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.communication_event_receipts r WHERE r.binding_id=p_binding AND r.service_event_id=p_event AND r.organization_id=org AND r.owner_user_id=actor AND r.event_type='message' AND r.payload_fingerprint=p_receipt_fingerprint) OR (p_receipt_fingerprint<>p_change_fingerprint AND NOT p_review) THEN RAISE EXCEPTION 'Committed-in-this-transaction application receipt required'; END IF;
 incoming_key:='incoming-email:'||encode(sha256(convert_to(jsonb_build_array(p_binding,p_event,p_change_fingerprint)::text,'UTF8')),'hex');
 IF (SELECT count(*) FROM public.agent_conversations c WHERE c.organization_id=org AND c.owner_user_id=actor AND c.delivery_mode='communications' AND c.binding_id=p_binding AND c.recipient_email=p_sender)>100 THEN RAISE EXCEPTION 'Incoming conversation bound exceeded'; END IF;
 FOR candidate IN SELECT id,thread_id FROM public.agent_conversations c WHERE c.organization_id=org AND c.owner_user_id=actor AND c.delivery_mode='communications' AND c.binding_id=p_binding AND c.recipient_email=p_sender ORDER BY thread_id,id LOOP
  PERFORM 1 FROM public.agent_threads WHERE id=candidate.thread_id AND organization_id=org AND owner_user_id=actor FOR UPDATE;
  SELECT * INTO STRICT conv FROM public.agent_conversations WHERE id=candidate.id FOR UPDATE;
  IF EXISTS(SELECT 1 FROM public.agent_events e WHERE e.thread_id=conv.thread_id AND e.event_key=incoming_key) THEN CONTINUE; END IF;
  -- Never fabricate a body or certify complete history from webhook metadata.
  UPDATE public.agent_conversations SET history_complete=false,epoch=epoch+1,revision=revision+1,reminder_generation=reminder_generation+1,next_wakeup_at=NULL,
   phase=CASE WHEN p_review AND driver_kind='agent' AND phase='active' THEN 'held' ELSE phase END,
   pause_reason=CASE WHEN driver_kind<>'agent' OR phase<>'active' THEN pause_reason WHEN p_review THEN 'incoming_email_review_required' ELSE 'provider_history_changed' END,updated_at=clock_timestamp()
  WHERE id=conv.id;
  UPDATE public.agent_operations SET state='failed',result=jsonb_build_object('reason','context_changed'),updated_at=clock_timestamp() WHERE conversation_id=conv.id AND thread_id=conv.thread_id AND name IN('email.initial','email.reply','email.follow_up') AND state IN('proposed','approved');
  UPDATE public.agent_review_batches b SET state='invalidated' WHERE b.thread_id=conv.thread_id AND b.state='pending' AND EXISTS(SELECT 1 FROM jsonb_array_elements(b.manifest) item JOIN public.agent_operations o ON o.id::text=(item->>'operationId') WHERE o.conversation_id=conv.id AND o.thread_id=conv.thread_id AND o.name IN('email.initial','email.reply','email.follow_up') AND o.state='failed' AND o.result->>'reason'='context_changed');
  -- Source/context is immutable; bump only the task revision. Conversation epoch
  -- also invalidates every older handoff context token, including retired assignees.
  UPDATE public.agent_handoffs h SET revision=revision+1,updated_at=clock_timestamp() WHERE h.conversation_id=conv.id AND h.state IN('pending','acknowledged','link_sent') AND EXISTS(SELECT 1 FROM public.member m WHERE m.organization_id=org AND m.user_id=h.assignee_user_id);
  payload:=jsonb_build_object('conversationId',conv.id);
  INSERT INTO public.agent_events(thread_id,organization_id,mandate_id,owner_user_id,event_key,kind,payload,payload_digest)
  VALUES(conv.thread_id,org,conv.mandate_id,actor,incoming_key,'conversation.history_changed',payload,encode(sha256(convert_to(payload::text,'UTF8')),'hex'));
  notice:=jsonb_build_object('text',CASE WHEN p_review THEN 'A new email needs human review. Automation remains paused.' WHEN conv.phase='complete' THEN 'A new email arrived on a stopped conversation. Automation remains stopped.' WHEN conv.driver_kind<>'agent' OR conv.phase<>'active' THEN 'A new email arrived for a conversation you are handling. Automation remains paused.' ELSE 'A new email arrived. I am checking the full conversation before deciding what to do next.' END,'details',jsonb_build_object('conversationId',conv.id,'serviceEventId',p_event,'providerMessageId',p_message,'occurredAt',p_occurred,'reviewRequired',p_review));
  INSERT INTO public.agent_messages(thread_id,organization_id,mandate_id,owner_user_id,request_key,role,content,content_digest)
  VALUES(conv.thread_id,org,conv.mandate_id,actor,incoming_key,'assistant',notice,encode(sha256(convert_to(jsonb_build_object('role','assistant','content',notice)::text,'UTF8')),'hex'));
  INSERT INTO public.audit_events(organization_id,actor_id,action,entity_type,entity_id,metadata) VALUES(org,actor,'agent.incoming_email','agent_conversation',conv.id::text,jsonb_build_object('serviceEventId',p_event,'reviewRequired',p_review));
  affected:=affected+1;
 END LOOP;
 RETURN affected;
END $$;
REVOKE ALL ON FUNCTION public.agent_communications_change(uuid,text,text,text,text,text,timestamptz,boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.agent_communications_change(uuid,text,text,text,text,text,timestamptz,boolean) TO acquire_campaign_user;
