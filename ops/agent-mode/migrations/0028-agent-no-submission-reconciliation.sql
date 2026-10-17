-- Prepared only. Requires explicit approval for this exact migration.
-- Trusted application codec authenticates the immutable original service proof
-- before invoking this bounded ledger transition. No new send or retry key.
CREATE FUNCTION public.agent_communications_no_submission(operation uuid,intent uuid DEFAULT NULL,expected_proof_digest text DEFAULT NULL,current_run uuid DEFAULT NULL,current_event uuid DEFAULT NULL,current_lease_owner uuid DEFAULT NULL,current_fence bigint DEFAULT NULL) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE org text:=current_setting('app.acquire_org',true);actor text:=current_setting('app.acquire_user',true);op public.agent_operations%ROWTYPE;conv public.agent_conversations%ROWTYPE;original public.communication_dispatch_intents%ROWTYPE;reservation record;evidence jsonb;content jsonb;message_key text;
BEGIN
 IF current_setting('role',true) NOT IN('acquire_agent_user','acquire_campaign_user')
 OR NOT EXISTS(SELECT 1 FROM public.member WHERE organization_id=org AND user_id=actor)
 OR NOT EXISTS(SELECT 1 FROM public.communication_send_gates WHERE organization_id=org AND writer_xid=txid_current()) THEN RAISE EXCEPTION 'Held current application authority required'; END IF;
 SELECT * INTO op FROM public.agent_operations WHERE id=operation AND organization_id=org AND owner_user_id=actor;
 IF op.id IS NULL OR op.name NOT IN('email.initial','email.reply','email.follow_up') THEN RAISE EXCEPTION 'Owned original email operation required'; END IF;
 PERFORM 1 FROM public.agent_threads WHERE id=op.thread_id FOR UPDATE;
 SELECT * INTO op FROM public.agent_operations WHERE id=operation FOR UPDATE;
 SELECT * INTO conv FROM public.agent_conversations WHERE id=op.conversation_id AND organization_id=org AND owner_user_id=actor FOR UPDATE;
 IF conv.id IS NULL OR conv.delivery_mode<>'communications' THEN RAISE EXCEPTION 'Original communications conversation required'; END IF;
 IF intent IS NOT NULL THEN
  IF expected_proof_digest IS NULL OR expected_proof_digest!~'^[a-f0-9]{64}$' THEN RAISE EXCEPTION 'Authenticated original disposition required'; END IF;
  SELECT * INTO original FROM public.communication_dispatch_intents WHERE id=intent AND organization_id=org AND owner_user_id=actor AND source_kind='agent' AND source_id=op.id AND binding_id=conv.binding_id;
  IF (SELECT count(*) FROM public.communication_dispatch_intents WHERE organization_id=org AND owner_user_id=actor AND source_kind='agent' AND source_id=op.id)<>1 OR original.id IS NULL OR original.contact_id<>conv.contact_id OR original.operation<>'message' OR NOT EXISTS(SELECT 1 FROM public.communication_intent_resolutions WHERE intent_id=intent AND proof_digest=expected_proof_digest) THEN RAISE EXCEPTION 'Recorded original disposition required'; END IF;
  evidence:=jsonb_build_object('status','not_submitted','intentId',intent,'proofDigest',expected_proof_digest,'operationKey',original.operation_key);
 ELSE
  IF current_setting('role',true)='acquire_agent_user' AND expected_proof_digest IS NULL AND op.state='failed' AND op.result->'delivery'=jsonb_build_object('status','not_submitted','reason','expired_without_application_intent') THEN RETURN op.result->'delivery'; END IF;
  IF current_run IS NOT NULL OR current_event IS NOT NULL OR current_lease_owner IS NOT NULL OR current_fence IS NOT NULL THEN
   IF NOT EXISTS(SELECT 1 FROM public.agent_runs r JOIN public.agent_events e ON e.id=r.trigger_event_id WHERE r.id=current_run AND e.id=current_event AND r.thread_id=op.thread_id AND e.thread_id=op.thread_id AND r.organization_id=org AND r.owner_user_id=actor AND r.state='running' AND e.state='leased' AND r.lease_owner=current_lease_owner AND e.lease_owner=current_lease_owner AND r.fence=current_fence AND e.fence=current_fence AND r.lease_until>clock_timestamp() AND e.lease_until>clock_timestamp() AND r.created_at+interval '45 seconds'>clock_timestamp() AND e.kind='email.reconcile' AND e.payload->>'operationId'=op.id::text) THEN RAISE EXCEPTION 'Current lookup-only reconcile fence required'; END IF;
  END IF;
  -- Absence of a receipt is never proof. Only an expired original operation
  -- with no committed application intent and no live thread run may close.
  IF current_setting('role',true)<>'acquire_agent_user' OR expected_proof_digest IS NOT NULL OR op.lease_until IS NULL OR op.lease_until>clock_timestamp()
   OR EXISTS(SELECT 1 FROM public.communication_dispatch_intents WHERE organization_id=org AND owner_user_id=actor AND source_kind='agent' AND source_id=op.id)
   OR EXISTS(SELECT 1 FROM public.agent_runs WHERE thread_id=op.thread_id AND state='running' AND lease_until>clock_timestamp() AND id IS DISTINCT FROM current_run) THEN RAISE EXCEPTION 'Expired unprepared operation proof required'; END IF;
  evidence:=jsonb_build_object('status','not_submitted','reason','expired_without_application_intent');
 END IF;
 IF op.state='failed' AND op.result->'delivery'=evidence THEN RETURN evidence; END IF;
 IF op.state NOT IN('running','uncertain') THEN RAISE EXCEPTION 'Original operation cannot be resolved'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.agent_authority_uses WHERE operation_id=op.id AND conversation_id=conv.id AND organization_id=org AND owner_user_id=actor AND binding_digest=conv.binding_digest AND state IN('reserved','admitted','uncertain')) THEN RAISE EXCEPTION 'Original authority use required'; END IF;
 IF (SELECT count(*) FROM public.agent_budget_reservations WHERE operation_id=op.id)<>3
 OR (SELECT count(DISTINCT a.scope_key) FROM public.agent_budget_reservations r JOIN public.agent_budget_accounts a ON a.id=r.account_id WHERE r.operation_id=op.id AND r.organization_id=org AND r.owner_user_id=actor AND r.amount=1 AND r.state IN('reserved','uncertain') AND a.organization_id=org AND a.unit='sends' AND a.scope_key=ANY(ARRAY['organization:sends','user:'||actor||':sends','mandate:'||conv.mandate_id::text||':sends']))<>3 THEN RAISE EXCEPTION 'Exact original sending reservations required'; END IF;
 FOR reservation IN SELECT r.*,a.reserved AS account_reserved FROM public.agent_budget_reservations r JOIN public.agent_budget_accounts a ON a.id=r.account_id WHERE r.operation_id=op.id ORDER BY r.account_id FOR UPDATE OF r,a LOOP
  IF reservation.account_reserved<reservation.amount THEN RAISE EXCEPTION 'Original reservation ledger inconsistent'; END IF;
  UPDATE public.agent_budget_accounts SET reserved=reserved-reservation.amount WHERE id=reservation.account_id;
  UPDATE public.agent_budget_reservations SET state='settled',actual=0,updated_at=clock_timestamp() WHERE id=reservation.id;
 END LOOP;
 UPDATE public.agent_authority_uses SET state='released',outcome=evidence,updated_at=clock_timestamp() WHERE operation_id=op.id AND organization_id=org AND owner_user_id=actor;
 -- Delegated used_sends remains monotonic. A proven no-send releases this
 -- operation, never silently restores or expands a grant's capacity.
 UPDATE public.agent_operations SET state='failed',result=jsonb_build_object('delivery',evidence),lease_until=NULL,updated_at=clock_timestamp() WHERE id=op.id;
 UPDATE public.agent_conversations SET phase=CASE WHEN driver_kind='agent' THEN 'held' ELSE phase END,history_complete=false,pause_reason=CASE WHEN driver_kind='agent' THEN 'provider_no_submission_confirmed' ELSE pause_reason END,epoch=epoch+1,revision=revision+1,reminder_generation=reminder_generation+1,next_wakeup_at=NULL,updated_at=clock_timestamp() WHERE id=conv.id;
 UPDATE public.agent_operations SET state='failed',result=jsonb_build_object('reason','context_changed'),updated_at=clock_timestamp() WHERE conversation_id=conv.id AND id<>op.id AND name IN('email.initial','email.reply','email.follow_up') AND state IN('proposed','approved');
 UPDATE public.agent_review_batches b SET state='invalidated' WHERE b.thread_id=op.thread_id AND b.state='pending' AND EXISTS(SELECT 1 FROM jsonb_array_elements(b.manifest) item JOIN public.agent_operations o ON o.id=(item->>'operationId')::uuid WHERE o.conversation_id=conv.id);
 content:=jsonb_build_object('text','The original email was confirmed not submitted. Its sending reservations were released. Automation remains held; review and explicitly resume before proposing fresh outreach.','operationId',op.id);
 message_key:='no-submission:'||op.id::text;
 INSERT INTO public.agent_messages(thread_id,organization_id,mandate_id,owner_user_id,request_key,role,content,content_digest) VALUES(op.thread_id,org,op.mandate_id,actor,message_key,'assistant',content,encode(sha256(convert_to(content::text,'UTF8')),'hex')) ON CONFLICT(thread_id,request_key) DO NOTHING;
 RETURN evidence;
END $$;
REVOKE ALL ON FUNCTION public.agent_communications_no_submission(uuid,uuid,text,uuid,uuid,uuid,bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.agent_communications_no_submission(uuid,uuid,text,uuid,uuid,uuid,bigint) TO acquire_agent_user,acquire_campaign_user;
