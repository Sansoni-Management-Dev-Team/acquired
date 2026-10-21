-- Strengthen draft membership to the composite mandate/org boundary.
ALTER POLICY agent_owned_sequence_drafts ON campaign_sequences
 USING(organization_id=current_setting('app.acquire_org',true) AND owner_user_id=current_setting('app.acquire_user',true)
  AND EXISTS(SELECT 1 FROM public.member WHERE organization_id=current_setting('app.acquire_org',true) AND user_id=current_setting('app.acquire_user',true))
  AND EXISTS(SELECT 1 FROM public.mandates m WHERE m.id=mandate_id AND m.organization_id=campaign_sequences.organization_id))
 WITH CHECK(organization_id=current_setting('app.acquire_org',true) AND owner_user_id=current_setting('app.acquire_user',true)
  AND EXISTS(SELECT 1 FROM public.member WHERE organization_id=current_setting('app.acquire_org',true) AND user_id=current_setting('app.acquire_user',true))
  AND EXISTS(SELECT 1 FROM public.mandates m WHERE m.id=mandate_id AND m.organization_id=campaign_sequences.organization_id));
-- Publication pins immutable version rows; no contact/enrolment/send privilege.
GRANT SELECT ON campaign_sequence_versions TO acquire_agent_user;
GRANT INSERT(id,organization_id,owner_user_id,sequence_id,version,definition,n8n_workflow_id) ON campaign_sequence_versions TO acquire_agent_user;
GRANT UPDATE(published_version) ON campaign_sequences TO acquire_agent_user;
CREATE POLICY agent_sequence_versions_permit ON campaign_sequence_versions TO acquire_agent_user
 USING(organization_id=current_setting('app.acquire_org',true) AND owner_user_id=current_setting('app.acquire_user',true))
 WITH CHECK(organization_id=current_setting('app.acquire_org',true) AND owner_user_id=current_setting('app.acquire_user',true));
CREATE POLICY agent_sequence_versions_fence ON campaign_sequence_versions AS RESTRICTIVE TO acquire_agent_user
 USING(organization_id=current_setting('app.acquire_org',true) AND owner_user_id=current_setting('app.acquire_user',true)
  AND EXISTS(SELECT 1 FROM public.member WHERE organization_id=current_setting('app.acquire_org',true) AND user_id=current_setting('app.acquire_user',true))
  AND EXISTS(SELECT 1 FROM public.campaign_sequences s WHERE s.id=sequence_id AND s.organization_id=campaign_sequence_versions.organization_id AND s.owner_user_id=campaign_sequence_versions.owner_user_id))
 WITH CHECK(organization_id=current_setting('app.acquire_org',true) AND owner_user_id=current_setting('app.acquire_user',true)
  AND EXISTS(SELECT 1 FROM public.member WHERE organization_id=current_setting('app.acquire_org',true) AND user_id=current_setting('app.acquire_user',true))
  AND EXISTS(SELECT 1 FROM public.campaign_sequences s WHERE s.id=sequence_id AND s.organization_id=campaign_sequence_versions.organization_id AND s.owner_user_id=campaign_sequence_versions.owner_user_id));
-- The native actor already owns the same organization gate via
-- agent_lock_send_gate. Register only reviewed contact enrichment and sequence policy writes; this does
-- not grant INSERT/UPDATE itself or admit native writers to send-attempt tables.
CREATE OR REPLACE FUNCTION public.communications_policy_statement_fence() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE invoker text:=current_setting('role',true);org text:=current_setting('app.acquire_org',true);actor text:=current_setting('app.acquire_user',true);
BEGIN
 IF invoker='acquire_agent_user' AND TG_TABLE_SCHEMA='public' AND TG_TABLE_NAME IN('contacts','campaign_sequences','campaign_sequence_versions','campaign_enrolments','campaign_contact_assignments','campaign_channel_bindings','campaign_reply_identities')
 AND EXISTS(SELECT 1 FROM public.communication_send_gates WHERE organization_id=org AND writer_xid=txid_current())
 AND EXISTS(SELECT 1 FROM public.member WHERE organization_id=org AND user_id=actor) THEN RETURN NULL; END IF;
 IF invoker IN('acquire_campaign_user','acquire_communications_writer','acquire_campaign_worker') AND EXISTS(SELECT 1 FROM public.communication_send_gates WHERE organization_id=org AND writer_xid=txid_current()) THEN RETURN NULL; END IF;
 IF invoker NOT IN('none','acquire_campaign_worker') THEN RAISE EXCEPTION 'Registered scoped writer must acquire organization gate first'; END IF;
 PERFORM pg_advisory_xact_lock(7426619361492031::bigint);
 UPDATE public.communication_member_fence SET writer_xid=txid_current() WHERE singleton;
 RETURN NULL;
END $$;
