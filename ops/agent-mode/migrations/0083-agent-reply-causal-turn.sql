-- SIM28 generic causal ordering for verified equal-time reply histories.
-- No table columns/data/backfill; legacy clients keep strict timestamp behavior.
-- Future server snapshots are immutable and validated before ordinary review.
SET LOCAL statement_timeout='15s';SET LOCAL lock_timeout='5s';
SELECT pg_advisory_xact_lock(1094930773,2901);
DO $target$ BEGIN
 IF current_database()<>'acquire_agent_mode'
 OR (SELECT shobj_description(oid,'pg_database') FROM pg_database WHERE datname=current_database()) IS DISTINCT FROM 'acquire-agent-mode-local-only'
 OR (SELECT system_identifier::text FROM pg_control_system())<>'7697400069962248225'
 OR to_regprocedure('public.local_simulator_business_now()') IS NULL THEN RAISE EXCEPTION 'Exact isolated local causal target required';END IF;
END $target$;
-- Match CREATE TRIGGER's table lock before checking historical provenance;
-- concurrent old writers cannot insert an unverified property in the gap.
LOCK TABLE public.agent_operations IN SHARE ROW EXCLUSIVE MODE;
DO $predecessors$ BEGIN
 IF current_user IS DISTINCT FROM 'project_acquire' OR NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname=current_user AND (rolsuper OR rolbypassrls)) OR (SELECT pg_get_userbyid(relowner) FROM pg_class WHERE oid='public.agent_operations'::regclass) IS DISTINCT FROM current_user THEN RAISE EXCEPTION 'Exact causal migration owner visibility required';END IF;
 IF (SELECT count(*) FROM public.agent_local_migrations)<>80
 OR (SELECT sha256 FROM public.agent_local_migrations WHERE name='0080-agent-local-business-clock.sql') IS DISTINCT FROM 'f9b2947a2111014fc720be776d3920d4f04881e403bfcc9dacef4fa1255afebd'
 OR (SELECT sha256 FROM public.agent_local_migrations WHERE name='0081-agent-local-business-consumers.sql') IS DISTINCT FROM 'a560cb8cc14d6ed4dbbcbdcba3443a37f07af03e8d767407e217547a85b29797'
 OR (SELECT sha256 FROM public.agent_local_migrations WHERE name='0082-agent-local-submission-business-clock.sql') IS DISTINCT FROM '08d8192f3f514d70e7209d8caee8c4be556a616cfe23b8a62b91b5c0e76ca404' THEN RAISE EXCEPTION 'Exact installed0080/0081/0082 ledger required';END IF;
 IF (SELECT encode(sha256(convert_to(pg_get_functiondef(oid),'UTF8')),'hex') FROM pg_proc WHERE oid='public.agent_channel_proposal_before_invitations(uuid,text)'::regprocedure AND pg_get_userbyid(proowner)='project_acquire' AND prosecdef AND proconfig=ARRAY['search_path=pg_catalog, public']::text[] AND proacl::text='{project_acquire=X/project_acquire}') IS DISTINCT FROM '656699385b6afd4d5fdf82113bc0f0cce2ac118147b7a2048c56c7bb78aa3f58' THEN RAISE EXCEPTION 'Changed predecessor: proposal causal consumer';END IF;
 IF (SELECT encode(sha256(convert_to(pg_get_functiondef(oid),'UTF8')),'hex') FROM pg_proc WHERE oid='public.agent_channel_operation_before_invitations(uuid)'::regprocedure AND pg_get_userbyid(proowner)='project_acquire' AND prosecdef AND proconfig=ARRAY['search_path=pg_catalog, public']::text[] AND proacl::text='{project_acquire=X/project_acquire}') IS DISTINCT FROM '60e12d9c6d79bf839920cced7b6a974832df17dc29a8f14575697031a6fb1edd' THEN RAISE EXCEPTION 'Changed predecessor: admission causal consumer';END IF;
 IF (SELECT encode(sha256(convert_to(pg_get_functiondef(oid),'UTF8')),'hex') FROM pg_proc WHERE oid='public.agent_channel_source_before_invitations(uuid,uuid,bigint,bigint,uuid)'::regprocedure AND pg_get_userbyid(proowner)='project_acquire' AND prosecdef AND proconfig=ARRAY['search_path=pg_catalog, public']::text[] AND proacl::text='{project_acquire=X/project_acquire}') IS DISTINCT FROM 'd7acc0865eb870869999e2f2d4ac0641aed90a5a4a8db4cdf1a4a5e7db0b5fef' THEN RAISE EXCEPTION 'Changed predecessor: original reply parent consumer';END IF;
 IF EXISTS(SELECT 1 FROM public.agent_operations WHERE input ? 'replyCausality') THEN RAISE EXCEPTION 'Preexisting unverified causal metadata requires review';END IF;
 IF to_regprocedure('public.agent_channel_reply_causality(uuid)') IS NOT NULL OR to_regprocedure('public.agent_channel_outbound_consumed_turn(uuid,jsonb)') IS NOT NULL OR to_regprocedure('public.agent_reply_causality_guard()') IS NOT NULL
 OR EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='public.agent_operations'::regclass AND tgname='agent_01_reply_causality') THEN RAISE EXCEPTION 'Causal extension already exists outside ledger';END IF;
END $predecessors$;

-- NULL means unproven, never an empty consumed turn. This function authenticates
-- every tied outbound separately; provider/hash ordering cannot select a winner.
CREATE FUNCTION public.agent_channel_outbound_consumed_turn(p_conversation uuid,p_message jsonb) RETURNS jsonb
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
 AND receipt.provider_reference=p_message->>'providerMessageId' AND receipt.provider_conversation_reference IS NOT DISTINCT FROM nullif(p_message->>'providerConversationId','') AND receipt.submitted_at=at_time
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
REVOKE ALL ON FUNCTION public.agent_channel_outbound_consumed_turn(uuid,jsonb) FROM PUBLIC;

-- One protected snapshot for the model projection, original proposal and final
-- admission. Compute the GLOBAL latest turn first, never fallback to older work.
CREATE FUNCTION public.agent_channel_reply_causality(p_route uuid) RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE org text:=current_setting('app.acquire_org',true);actor text:=current_setting('app.acquire_user',true);
 r public.agent_conversation_channels%ROWTYPE;c public.agent_conversations%ROWTYPE;m jsonb;outbound jsonb;ids jsonb;consumed jsonb:='[]';turn jsonb;candidate jsonb;latest timestamptz;candidate_count integer;
BEGIN
 IF current_setting('role',true) NOT IN('acquire_agent_user','acquire_campaign_user')
 OR NOT EXISTS(SELECT 1 FROM public.member WHERE organization_id=org AND user_id=actor)
 OR NOT EXISTS(SELECT 1 FROM public.communication_send_gates WHERE organization_id=org AND writer_xid=txid_current()) THEN RAISE EXCEPTION 'Held current causal scope required';END IF;
 SELECT * INTO r FROM public.agent_conversation_channels WHERE id=p_route AND organization_id=org AND owner_user_id=actor;
 SELECT * INTO c FROM public.agent_conversations WHERE id=r.conversation_id AND thread_id=r.thread_id AND organization_id=org AND owner_user_id=actor FOR UPDATE;
 IF r.id IS NULL OR c.id IS NULL OR c.history_source<>'communications' OR NOT c.history_complete OR NOT r.history_complete
 OR c.history_observed_at IS NULL OR c.history_observed_at NOT BETWEEN public.local_simulator_business_now()-interval '5 minutes' AND public.local_simulator_business_now()
 OR EXISTS(SELECT 1 FROM public.agent_conversation_channels x WHERE x.conversation_id=c.id AND (NOT x.history_complete OR x.history_observed_at IS NULL OR x.history_observed_at NOT BETWEEN public.local_simulator_business_now()-interval '5 minutes' AND public.local_simulator_business_now())) THEN RETURN NULL;END IF;
 SELECT max((x->>'at')::timestamptz) INTO latest FROM jsonb_array_elements(c.history) x WHERE x->>'direction'='inbound';
 IF latest IS NULL OR latest>public.local_simulator_business_now() OR EXISTS(SELECT 1 FROM jsonb_array_elements(c.history) x WHERE x->>'direction'='outbound' AND (x->>'at')::timestamptz>latest) THEN RETURN NULL;END IF;
 SELECT jsonb_agg(x->>'id' ORDER BY (x->>'id') COLLATE "C") INTO turn FROM jsonb_array_elements(c.history) x WHERE x->>'direction'='inbound' AND (x->>'at')::timestamptz=latest;
 -- Every member of the turn must retain its exact original verified route.
 FOR m IN SELECT value FROM jsonb_array_elements(c.history) WHERE value->>'direction'='inbound' AND (value->>'at')::timestamptz=latest LOOP
  IF NOT EXISTS(SELECT 1 FROM public.agent_conversation_channels x WHERE x.conversation_id=c.id AND x.thread_id=c.thread_id AND x.organization_id=org AND x.owner_user_id=actor
   AND x.binding_digest=public.agent_recorded_binding_digest(x.binding_id)
   AND (CASE WHEN m->>'routeId' IS NULL THEN x.channel='email' AND x.binding_id=c.binding_id AND coalesce(m->>'channel','email')='email' ELSE m->>'routeId'=x.id::text AND m->>'channel'=x.channel AND m->>'bindingDigest'=x.binding_digest END)
   AND EXISTS(SELECT 1 FROM jsonb_array_elements(x.history) h WHERE h=m)) THEN RETURN NULL;END IF;
 END LOOP;
 FOR outbound IN SELECT value FROM jsonb_array_elements(c.history) WHERE value->>'direction'='outbound' AND (value->>'at')::timestamptz=latest LOOP
  ids:=public.agent_channel_outbound_consumed_turn(c.id,outbound);
  IF ids IS NULL THEN RETURN NULL;END IF;
  consumed:=consumed||ids;
 END LOOP;
 SELECT count(*) INTO candidate_count FROM jsonb_array_elements(r.history) x WHERE x->>'direction'='inbound' AND (x->>'at')::timestamptz=latest AND NOT consumed ? (x->>'id') AND EXISTS(SELECT 1 FROM jsonb_array_elements(c.history) h WHERE h=x);
 IF candidate_count<>1 THEN RETURN NULL;END IF;
 SELECT value INTO candidate FROM jsonb_array_elements(r.history) WHERE value->>'direction'='inbound' AND (value->>'at')::timestamptz=latest AND NOT consumed ? (value->>'id') AND EXISTS(SELECT 1 FROM jsonb_array_elements(c.history) h WHERE h=value);
 IF (CASE WHEN candidate->>'routeId' IS NULL THEN r.channel<>'email' OR r.binding_id<>c.binding_id OR coalesce(candidate->>'channel','email')<>'email' ELSE candidate->>'routeId' IS DISTINCT FROM r.id::text OR candidate->>'channel' IS DISTINCT FROM r.channel OR candidate->>'bindingDigest' IS DISTINCT FROM r.binding_digest END) THEN RETURN NULL;END IF;
 RETURN jsonb_build_object('version',1,'answeredInboundHistoryId',candidate->>'id','consumedInboundHistoryIds',turn,'historyRevision',c.history_revision,'routeHistoryRevision',r.history_revision,'inboundAt',candidate->>'at');
EXCEPTION WHEN invalid_text_representation OR datetime_field_overflow OR invalid_datetime_format THEN RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION public.agent_channel_reply_causality(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.agent_channel_reply_causality(uuid) TO acquire_agent_user,acquire_campaign_user;

-- Optional for old clients. An existing legacy operation can never be retrofitted
-- with causal evidence. Receipt/result updates do NOT reload historical context.
CREATE FUNCTION public.agent_reply_causality_guard() RETURNS trigger
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE c public.agent_conversations%ROWTYPE;r public.agent_conversation_channels%ROWTYPE;expected jsonb;
BEGIN
 IF TG_OP='UPDATE' THEN
  IF NEW.input->'replyCausality' IS DISTINCT FROM OLD.input->'replyCausality' THEN RAISE EXCEPTION 'Original reply causal snapshot is immutable';END IF;
  IF NOT OLD.input ? 'replyCausality' THEN RETURN NEW;END IF;
  IF ROW(NEW.id,NEW.thread_id,NEW.organization_id,NEW.mandate_id,NEW.owner_user_id,NEW.conversation_id,NEW.name,NEW.request_key,NEW.created_at)
   IS DISTINCT FROM ROW(OLD.id,OLD.thread_id,OLD.organization_id,OLD.mandate_id,OLD.owner_user_id,OLD.conversation_id,OLD.name,OLD.request_key,OLD.created_at)
   OR (NEW.input-'body') IS DISTINCT FROM (OLD.input-'body') THEN RAISE EXCEPTION 'Original causal reply source is immutable';END IF;
  IF NEW.input IS NOT DISTINCT FROM OLD.input AND NEW.input_digest IS NOT DISTINCT FROM OLD.input_digest THEN RETURN NEW;END IF;
  IF OLD.state<>'proposed' OR NEW.state<>'proposed' OR OLD.fence<>0 OR NEW.fence<>0 THEN RAISE EXCEPTION 'Causal reply body requires pending human review';END IF;
 END IF;
 IF NOT NEW.input ? 'replyCausality' THEN RETURN NEW;END IF;
 IF current_setting('role',true) NOT IN('acquire_agent_user','acquire_campaign_user') OR NEW.organization_id IS DISTINCT FROM current_setting('app.acquire_org',true) OR NEW.owner_user_id IS DISTINCT FROM current_setting('app.acquire_user',true)
 OR NOT EXISTS(SELECT 1 FROM public.member WHERE organization_id=NEW.organization_id AND user_id=NEW.owner_user_id)
 OR NOT EXISTS(SELECT 1 FROM public.communication_send_gates WHERE organization_id=NEW.organization_id AND writer_xid=txid_current()) THEN RAISE EXCEPTION 'Held current causal reply required';END IF;
 SELECT * INTO c FROM public.agent_conversations WHERE id=NEW.conversation_id AND thread_id=NEW.thread_id AND mandate_id=NEW.mandate_id AND organization_id=NEW.organization_id AND owner_user_id=NEW.owner_user_id FOR UPDATE;
 SELECT * INTO r FROM public.agent_conversation_channels WHERE id::text=NEW.input->>'routeId' AND conversation_id=c.id AND thread_id=c.thread_id AND organization_id=c.organization_id AND owner_user_id=c.owner_user_id;
 IF c.id IS NULL OR r.id IS NULL OR NEW.name IS DISTINCT FROM r.channel||'.reply' OR NEW.input->>'kind' IS DISTINCT FROM 'reply_'||r.channel
 OR NEW.input->>'contextRevision' IS DISTINCT FROM public.agent_context_revision(c.id) OR NEW.input->>'historyRevision' IS DISTINCT FROM c.history_revision OR NEW.input->>'routeHistoryRevision' IS DISTINCT FROM r.history_revision
 OR NEW.input->>'bindingDigest' IS DISTINCT FROM r.binding_digest OR NEW.input->>'identityRevision' IS DISTINCT FROM r.identity_revision OR NEW.input->>'recipientKey' IS DISTINCT FROM r.channel||':'||r.recipient_value OR NEW.input->>'epoch' IS DISTINCT FROM c.epoch::text
 OR NOT public.agent_channel_proposal_permitted(r.id,'reply') THEN RAISE EXCEPTION 'Exact current causal reply source required';END IF;
 expected:=public.agent_channel_reply_causality(r.id);
 IF expected IS NULL OR NEW.input->'replyCausality' IS DISTINCT FROM expected
 OR NEW.input_digest IS DISTINCT FROM encode(sha256(convert_to(public.agent_channel_canonical_json(jsonb_build_object('name',NEW.name,'input',NEW.input)),'UTF8')),'hex') THEN RAISE EXCEPTION 'Exact server-derived causal snapshot and digest required';END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.agent_reply_causality_guard() FROM PUBLIC;
CREATE TRIGGER agent_01_reply_causality BEFORE INSERT OR UPDATE ON public.agent_operations FOR EACH ROW EXECUTE FUNCTION public.agent_reply_causality_guard();

-- Existing authority, policy, history, binding and real lease gates retained.
CREATE OR REPLACE FUNCTION public.agent_channel_proposal_before_invitations(p_route uuid, p_stage text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE r public.agent_conversation_channels%ROWTYPE;c public.agent_conversations%ROWTYPE;p public.agent_channel_policies%ROWTYPE;latest_in jsonb;latest_out jsonb;reply_candidate jsonb;person_out jsonb;last_sent record;next_index integer;source_revision text;
BEGIN
 IF current_setting('role',true) NOT IN('acquire_agent_user','acquire_campaign_user') OR NOT EXISTS(SELECT 1 FROM public.member WHERE organization_id=current_setting('app.acquire_org',true) AND user_id=current_setting('app.acquire_user',true)) OR NOT EXISTS(SELECT 1 FROM public.communication_send_gates WHERE organization_id=current_setting('app.acquire_org',true) AND writer_xid=txid_current()) THEN RAISE EXCEPTION 'Held current channel proposal scope required';END IF;
 SELECT * INTO r FROM public.agent_conversation_channels WHERE id=p_route AND organization_id=current_setting('app.acquire_org',true) AND owner_user_id=current_setting('app.acquire_user',true);
 SELECT * INTO c FROM public.agent_conversations WHERE id=r.conversation_id AND thread_id=r.thread_id;
 SELECT * INTO p FROM public.agent_channel_policies WHERE thread_id=r.thread_id;
 IF r.id IS NULL OR c.id IS NULL OR p.thread_id IS NULL OR p_stage IS NULL OR p_stage NOT IN('initial','reply','follow_up') OR c.phase<>'active' OR c.driver_kind<>'agent' OR c.engagement IN('handoff','stopped') OR NOT c.history_complete OR c.history_source<>'communications' THEN RETURN false;END IF;
 IF NOT EXISTS(SELECT 1 FROM public.agent_responsibilities WHERE id=c.responsibility_id AND state IN('ready','waiting')) OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(p.bindings) x WHERE x->>'bindingId'=r.binding_id::text AND x->>'channel'=r.channel AND x->>'bindingDigest'=r.binding_digest) OR r.binding_digest IS DISTINCT FROM public.agent_recorded_binding_digest(r.binding_id) THEN RETURN false;END IF;
 IF EXISTS(SELECT 1 FROM public.agent_conversation_channels x WHERE x.conversation_id=c.id AND (NOT x.history_complete OR x.history_observed_at IS NULL OR x.history_observed_at>public.local_simulator_business_now() OR x.history_observed_at<public.local_simulator_business_now()-interval '5 minutes')) OR (SELECT count(*) FROM public.agent_conversation_channels WHERE conversation_id=c.id)<>cardinality(p.channel_order) THEN RETURN false;END IF;
 SELECT xmin::text INTO source_revision FROM public.contacts WHERE id=c.contact_id AND organization_id=c.organization_id AND fictionalised=false AND coalesce(personal_data->>'doNotContact','false')='false';
 IF source_revision IS NULL OR r.identity_source->>'revision' IS DISTINCT FROM source_revision THEN RETURN false;END IF;
 IF p.accelerated_simulation AND (NOT public.agent_channel_local_binding(r.binding_id) OR NOT public.agent_channel_reserved_recipient(r.channel,r.recipient_value)) THEN RETURN false;END IF;
 SELECT value INTO latest_in FROM jsonb_array_elements(c.history) WHERE value->>'direction'='inbound' ORDER BY (value->>'at')::timestamptz DESC,value->>'id' DESC LIMIT 1;
 SELECT value INTO latest_out FROM jsonb_array_elements(r.history) WHERE value->>'direction'='outbound' ORDER BY (value->>'at')::timestamptz DESC,value->>'id' DESC LIMIT 1;
 IF latest_in IS NOT NULL AND p_stage='reply' THEN
  -- Shared original-causality kernel also drives protected context and admission.
  RETURN public.agent_channel_reply_causality(p_route) IS NOT NULL;
 END IF;
 IF latest_in IS NOT NULL THEN
  -- Cold introductions stay cancelled. Warm continuity follows the latest
  -- actual person answer, not the hash order of simultaneous incoming IDs.
  IF p_stage<>'follow_up' THEN RETURN false;END IF;
  SELECT value INTO person_out FROM jsonb_array_elements(c.history) WHERE value->>'direction'='outbound' ORDER BY (value->>'at')::timestamptz DESC,value->>'id' DESC LIMIT 1;
  IF person_out IS NULL OR (person_out->>'at')::timestamptz<=(latest_in->>'at')::timestamptz
   OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(r.history) x WHERE x=person_out)
   OR (CASE WHEN person_out->>'routeId' IS NULL THEN r.channel<>'email' OR r.binding_id<>c.binding_id OR coalesce(person_out->>'channel','email')<>'email' ELSE person_out->>'routeId' IS DISTINCT FROM r.id::text OR person_out->>'channel' IS DISTINCT FROM r.channel OR person_out->>'bindingDigest' IS DISTINCT FROM r.binding_digest END) THEN RETURN false;END IF;
  -- Equal-time answers on multiple routes are ambiguous; never pick by hash.
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(c.history) x WHERE x->>'direction'='outbound' AND (x->>'at')::timestamptz=(person_out->>'at')::timestamptz
   AND (CASE WHEN x->>'routeId' IS NULL THEN r.channel<>'email' OR r.binding_id<>c.binding_id OR coalesce(x->>'channel','email')<>'email' ELSE x->>'routeId' IS DISTINCT FROM r.id::text OR x->>'channel' IS DISTINCT FROM r.channel OR x->>'bindingDigest' IS DISTINCT FROM r.binding_digest END)) THEN RETURN false;END IF;
  SELECT value INTO reply_candidate FROM jsonb_array_elements(r.history) WHERE value->>'direction'='inbound' AND (value->>'at')::timestamptz=(latest_in->>'at')::timestamptz ORDER BY value->>'id' DESC LIMIT 1;
  IF reply_candidate IS NULL OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(c.history) x WHERE x=reply_candidate)
   OR (CASE WHEN reply_candidate->>'routeId' IS NULL THEN r.channel<>'email' OR r.binding_id<>c.binding_id OR coalesce(reply_candidate->>'channel','email')<>'email' ELSE reply_candidate->>'routeId' IS DISTINCT FROM r.id::text OR reply_candidate->>'channel' IS DISTINCT FROM r.channel OR reply_candidate->>'bindingDigest' IS DISTINCT FROM r.binding_digest END) THEN RETURN false;END IF;
  RETURN r.next_allowed_at IS NOT NULL AND r.next_allowed_at<=public.local_simulator_business_now();
 END IF;
 IF r.cold_cancelled_at IS NOT NULL OR c.engagement<>'cold' OR p_stage='reply' OR r.next_allowed_at IS NULL OR r.next_allowed_at>public.local_simulator_business_now() THEN RETURN false;END IF;
 SELECT o.input->>'routeId' AS route_id,public.local_simulator_operation_business_anchor(o) AS updated_at INTO last_sent FROM public.agent_operations o WHERE o.conversation_id=c.id AND o.state='complete' AND o.result->'delivery'->>'status'='submitted' ORDER BY CASE WHEN nullif(current_setting('acquire.simulator_business_run',true),'') IS NULL THEN o.updated_at ELSE public.local_simulator_operation_business_anchor(o) END DESC,o.id DESC LIMIT 1;
 IF last_sent.route_id IS NULL THEN next_index:=1;
 ELSE SELECT coalesce(array_position(p.channel_order,x.channel),0)%cardinality(p.channel_order)+1 INTO next_index FROM public.agent_conversation_channels x WHERE x.id::text=last_sent.route_id AND x.conversation_id=c.id;
  IF next_index IS NULL OR public.local_simulator_business_now()<last_sent.updated_at+make_interval(secs=>p.delay_seconds) THEN RETURN false;END IF;
 END IF;
 IF p.channel_order[next_index]<>r.channel THEN RETURN false;END IF;
 RETURN CASE p_stage WHEN 'initial' THEN latest_out IS NULL WHEN 'follow_up' THEN latest_out IS NOT NULL ELSE false END;
END $function$
;

CREATE OR REPLACE FUNCTION public.agent_channel_operation_before_invitations(p_operation uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE org text:=current_setting('app.acquire_org',true);actor text:=current_setting('app.acquire_user',true);o public.agent_operations%ROWTYPE;c public.agent_conversations%ROWTYPE;r public.agent_conversation_channels%ROWTYPE;p public.agent_channel_policies%ROWTYPE;a public.agent_authority_uses%ROWTYPE;g public.agent_authority_grants%ROWTYPE;b public.agent_review_batches%ROWTYPE;stage text;kind text;latest_in jsonb;aliases uuid[];
BEGIN
 IF current_setting('role',true) NOT IN('acquire_agent_user','acquire_campaign_user') OR NOT EXISTS(SELECT 1 FROM public.member WHERE organization_id=org AND user_id=actor) OR NOT EXISTS(SELECT 1 FROM public.communication_send_gates WHERE organization_id=org AND writer_xid=txid_current()) THEN RAISE EXCEPTION 'Held current routed authority required';END IF;
 SELECT * INTO o FROM public.agent_operations WHERE id=p_operation AND organization_id=org AND owner_user_id=actor;
 IF o.id IS NULL OR o.state<>'running' OR o.lease_until IS NULL OR o.lease_until<=clock_timestamp() OR NOT o.input ? 'routeId' OR coalesce(o.input->>'routeId','')!~'^[a-f0-9-]{36}$' THEN RETURN false;END IF;
 SELECT * INTO r FROM public.agent_conversation_channels WHERE id=(o.input->>'routeId')::uuid AND conversation_id=o.conversation_id AND thread_id=o.thread_id AND organization_id=org AND owner_user_id=actor;
 SELECT * INTO c FROM public.agent_conversations WHERE id=r.conversation_id AND organization_id=org AND owner_user_id=actor;
 SELECT * INTO p FROM public.agent_channel_policies WHERE thread_id=c.thread_id;
 IF c.id IS NOT NULL THEN PERFORM public.agent_load_mandate_execution_context(jsonb_build_object('kind','agent','operationId',o.id),org,actor);END IF;
 stage:=split_part(o.name,'.',2);kind:=stage||'_'||r.channel;
 IF r.id IS NULL OR c.id IS NULL OR p.thread_id IS NULL OR o.name<>r.channel||'.'||stage OR stage NOT IN('initial','reply','follow_up') OR c.delivery_mode<>'communications'
 OR o.input->>'bindingDigest' IS DISTINCT FROM r.binding_digest OR o.input->>'identityRevision' IS DISTINCT FROM r.identity_revision OR o.input->>'policyRevision' IS DISTINCT FROM p.revision::text OR o.input->>'routeHistoryRevision' IS DISTINCT FROM r.history_revision
 OR o.input->>'recipientKey' IS DISTINCT FROM r.channel||':'||r.recipient_value OR o.input->>'contextRevision' IS DISTINCT FROM public.agent_context_revision(c.id) OR o.input->>'epoch' IS DISTINCT FROM c.epoch::text
 OR o.input->>'kind' IS DISTINCT FROM kind OR coalesce(o.input->>'body','')='' OR length(o.input->>'body')>6000 OR (o.input->>'body')~*'(https?://|www[.]|calendly|cal[.]com)' OR o.input->>'intent' IN('meeting_ready','opt_out','uncertain')
 OR r.channel<>'email' AND o.input->>'subject' IS DISTINCT FROM '' OR r.channel='email' AND coalesce(o.input->>'subject','')='' OR NOT public.agent_channel_proposal_permitted(r.id,stage) THEN RETURN false;END IF;
 -- Legacy operations retain their existing strict ordering; a legacy tie
 -- cannot borrow a new context proof. New captured replies must still equal
 -- the exact current protected snapshot at the final admission boundary.
 IF stage='reply' THEN
  IF o.input ? 'replyCausality' THEN
   IF o.input->'replyCausality' IS DISTINCT FROM public.agent_channel_reply_causality(r.id) THEN RETURN false;END IF;
  ELSIF EXISTS(SELECT 1 FROM jsonb_array_elements(c.history) outgoing WHERE outgoing->>'direction'='outbound'
   AND (outgoing->>'at')::timestamptz>=(SELECT max((incoming->>'at')::timestamptz) FROM jsonb_array_elements(c.history) incoming WHERE incoming->>'direction'='inbound')) THEN RETURN false;END IF;
 END IF;
 IF NOT p.accelerated_simulation AND NOT public.agent_email_window_open(public.local_simulator_business_now()) THEN RETURN false;END IF;
 -- A plan revision, a manual handoff, an opt-out or another account's unknown
 -- outcome cannot be bypassed by choosing a different channel.
 IF NOT EXISTS(SELECT 1 FROM public.agent_responsibilities s JOIN public.mandates m ON m.id=s.mandate_id AND m.organization_id=s.organization_id WHERE s.id=c.responsibility_id AND s.state IN('ready','waiting') AND s.mandate_revision=m.xmin::text)
 OR EXISTS(SELECT 1 FROM public.agent_handoffs h WHERE h.conversation_id=c.id AND h.state NOT IN('dismissed','meeting_confirmed'))
 OR EXISTS(SELECT 1 FROM public.communication_reply_review_latches WHERE organization_id=org AND resolved_at IS NULL)
 OR public.agent_mandate_person_has_unresolved_sends(c.mandate_id,c.contact_id,o.id) THEN RETURN false;END IF;
 aliases:=public.agent_canonical_contact_aliases(c.contact_id);
 IF EXISTS(SELECT 1 FROM public.contacts x WHERE x.id=ANY(aliases) AND (x.fictionalised OR coalesce(x.personal_data->>'doNotContact','false')<>'false'))
 OR EXISTS(SELECT 1 FROM public.suppressions s WHERE s.organization_id=org AND (lower(s.address)=lower(r.recipient_value) OR r.channel='email' AND lower(s.domain)=split_part(r.recipient_value,'@',2))) THEN RETURN false;END IF;
 SELECT value INTO latest_in FROM jsonb_array_elements(c.history) WHERE value->>'direction'='inbound' ORDER BY (value->>'at')::timestamptz DESC,value->>'id' DESC LIMIT 1;
 IF latest_in IS NOT NULL AND ((latest_in->>'at')::timestamptz>public.local_simulator_business_now() OR latest_in->>'text'~*'(unsubscribe|do not (contact|email|message)|don[''’]t (contact|email|message)|stop (contacting|emailing|messaging)|remove me|no further (emails|messages|contact))') THEN RETURN false;END IF;
 IF EXISTS(SELECT 1 FROM public.campaign_reply_holds h WHERE h.organization_id=org AND h.contact_id=ANY(aliases) AND (stage='initial' OR h.reason<>'reply_received' OR latest_in IS NULL OR h.received_at>(latest_in->>'at')::timestamptz))
 OR EXISTS(SELECT 1 FROM public.campaign_contact_holds h WHERE h.organization_id=org AND EXISTS(SELECT 1 FROM public.contacts x WHERE x.id=ANY(aliases) AND lower(x.personal_data->>'email')=lower(h.email)) AND (stage='initial' OR h.reason<>'reply_received' OR latest_in IS NULL)) THEN RETURN false;END IF;
 SELECT * INTO a FROM public.agent_authority_uses WHERE operation_id=o.id AND organization_id=org AND owner_user_id=actor;
 IF a.operation_id IS NULL OR a.state<>'reserved' OR a.operation_revision<>o.revision OR a.operation_fence<>o.fence OR a.operation_digest<>o.input_digest OR a.context_revision IS DISTINCT FROM o.input->>'contextRevision' OR a.binding_digest IS DISTINCT FROM r.binding_digest THEN RETURN false;END IF;
 IF a.grant_id IS NULL THEN
  SELECT * INTO b FROM public.agent_review_batches WHERE id=a.review_batch_id AND thread_id=o.thread_id AND organization_id=org AND owner_user_id=actor;
  IF b.id IS NULL OR b.state<>'approved' OR NOT b.manifest @> jsonb_build_array(jsonb_build_object('operationId',o.id,'revision',o.revision,'digest',o.input_digest,'contextRevision',o.input->>'contextRevision')) THEN RETURN false;END IF;
 ELSE
  SELECT * INTO g FROM public.agent_authority_grants WHERE id=a.grant_id AND thread_id=o.thread_id AND organization_id=org AND owner_user_id=actor;
  IF o.input->>'requiresHumanReview'='true' OR g.id IS NULL OR g.revision<>a.grant_revision OR g.revoked_at IS NOT NULL OR g.expires_at<=clock_timestamp() OR g.approved_at>clock_timestamp() OR g.used_sends>g.max_sends OR g.channel<>r.channel OR g.binding_digest<>r.binding_digest OR NOT g.actions ? kind OR NOT g.recipient_keys ? (r.channel||':'||r.recipient_value) OR NOT g.route_ids ? r.id::text THEN RETURN false;END IF;
 END IF;
 RETURN (SELECT count(DISTINCT x.scope_key)=4 FROM public.agent_budget_reservations z JOIN public.agent_budget_accounts x ON x.id=z.account_id AND x.organization_id=z.organization_id WHERE z.operation_id=o.id AND z.organization_id=org AND z.state='reserved' AND z.amount=1 AND x.unit='sends' AND x.scope_key=ANY(ARRAY['organization:sends','user:'||actor||':sends','mandate:'||c.mandate_id::text||':sends','binding:'||r.binding_digest||':sends']) AND x.window_start<=clock_timestamp() AND x.window_end>clock_timestamp() AND x.spent+x.reserved<=x.cap);
END $function$
;


-- Exact selected reply parent; existing invitation wrapper remains unchanged.
CREATE OR REPLACE FUNCTION public.agent_channel_source_before_invitations(operation uuid, conversation uuid, expected_epoch bigint, expected_fence bigint, binding uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE o public.agent_operations%ROWTYPE;c public.agent_conversations%ROWTYPE;r public.agent_conversation_channels%ROWTYPE;parent jsonb;peer jsonb;coverage jsonb;latest jsonb;stage text;
BEGIN
 IF public.agent_communications_source_kind(operation,conversation,expected_epoch,expected_fence,binding) IS DISTINCT FROM 'recorded_channel' OR NOT public.agent_operation_authorised(operation) THEN RETURN NULL;END IF;
 SELECT * INTO o FROM public.agent_operations WHERE id=operation;
 SELECT * INTO c FROM public.agent_conversations WHERE id=conversation;
 SELECT * INTO r FROM public.agent_conversation_channels WHERE id::text=o.input->>'routeId';stage:=split_part(o.name,'.',2);
 SELECT jsonb_agg(jsonb_build_object('bindingId',x.binding_id,'channel',x.channel,'recipient',jsonb_build_object('kind',x.recipient_kind,'value',x.recipient_value)) ORDER BY x.channel) INTO coverage FROM public.agent_conversation_channels x WHERE x.conversation_id=c.id;
 IF stage<>'initial' THEN
  IF stage='reply' AND o.input ? 'replyCausality' THEN
   SELECT value INTO latest FROM jsonb_array_elements(r.history) WHERE value->>'id'=o.input->'replyCausality'->>'answeredInboundHistoryId' AND value->>'direction'='inbound';
  ELSE
  SELECT value INTO latest FROM jsonb_array_elements(r.history) WHERE coalesce(value->>'providerMessageId',value->>'id') IS NOT NULL ORDER BY (value->>'direction'='inbound') DESC,(value->>'at')::timestamptz DESC,value->>'id' DESC LIMIT 1;
  END IF;
  IF latest IS NULL THEN RETURN NULL;END IF;
  IF r.channel='email' THEN parent:=jsonb_build_object('id',coalesce(latest->>'providerMessageId',latest->>'id'),'contentDigest',encode(sha256(convert_to(coalesce(latest->>'subject','')||E'\n'||(latest->>'text'),'UTF8')),'hex'));
  ELSE IF coalesce(latest->>'providerConversationId','')='' THEN RETURN NULL;END IF;peer:=jsonb_build_object('id',latest->>'providerConversationId');END IF;
 ELSIF jsonb_array_length(r.history)>0 THEN RETURN NULL;END IF;
 RETURN jsonb_build_object('routeId',r.id,'channel',r.channel,'contactId',c.contact_id,'recipient',jsonb_build_object('kind',r.recipient_kind,'value',r.recipient_value),'subject',o.input->>'subject','body',o.input->>'body','contextDigest',o.input_digest,'requiredSince','1970-01-01T00:00:00.000Z','replyParent',parent,'conversation',peer,'coverageRoutes',coverage);
END $function$

