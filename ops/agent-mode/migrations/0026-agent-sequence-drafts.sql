-- Only owned editable drafts. No published-version/enrolment/provider privileges.
GRANT SELECT ON campaign_sequences TO acquire_agent_user;
GRANT INSERT(id,organization_id,owner_user_id,mandate_id,name,draft) ON campaign_sequences TO acquire_agent_user;
GRANT UPDATE(name,draft,updated_at) ON campaign_sequences TO acquire_agent_user;
CREATE POLICY agent_owned_sequence_drafts ON campaign_sequences AS RESTRICTIVE TO acquire_agent_user
 USING(organization_id=current_setting('app.acquire_org',true) AND owner_user_id=current_setting('app.acquire_user',true)
  AND EXISTS(SELECT 1 FROM public.member WHERE organization_id=current_setting('app.acquire_org',true) AND user_id=current_setting('app.acquire_user',true)))
 WITH CHECK(organization_id=current_setting('app.acquire_org',true) AND owner_user_id=current_setting('app.acquire_user',true)
  AND EXISTS(SELECT 1 FROM public.member WHERE organization_id=current_setting('app.acquire_org',true) AND user_id=current_setting('app.acquire_user',true)));
-- Existing campaign policies target only campaign roles; explicitly permit the
-- agent's own rows, with the restrictive membership fence above still required.
CREATE POLICY agent_owned_sequence_drafts_permit ON campaign_sequences TO acquire_agent_user
 USING(organization_id=current_setting('app.acquire_org',true) AND owner_user_id=current_setting('app.acquire_user',true))
 WITH CHECK(organization_id=current_setting('app.acquire_org',true) AND owner_user_id=current_setting('app.acquire_user',true));
