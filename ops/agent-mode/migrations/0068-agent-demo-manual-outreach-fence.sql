-- Manual campaigns/drafts are not a demo delivery adapter. Their explicit
-- enrolment origin remains fenced even after native demo routes are enabled.
-- Never infer origin from contacts.mandate_id: genuine contacts may be shared.
CREATE FUNCTION public.agent_assert_manual_mandate_outreach_mode(p_mandate uuid) RETURNS void
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE org text:=current_setting('app.acquire_org',true);actor text:=current_setting('app.acquire_user',true);
BEGIN
 -- Historical null-origin records retain existing behavior. Normal approval
 -- separately rejects missing origins; this function grants no effect authority.
 IF p_mandate IS NULL THEN RETURN;END IF;
 IF org IS NULL OR org='' OR actor IS NULL OR actor=''
 OR NOT EXISTS(SELECT 1 FROM public.member WHERE organization_id=org AND user_id=actor)
 OR NOT EXISTS(SELECT 1 FROM public.mandates WHERE id=p_mandate AND organization_id=org)
 THEN RAISE EXCEPTION 'Current owned mandate required';END IF;
 IF EXISTS(SELECT 1 FROM public.agent_mandate_execution_modes WHERE mandate_id=p_mandate AND organization_id=org AND mode='demo')
 THEN RAISE EXCEPTION 'Manual outreach is disabled for demo mandates; use reviewed demo agent routes.';END IF;
END $$;
REVOKE ALL ON FUNCTION public.agent_assert_manual_mandate_outreach_mode(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.agent_assert_manual_mandate_outreach_mode(uuid) TO acquire_agent_user,acquire_campaign_user;

-- Mode-neutral authoritative ORIGINAL outcome facts. Canonical recipient and
-- raw receipt stay encrypted with existing JournalCodec. A restricted role
-- cannot append an asserted success; only the privileged SDK-verifying writer.
CREATE TABLE public.communication_submission_receipts(
 intent_id uuid PRIMARY KEY REFERENCES public.communication_dispatch_intents(id),organization_id text NOT NULL,owner_user_id text NOT NULL,binding_id uuid NOT NULL,
 source_kind text NOT NULL CHECK(source_kind IN('draft','campaign','agent')),source_id uuid NOT NULL,
 operation text NOT NULL CHECK(operation IN('message','invitation')),operation_key text NOT NULL,
 payload_digest text NOT NULL CHECK(payload_digest~'^[a-f0-9]{64}$'),source_digest text NOT NULL CHECK(source_digest~'^[a-f0-9]{64}$'),
 original_intent_digest text NOT NULL CHECK(original_intent_digest~'^[a-f0-9]{64}$'),
 encrypted_receipt text NOT NULL CHECK(length(encrypted_receipt) BETWEEN 1 AND 2200000),receipt_key_version text NOT NULL CHECK(length(receipt_key_version) BETWEEN 1 AND 64),
 receipt_digest text NOT NULL CHECK(receipt_digest~'^[a-f0-9]{64}$'),recipient_digest text NOT NULL CHECK(recipient_digest~'^[a-f0-9]{64}$'),
 provider_reference text NOT NULL CHECK(length(provider_reference) BETWEEN 1 AND 2000),provider_conversation_reference text,submitted_at timestamptz NOT NULL,
 origin_status text NOT NULL CHECK(origin_status IN('sealed','legacy_unsealed')),origin_mandate_id uuid,origin_enrolment_id uuid,origin_conversation_id uuid,
 source_revision text CHECK(source_revision IS NULL OR length(source_revision) BETWEEN 1 AND 100),created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 CHECK((origin_status='sealed')=(origin_mandate_id IS NOT NULL)),
 CHECK(origin_status='sealed' OR (origin_enrolment_id IS NULL AND origin_conversation_id IS NULL)),
 CHECK(operation='message' OR provider_conversation_reference IS NULL),
 FOREIGN KEY(binding_id,organization_id,owner_user_id) REFERENCES public.communication_bindings(id,organization_id,owner_user_id)
);
ALTER TABLE public.communication_submission_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.communication_submission_receipts FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.communication_submission_receipts FROM PUBLIC,acquire_agent_user,acquire_campaign_user;
GRANT SELECT ON public.communication_submission_receipts TO acquire_agent_user,acquire_campaign_user;
CREATE POLICY submission_receipt_owned_read ON public.communication_submission_receipts FOR SELECT TO acquire_agent_user,acquire_campaign_user
 USING(organization_id=current_setting('app.acquire_org',true) AND owner_user_id=current_setting('app.acquire_user',true) AND EXISTS(SELECT 1 FROM public.member WHERE organization_id=current_setting('app.acquire_org',true) AND user_id=current_setting('app.acquire_user',true)));
CREATE POLICY submission_receipt_owner ON public.communication_submission_receipts TO PUBLIC
 USING(current_user=pg_get_userbyid((SELECT relowner FROM pg_class WHERE oid='public.communication_submission_receipts'::regclass)))
 WITH CHECK(current_user=pg_get_userbyid((SELECT relowner FROM pg_class WHERE oid='public.communication_submission_receipts'::regclass)));
CREATE FUNCTION public.communications_submission_receipt_immutable() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
BEGIN RAISE EXCEPTION 'Original submission receipt is immutable';END $$;
REVOKE ALL ON FUNCTION public.communications_submission_receipt_immutable() FROM PUBLIC;
CREATE TRIGGER submission_receipt_immutable BEFORE UPDATE OR DELETE ON public.communication_submission_receipts
 FOR EACH ROW EXECUTE FUNCTION public.communications_submission_receipt_immutable();
CREATE FUNCTION public.communications_submission_receipt_guard() RETURNS trigger
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE i public.communication_dispatch_intents%ROWTYPE;
BEGIN
 IF NEW.organization_id IS DISTINCT FROM current_setting('app.acquire_org',true) OR NEW.owner_user_id IS DISTINCT FROM current_setting('app.acquire_user',true)
 OR NOT EXISTS(SELECT 1 FROM public.member WHERE organization_id=NEW.organization_id AND user_id=NEW.owner_user_id)
 OR NOT EXISTS(SELECT 1 FROM public.communication_send_gates WHERE organization_id=NEW.organization_id AND writer_xid=txid_current()) THEN RAISE EXCEPTION 'Held current original receipt scope required';END IF;
 SELECT * INTO i FROM public.communication_dispatch_intents WHERE id=NEW.intent_id AND organization_id=NEW.organization_id AND owner_user_id=NEW.owner_user_id;
 IF i.id IS NULL OR i.binding_id IS DISTINCT FROM NEW.binding_id OR i.source_kind IS DISTINCT FROM NEW.source_kind OR i.source_id IS DISTINCT FROM NEW.source_id
 OR i.operation IS DISTINCT FROM NEW.operation OR i.operation_key IS DISTINCT FROM NEW.operation_key OR i.payload_digest IS DISTINCT FROM NEW.payload_digest
 OR i.source_digest IS DISTINCT FROM NEW.source_digest OR i.intent_digest IS DISTINCT FROM NEW.original_intent_digest
 OR NEW.submitted_at>clock_timestamp() OR NOT EXISTS(SELECT 1 FROM public.communication_dispatch_permits WHERE intent_id=i.id)
 OR EXISTS(SELECT 1 FROM public.communication_intent_resolutions WHERE intent_id=i.id)
 THEN RAISE EXCEPTION 'Exact authenticated original submission receipt required';END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.communications_submission_receipt_guard() FROM PUBLIC;
CREATE TRIGGER submission_receipt_insert_guard BEFORE INSERT ON public.communication_submission_receipts
 FOR EACH ROW EXECUTE FUNCTION public.communications_submission_receipt_guard();

CREATE FUNCTION public.agent_demo_manual_outreach_guard() RETURNS trigger
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE old_mandate uuid;new_mandate uuid;old_org text;new_org text;
BEGIN
 IF TG_TABLE_NAME IN('sequence_enrolments','campaign_enrolments') THEN
  IF TG_OP='UPDATE' THEN old_mandate:=OLD.mandate_id;old_org:=OLD.organization_id;END IF;
  new_mandate:=NEW.mandate_id;new_org:=NEW.organization_id;
 ELSIF TG_TABLE_NAME='messages' THEN
  IF TG_OP='UPDATE' THEN SELECT mandate_id,organization_id INTO old_mandate,old_org FROM public.sequence_enrolments WHERE id=OLD.enrolment_id AND organization_id=OLD.organization_id;END IF;
  SELECT mandate_id,organization_id INTO new_mandate,new_org FROM public.sequence_enrolments WHERE id=NEW.enrolment_id AND organization_id=NEW.organization_id;
 ELSE RAISE EXCEPTION 'Unsupported manual outreach guard';END IF;
 -- Check OLD as well: changing/reparenting a demo record cannot launder its
 -- origin. Real/historical records keep existing writes and ownership guards.
 IF EXISTS(SELECT 1 FROM public.agent_mandate_execution_modes m WHERE m.mode='demo'
  AND ((m.mandate_id=old_mandate AND m.organization_id=old_org) OR (m.mandate_id=new_mandate AND m.organization_id=new_org)))
 THEN
  -- Exact terminal projection only. V1 lacks sealed origin; retain its
  -- authenticated receipt in the ledger but hold ambiguous materialization.
  IF TG_TABLE_NAME='messages' AND TG_OP='UPDATE' THEN
   IF NEW.state='sent' AND OLD.state IN('approved','sent') AND NEW.id=OLD.id AND NEW.organization_id=OLD.organization_id AND NEW.enrolment_id=OLD.enrolment_id
   AND to_jsonb(NEW)-ARRAY['state','provider_message_id','provider_thread_id','sent_at','updated_at'] = to_jsonb(OLD)-ARRAY['state','provider_message_id','provider_thread_id','sent_at','updated_at']
   AND EXISTS(SELECT 1 FROM public.communication_submission_receipts r JOIN public.sequence_enrolments e ON e.id=OLD.enrolment_id AND e.organization_id=OLD.organization_id
    WHERE r.source_kind='draft' AND r.source_id=OLD.id AND r.operation='message' AND r.organization_id=OLD.organization_id
    AND r.owner_user_id=current_setting('app.acquire_user',true) AND r.organization_id=current_setting('app.acquire_org',true)
    AND r.origin_status='sealed' AND r.origin_mandate_id=e.mandate_id AND r.origin_enrolment_id=e.id AND r.source_revision IS NOT NULL
    AND r.source_digest=encode(sha256(convert_to(public.agent_channel_canonical_json(jsonb_build_object('source',jsonb_build_object('kind','draft','messageId',OLD.id,'revision',r.source_revision),'subject',OLD.subject,'body',OLD.body,'approvedBy',OLD.approved_by,'approvedAt',to_char(OLD.approved_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))),'UTF8')),'hex')
    AND (OLD.state='sent' OR r.source_revision=to_char(OLD.updated_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))
    AND r.provider_reference=NEW.provider_message_id AND r.provider_conversation_reference IS NOT DISTINCT FROM NEW.provider_thread_id AND r.submitted_at=NEW.sent_at
    AND (OLD.provider_message_id IS NULL OR OLD.provider_message_id=NEW.provider_message_id) AND (OLD.provider_thread_id IS NULL OR OLD.provider_thread_id IS NOT DISTINCT FROM NEW.provider_thread_id) AND (OLD.sent_at IS NULL OR OLD.sent_at=NEW.sent_at)
    AND EXISTS(SELECT 1 FROM public.member WHERE organization_id=r.organization_id AND user_id=r.owner_user_id)
    AND EXISTS(SELECT 1 FROM public.communication_send_gates WHERE organization_id=r.organization_id AND writer_xid=txid_current()))
   THEN RETURN NEW;END IF;
  END IF;
  RAISE EXCEPTION 'Manual outreach is disabled for demo mandates; use reviewed demo agent routes.';
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.agent_demo_manual_outreach_guard() FROM PUBLIC;
CREATE TRIGGER agent_00_demo_manual_outreach_guard BEFORE INSERT OR UPDATE ON public.sequence_enrolments
 FOR EACH ROW EXECUTE FUNCTION public.agent_demo_manual_outreach_guard();
CREATE TRIGGER agent_00_demo_manual_outreach_guard BEFORE INSERT OR UPDATE ON public.campaign_enrolments
 FOR EACH ROW EXECUTE FUNCTION public.agent_demo_manual_outreach_guard();
CREATE TRIGGER agent_00_demo_manual_outreach_guard BEFORE INSERT OR UPDATE ON public.messages
 FOR EACH ROW EXECUTE FUNCTION public.agent_demo_manual_outreach_guard();
-- Original intent lookup/permit receipts/service journals remain untouched.
-- No rows are backfilled, reparented, resumed, resolved or deleted here.
