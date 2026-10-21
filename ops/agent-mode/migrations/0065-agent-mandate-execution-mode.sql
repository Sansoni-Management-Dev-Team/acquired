-- New immutable creation intent only; no historical backfill or outreach enable.
-- Demo outreach remains disabled until a separately reviewed mapping gate exists.
CREATE TABLE public.agent_mandate_execution_modes(
 mandate_id uuid PRIMARY KEY,
 organization_id text NOT NULL,
 created_by text NOT NULL REFERENCES public."user"(id),
 mode text NOT NULL CHECK(mode IN('real','demo')),
 demo_id uuid,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 FOREIGN KEY(mandate_id,organization_id) REFERENCES public.mandates(id,organization_id),
 CHECK((mode='demo' AND demo_id IS NOT NULL AND demo_id=mandate_id) OR (mode='real' AND demo_id IS NULL))
);
ALTER TABLE public.agent_mandate_execution_modes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_mandate_execution_modes FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.agent_mandate_execution_modes FROM PUBLIC,acquire_agent_user,acquire_campaign_user;
GRANT SELECT ON public.agent_mandate_execution_modes TO acquire_agent_user,acquire_campaign_user;
-- Every current organisation member must know the mode, not only its creator.
CREATE POLICY agent_mandate_mode_member_read ON public.agent_mandate_execution_modes
 FOR SELECT TO acquire_agent_user,acquire_campaign_user
 USING(organization_id=current_setting('app.acquire_org',true)
 AND EXISTS(SELECT 1 FROM public.member WHERE organization_id=current_setting('app.acquire_org',true) AND user_id=current_setting('app.acquire_user',true)));
CREATE POLICY agent_mandate_mode_definer ON public.agent_mandate_execution_modes TO PUBLIC
 USING(current_user=pg_get_userbyid((SELECT relowner FROM pg_class WHERE oid='public.agent_mandate_execution_modes'::regclass)))
 WITH CHECK(current_user=pg_get_userbyid((SELECT relowner FROM pg_class WHERE oid='public.agent_mandate_execution_modes'::regclass)));

CREATE FUNCTION public.agent_mandate_execution_mode_immutable() RETURNS trigger
 LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
BEGIN
 RAISE EXCEPTION 'Mandate execution mode is immutable';
END $$;
REVOKE ALL ON FUNCTION public.agent_mandate_execution_mode_immutable() FROM PUBLIC;
-- Ordinary triggers intentionally permit existing replica-only fixture cleanup.
CREATE TRIGGER agent_mandate_execution_mode_immutable BEFORE UPDATE OR DELETE
 ON public.agent_mandate_execution_modes FOR EACH ROW EXECUTE FUNCTION public.agent_mandate_execution_mode_immutable();

CREATE FUNCTION public.agent_assert_mandate_outreach_mode(p_mandate uuid) RETURNS void
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE org text:=current_setting('app.acquire_org',true);actor text:=current_setting('app.acquire_user',true);
BEGIN
 IF org IS NULL OR org='' OR actor IS NULL OR actor='' OR p_mandate IS NULL
 OR NOT EXISTS(SELECT 1 FROM public.member WHERE organization_id=org AND user_id=actor)
 OR NOT EXISTS(SELECT 1 FROM public.mandates WHERE id=p_mandate AND organization_id=org)
 THEN RAISE EXCEPTION 'Current owned mandate required';END IF;
 IF EXISTS(SELECT 1 FROM public.agent_mandate_execution_modes WHERE mandate_id=p_mandate AND organization_id=org AND mode='demo')
 THEN RAISE EXCEPTION 'Demo recipients are not provisioned; real contact outreach is disabled.';END IF;
END $$;
REVOKE ALL ON FUNCTION public.agent_assert_mandate_outreach_mode(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.agent_assert_mandate_outreach_mode(uuid) TO acquire_agent_user,acquire_campaign_user;

CREATE FUNCTION public.agent_mandate_outreach_mode_guard() RETURNS trigger
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE old_effect boolean:=false;new_effect boolean:=false;
BEGIN
 IF TG_TABLE_NAME NOT IN('agent_conversations','agent_operations') THEN RAISE EXCEPTION 'Unsupported mandate outreach guard';END IF;
 -- Do not add actor/context requirements to historical or explicit real-mode
 -- writes. Existing RLS/send gates remain unchanged for those rows.
 IF TG_TABLE_NAME='agent_conversations' THEN old_effect:=true;new_effect:=true;
 ELSE
  new_effect:=NEW.name~'^(email|whatsapp|linkedin)[.]';
  IF TG_OP='UPDATE' THEN old_effect:=OLD.name~'^(email|whatsapp|linkedin)[.]';END IF;
 END IF;
 IF TG_OP='UPDATE' THEN
  IF old_effect
  AND EXISTS(SELECT 1 FROM public.agent_mandate_execution_modes WHERE mandate_id=OLD.mandate_id AND mode='demo')
  THEN PERFORM public.agent_assert_mandate_outreach_mode(OLD.mandate_id);END IF;
 END IF;
 IF new_effect
 AND EXISTS(SELECT 1 FROM public.agent_mandate_execution_modes WHERE mandate_id=NEW.mandate_id AND mode='demo')
 THEN PERFORM public.agent_assert_mandate_outreach_mode(NEW.mandate_id);END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.agent_mandate_outreach_mode_guard() FROM PUBLIC;
-- Prefix-wide coverage deliberately includes separately reviewed invitations.
CREATE TRIGGER agent_00_mandate_outreach_mode_guard BEFORE INSERT OR UPDATE ON public.agent_conversations
 FOR EACH ROW EXECUTE FUNCTION public.agent_mandate_outreach_mode_guard();
CREATE TRIGGER agent_00_mandate_outreach_mode_guard BEFORE INSERT OR UPDATE ON public.agent_operations
 FOR EACH ROW EXECUTE FUNCTION public.agent_mandate_outreach_mode_guard();
