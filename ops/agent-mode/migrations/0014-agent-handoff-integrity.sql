-- Bound task evidence and use content-derived immutable audit payload digests.
CREATE OR REPLACE FUNCTION agent_control_handoff(p_mandate uuid,p_key uuid,p_input jsonb,p_digest text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE org text:=current_setting('app.acquire_org',true);actor text:=current_setting('app.acquire_user',true);
 task public.agent_handoffs%ROWTYPE;conv public.agent_conversations%ROWTYPE;prior public.agent_operations%ROWTYPE;op uuid;new_revision integer;action text:=p_input->>'action';next_state text;receipt jsonb;notice jsonb;proof jsonb;request text:='handoff:'||actor||':'||p_key::text;
BEGIN
 PERFORM public.agent_assert_control_scope();
 IF p_digest!~'^[a-f0-9]{64}$' OR octet_length(p_input::text)>6000 THEN RAISE EXCEPTION 'Invalid task command'; END IF;
 SELECT * INTO task FROM public.agent_handoffs h WHERE h.id=(p_input->>'taskId')::uuid AND h.organization_id=org AND h.mandate_id=p_mandate AND (h.owner_user_id=actor OR h.assignee_user_id=actor);
 IF task.id IS NULL OR NOT EXISTS(SELECT 1 FROM public.member WHERE organization_id=org AND user_id=task.owner_user_id) THEN RAISE EXCEPTION 'Task unavailable'; END IF;
 -- Same lock order as ordinary owner commands; serialises owner and assignee.
 PERFORM 1 FROM public.agent_threads WHERE id=task.thread_id FOR UPDATE;
 SELECT * INTO task FROM public.agent_handoffs WHERE id=task.id FOR UPDATE;
 IF actor<>task.owner_user_id AND actor<>task.assignee_user_id THEN RAISE EXCEPTION 'Task assignment changed'; END IF;
 SELECT * INTO prior FROM public.agent_operations WHERE thread_id=task.thread_id AND request_key=request;
 IF prior.id IS NOT NULL THEN
  IF prior.input_digest<>p_digest OR prior.input IS DISTINCT FROM p_input OR prior.state<>'complete' THEN RAISE EXCEPTION 'Task command key reused'; END IF;
  RETURN prior.result;
 END IF;
 SELECT * INTO conv FROM public.agent_conversations WHERE id=task.conversation_id FOR UPDATE;
 IF task.revision<>(p_input->>'revision')::integer OR public.agent_handoff_context(task.id) IS DISTINCT FROM p_input->>'contextRevision' THEN RAISE EXCEPTION 'Task or conversation changed'; END IF;
 IF task.state IN('dismissed','meeting_confirmed') THEN RAISE EXCEPTION 'Task already closed'; END IF;
 IF jsonb_array_length(coalesce(task.human_evidence->'events','[]'::jsonb))>=100 OR octet_length(task.human_evidence::text)+octet_length(p_input::text)>58000 THEN RAISE EXCEPTION 'Task evidence limit reached; manual review required'; END IF;
 next_state:=task.state;
 IF action='acknowledge' THEN
  IF task.state<>'pending' THEN RAISE EXCEPTION 'Task is not pending'; END IF;next_state:='acknowledged';
 ELSIF action='reassign' THEN
  IF actor<>task.owner_user_id OR coalesce(length(p_input->>'assigneeUserId'),0) NOT BETWEEN 1 AND 200 OR NOT EXISTS(SELECT 1 FROM public.member WHERE organization_id=org AND user_id=p_input->>'assigneeUserId') THEN RAISE EXCEPTION 'Current member assignment requires owner'; END IF;
  IF task.assignee_user_id=p_input->>'assigneeUserId' THEN RAISE EXCEPTION 'Task already assigned'; END IF;
 ELSIF action='dismiss' THEN
  IF coalesce(length(trim(p_input->>'reason')),0) NOT BETWEEN 5 AND 2000 THEN RAISE EXCEPTION 'Dismissal reason required'; END IF;next_state:='dismissed';
 ELSIF action IN('link_sent','meeting_confirmed') THEN
  proof:=p_input->'evidence';
  IF jsonb_typeof(proof)<>'object' OR coalesce(length(trim(proof->>'note')),0) NOT BETWEEN 5 AND 2000 OR coalesce(length(trim(proof->>'externalReference')),0) NOT BETWEEN 3 AND 1000 OR (proof->>'occurredAt') IS NULL OR (proof->>'occurredAt')::timestamptz>clock_timestamp()+interval '1 minute' THEN RAISE EXCEPTION 'Past external evidence required'; END IF;
  IF action='link_sent' AND (task.state NOT IN('pending','acknowledged') OR conv.driver_kind<>'human' OR conv.phase<>'paused' OR conv.engagement<>'handoff') THEN RAISE EXCEPTION 'Booking-link record unavailable for current conversation'; END IF;
  IF action='meeting_confirmed' AND task.state<>'link_sent' THEN RAISE EXCEPTION 'Link sent is not a confirmed meeting'; END IF;
  next_state:=action;
 ELSE RAISE EXCEPTION 'Invalid task action';END IF;
 INSERT INTO public.agent_operations(thread_id,organization_id,mandate_id,owner_user_id,request_key,name,input,input_digest,state)
 VALUES(task.thread_id,org,p_mandate,task.owner_user_id,request,'human.handoff.'||action,p_input,p_digest,'running') RETURNING id INTO op;
 proof:=jsonb_build_object('action',action,'actorId',actor,'recordedAt',clock_timestamp(),'evidence',p_input->'evidence','reason',p_input->'reason','previousAssignee',task.assignee_user_id);
 UPDATE public.agent_handoffs SET state=next_state,assignee_user_id=CASE WHEN action='reassign' THEN p_input->>'assigneeUserId' ELSE assignee_user_id END,
  revision=revision+1,human_evidence=jsonb_set(human_evidence,'{events}',coalesce(human_evidence->'events','[]'::jsonb)||jsonb_build_array(proof)),updated_at=clock_timestamp()
 WHERE id=task.id RETURNING revision INTO new_revision;
 receipt:=jsonb_build_object('id',task.id,'revision',new_revision,'status',next_state);
 UPDATE public.agent_operations SET state='complete',result=receipt,updated_at=clock_timestamp() WHERE id=op;
 INSERT INTO public.audit_events(organization_id,actor_id,action,entity_type,entity_id,metadata)
 VALUES(org,actor,'agent.handoff.'||action,'agent_handoff',task.id::text,jsonb_build_object('revision',new_revision,'commandId',op,'previousState',task.state,'state',next_state));
 notice:=jsonb_build_object('text',CASE action WHEN 'acknowledge' THEN 'The human handoff was acknowledged.' WHEN 'reassign' THEN 'The human handoff was reassigned.' WHEN 'dismiss' THEN 'The human handoff was dismissed. Automation remains paused.' WHEN 'link_sent' THEN 'A human recorded sending the booking link externally. This does not confirm a meeting. Automation remains paused.' ELSE 'A human recorded a confirmed meeting with external evidence. Automation remains paused.' END,'details',receipt||jsonb_build_object('actorId',actor));
 INSERT INTO public.agent_messages(thread_id,organization_id,mandate_id,owner_user_id,request_key,role,content,content_digest)
 VALUES(task.thread_id,org,p_mandate,task.owner_user_id,'handoff-notice:'||op,'assistant',notice,encode(sha256(convert_to(jsonb_build_object('role','assistant','content',notice)::text,'UTF8')),'hex'));
 INSERT INTO public.agent_events(thread_id,organization_id,mandate_id,owner_user_id,event_key,kind,payload,payload_digest)
 VALUES(task.thread_id,org,p_mandate,task.owner_user_id,'handoff-control:'||op,'human.handoff_updated',receipt,encode(sha256(convert_to(receipt::text,'UTF8')),'hex'));
 RETURN receipt;
END $$;
REVOKE ALL ON FUNCTION agent_control_handoff(uuid,uuid,jsonb,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION agent_control_handoff(uuid,uuid,jsonb,text) TO acquire_agent_user;
