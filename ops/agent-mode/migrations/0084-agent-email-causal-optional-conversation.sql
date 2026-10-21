-- SIM28 forward correction for canonical email history's optional conversation.
-- An absent EMAIL field makes no assertion about the authenticated receipt's
-- provider thread. Present references must be nonempty and exact. All social
-- references remain mandatory. Every other source/identity/authority guard stays.
SET LOCAL statement_timeout='15s';SET LOCAL lock_timeout='5s';
SELECT pg_advisory_xact_lock(1094930773,2901);
DO $target$ BEGIN
 IF current_database()<>'acquire_agent_mode'
 OR (SELECT shobj_description(oid,'pg_database') FROM pg_database WHERE datname=current_database()) IS DISTINCT FROM 'acquire-agent-mode-local-only'
 OR (SELECT system_identifier::text FROM pg_control_system())<>'7697400069962248225'
 OR current_user IS DISTINCT FROM 'project_acquire' THEN RAISE EXCEPTION 'Exact isolated local causal target required';END IF;
END $target$;
DO $predecessors$ BEGIN
 IF (SELECT count(*) FROM public.agent_local_migrations)<>81
 OR (SELECT sha256 FROM public.agent_local_migrations WHERE name='0083-agent-reply-causal-turn.sql') IS DISTINCT FROM 'f93bab239f8a22203f007a64df5d70ca024f30694a7aea356ab43b5f455a5dd9' THEN RAISE EXCEPTION 'Exact installed0083 ledger required';END IF;
 IF (SELECT encode(sha256(convert_to(pg_get_functiondef(oid),'UTF8')),'hex') FROM pg_proc WHERE oid='public.agent_channel_outbound_consumed_turn(uuid,jsonb)'::regprocedure AND pg_get_userbyid(proowner)='project_acquire' AND prosecdef AND proconfig=ARRAY['search_path=pg_catalog, public']::text[] AND proacl::text='{project_acquire=X/project_acquire}') IS DISTINCT FROM '2ffe32193117df7d5114780eb3438f93f5c0d8892de34ac6b901a489a9d2fc5c' THEN RAISE EXCEPTION 'Changed predecessor: original outbound causal reader';END IF;
END $predecessors$;

CREATE OR REPLACE FUNCTION public.agent_channel_outbound_consumed_turn(p_conversation uuid,p_message jsonb) RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE org text:=current_setting('app.acquire_org',true);actor text:=current_setting('app.acquire_user',true);
 c public.agent_conversations%ROWTYPE;r public.agent_conversation_channels%ROWTYPE;o public.agent_operations%ROWTYPE;
 proof jsonb;consumed jsonb;at_time timestamptz;candidate_operations uuid[];parent jsonb;peer jsonb;coverage jsonb;original_proof jsonb;parent_message jsonb;
BEGIN
 IF current_setting('role',true) NOT IN('acquire_agent_user','acquire_campaign_user')
 OR NOT EXISTS(SELECT 1 FROM public.member WHERE organization_id=org AND user_id=actor)
 OR NOT EXISTS(SELECT 1 FROM public.communication_send_gates WHERE organization_id=org AND writer_xid=txid_current()) THEN RAISE EXCEPTION 'Held current causal scope required';END IF;
 SELECT * INTO c FROM public.agent_conversations WHERE id=p_conversation AND organization_id=org AND owner_user_id=actor;
 IF c.id IS NULL OR jsonb_typeof(p_message) IS DISTINCT FROM 'object' OR p_message->>'direction' IS DISTINCT FROM 'outbound'
 OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(c.history) x WHERE x=p_message) THEN RETURN NULL;END IF;
 SELECT * INTO r FROM public.agent_conversation_channels WHERE id::text=p_message->>'routeId' AND conversation_id=c.id AND thread_id=c.thread_id AND organization_id=org AND owner_user_id=actor;
 IF r.id IS NULL OR r.binding_digest IS DISTINCT FROM public.agent_recorded_binding_digest(r.binding_id)
 OR p_message->>'channel' IS DISTINCT FROM r.channel OR p_message->>'bindingDigest' IS DISTINCT FROM r.binding_digest
 OR coalesce(p_message->>'providerMessageId','')='' OR r.channel<>'email' AND coalesce(p_message->>'providerConversationId','')=''
 OR p_message->>'id' IS DISTINCT FROM 'channel-message:'||encode(sha256(convert_to(public.agent_channel_canonical_json(jsonb_build_array(r.binding_digest,p_message->>'providerMessageId')),'UTF8')),'hex')
 OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(r.history) x WHERE x=p_message) THEN RETURN NULL;END IF;
 at_time:=(p_message->>'at')::timestamptz;
 IF at_time IS NULL OR at_time>public.local_simulator_business_now() THEN RETURN NULL;END IF;
 -- The immutable authenticated receipt, its private original permit, the exact
 -- operation result and settled authority/four budgets must all agree.
 SELECT array_agg(op.id) INTO candidate_operations FROM public.agent_operations op
 JOIN public.communication_submission_receipts receipt ON receipt.source_kind='agent' AND receipt.source_id=op.id
 JOIN public.communication_dispatch_intents i ON i.id=receipt.intent_id
 JOIN public.communication_dispatch_permits permit ON permit.intent_id=i.id
 JOIN public.agent_authority_uses a ON a.operation_id=op.id
 WHERE op.conversation_id=c.id AND op.thread_id=c.thread_id AND op.mandate_id=c.mandate_id AND op.organization_id=org AND op.owner_user_id=actor
 AND op.name IN(r.channel||'.initial',r.channel||'.reply',r.channel||'.follow_up') AND op.input->>'kind'=split_part(op.name,'.',2)||'_'||r.channel
 AND op.input->>'routeId'=r.id::text AND op.input->>'bindingDigest'=r.binding_digest AND op.input->>'identityRevision'=r.identity_revision
 AND op.input->>'recipientKey'=r.channel||':'||r.recipient_value
 AND op.input_digest=encode(sha256(convert_to(public.agent_channel_canonical_json(jsonb_build_object('name',op.name,'input',op.input)),'UTF8')),'hex')
 AND op.state='complete' AND op.result->'delivery'->>'status'='submitted'
 AND op.result->'delivery'->>'providerMessageId'=p_message->>'providerMessageId' AND (op.result->'delivery'->>'submittedAt')::timestamptz=at_time AND op.result->'delivery'->>'intentId'=i.id::text
 AND receipt.organization_id=org AND receipt.owner_user_id=actor AND receipt.binding_id=r.binding_id AND receipt.operation='message'
 AND receipt.provider_reference=p_message->>'providerMessageId' AND ((r.channel='email' AND NOT(p_message ? 'providerConversationId')) OR (coalesce(p_message->>'providerConversationId','')<>'' AND receipt.provider_conversation_reference=p_message->>'providerConversationId')) AND receipt.submitted_at=at_time
 AND receipt.origin_status='sealed' AND receipt.origin_conversation_id=c.id AND receipt.origin_mandate_id=c.mandate_id
 AND i.organization_id=org AND i.owner_user_id=actor AND i.binding_id=r.binding_id AND i.contact_id=c.contact_id AND i.source_kind='agent' AND i.source_id=op.id AND i.operation='message'
 AND receipt.operation_key=i.operation_key AND receipt.payload_digest=i.payload_digest AND receipt.source_digest=i.source_digest AND receipt.original_intent_digest=i.intent_digest
 AND NOT EXISTS(SELECT 1 FROM public.communication_intent_resolutions x WHERE x.intent_id=i.id)
 AND a.organization_id=org AND a.owner_user_id=actor AND a.conversation_id=c.id AND a.thread_id=c.thread_id AND a.mandate_id=c.mandate_id AND a.context_revision=op.input->>'contextRevision' AND a.state='settled'
 AND a.operation_revision=op.revision AND a.operation_fence=op.fence AND a.operation_digest=op.input_digest AND a.binding_digest=r.binding_digest AND a.outcome=op.result->'delivery'
 AND (SELECT count(DISTINCT account.scope_key) FROM public.agent_budget_reservations reservation JOIN public.agent_budget_accounts account ON account.id=reservation.account_id AND account.organization_id=reservation.organization_id
 WHERE reservation.operation_id=op.id AND reservation.organization_id=org AND reservation.owner_user_id=actor AND reservation.state='settled' AND reservation.actual=1 AND reservation.amount=1 AND account.unit='sends'
 AND account.scope_key=ANY(ARRAY['organization:sends','user:'||actor||':sends','mandate:'||c.mandate_id::text||':sends','binding:'||r.binding_digest||':sends']))=4;
 IF coalesce(cardinality(candidate_operations),0)<>1 THEN RETURN NULL;END IF;
 SELECT * INTO o FROM public.agent_operations WHERE id=candidate_operations[1];
 IF o.name NOT IN(r.channel||'.initial',r.channel||'.reply') THEN RETURN NULL;END IF;
 IF o.name=r.channel||'.reply' THEN
 proof:=o.input->'replyCausality';consumed:=proof->'consumedInboundHistoryIds';
 IF jsonb_typeof(proof) IS DISTINCT FROM 'object' OR (SELECT count(*) FROM jsonb_object_keys(proof))<>6 OR proof->'version' IS DISTINCT FROM '1'::jsonb
 OR proof->>'historyRevision' IS DISTINCT FROM o.input->>'historyRevision' OR proof->>'routeHistoryRevision' IS DISTINCT FROM o.input->>'routeHistoryRevision'
 OR jsonb_typeof(consumed) IS DISTINCT FROM 'array' OR jsonb_array_length(consumed) NOT BETWEEN 1 AND 200
 OR NOT consumed ? (proof->>'answeredInboundHistoryId') OR (proof->>'inboundAt')::timestamptz>at_time
 OR consumed IS DISTINCT FROM (SELECT jsonb_agg(v ORDER BY v COLLATE "C") FROM(SELECT DISTINCT jsonb_array_elements_text(consumed) v)s)
 OR EXISTS(SELECT 1 FROM jsonb_array_elements(consumed) x WHERE jsonb_typeof(x)<>'string' OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(c.history) m WHERE m->>'id'=x#>>'{}' AND m->>'direction'='inbound' AND (m->>'at')::timestamptz=(proof->>'inboundAt')::timestamptz)) THEN RETURN NULL;END IF;
 -- The original insertion trigger authenticated the complete snapshot; this
 -- read must still find its exact selected route parent, never a hash fallback.
 SELECT value INTO parent_message FROM jsonb_array_elements(r.history) WHERE value->>'id'=proof->>'answeredInboundHistoryId' AND value->>'direction'='inbound' AND (value->>'at')::timestamptz=(proof->>'inboundAt')::timestamptz;
 IF parent_message IS NULL THEN RETURN NULL;END IF;
 IF r.channel='email' THEN parent:=jsonb_build_object('id',coalesce(parent_message->>'providerMessageId',parent_message->>'id'),'contentDigest',encode(sha256(convert_to(coalesce(parent_message->>'subject','')||E'\n'||(parent_message->>'text'),'UTF8')),'hex'));
 ELSE IF coalesce(parent_message->>'providerConversationId','')='' THEN RETURN NULL;END IF;peer:=jsonb_build_object('id',parent_message->>'providerConversationId');END IF;
 ELSE consumed:='[]'::jsonb;END IF;
 SELECT jsonb_agg(jsonb_build_object('bindingId',x.binding_id,'channel',x.channel,'recipient',jsonb_build_object('kind',x.recipient_kind,'value',x.recipient_value)) ORDER BY x.channel) INTO coverage FROM public.agent_conversation_channels x WHERE x.conversation_id=c.id;
 original_proof:=jsonb_build_object('routeId',r.id,'channel',r.channel,'contactId',c.contact_id,'recipient',jsonb_build_object('kind',r.recipient_kind,'value',r.recipient_value),'subject',o.input->>'subject','body',o.input->>'body','contextDigest',o.input_digest,'requiredSince','1970-01-01T00:00:00.000Z','replyParent',parent,'conversation',peer,'coverageRoutes',coverage);
 IF NOT EXISTS(SELECT 1 FROM public.communication_submission_receipts receipt WHERE receipt.intent_id::text=o.result->'delivery'->>'intentId' AND receipt.source_id=o.id
 AND receipt.source_digest=encode(sha256(convert_to(public.agent_channel_canonical_json(jsonb_build_object('source',jsonb_build_object('kind','agent','operationId',o.id,'conversationId',c.id,'epoch',(o.input->>'epoch')::bigint,'fence',o.fence::text),'proof',original_proof)),'UTF8')),'hex')) THEN RETURN NULL;END IF;
 RETURN consumed;
EXCEPTION WHEN invalid_text_representation OR datetime_field_overflow OR invalid_datetime_format THEN RETURN NULL;
END $$;
