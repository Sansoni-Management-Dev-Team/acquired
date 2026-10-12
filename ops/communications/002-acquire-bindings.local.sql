-- PROVISIONAL REVIEW ARTIFACT. NOT APPLIED. No startup path invokes this file.
-- Exact target: OrbStack 127.0.0.1:5445/acquire_channels, Acquire public schema.
-- Separate approval is required for this file/hash/target. Local only.
-- Additive structure only: no legacy rows/credentials/defaults are backfilled.
-- Existing holds, journals, enrolments, messages and migrations remain intact.
BEGIN;
DO $$ BEGIN
  IF current_database() <> 'acquire_channels' THEN
    RAISE EXCEPTION 'Local Acquire binding fixture requires acquire_channels';
  END IF;
  IF to_regclass('public.campaign_send_attempts') IS NULL OR
     to_regclass('public.whatsapp_delivery_actions') IS NULL THEN
    RAISE EXCEPTION 'Requires reviewed existing Acquire schema including 0018';
  END IF;
END $$;

-- Immutable exact service binding snapshots; no cross-database service FK.
-- Account ID is service-owned. Legacy identity must be verified, never invented
-- from an organisation/user pair. These columns are references, not secrets.
CREATE UNIQUE INDEX communications_whatsapp_owner_fk ON public.whatsapp_connections (id,organization_id,user_id);
CREATE TABLE public.communication_bindings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id text NOT NULL DEFAULT 'acquire' CHECK (application_id = 'acquire'),
  organization_id text NOT NULL REFERENCES public.organization,
  owner_user_id text NOT NULL REFERENCES public."user",
  service_connection_id text NOT NULL CHECK (length(service_connection_id) BETWEEN 1 AND 200),
  service_account_id text NOT NULL CHECK (length(service_account_id) BETWEEN 1 AND 200),
  generation integer NOT NULL CHECK (generation > 0),
  channel text NOT NULL,
  platform text NOT NULL,
  backend text NOT NULL CHECK (backend IN ('direct','baileys','browser','unipile')),
  authority text NOT NULL CHECK (authority IN ('legacy_port','service')),
  legacy_mailbox_id uuid,
  legacy_whatsapp_id uuid,
  legacy_linkedin_reference text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (application_id, service_connection_id, generation),
  UNIQUE (id,organization_id,owner_user_id,channel),
  UNIQUE (id,organization_id,owner_user_id),
  FOREIGN KEY (legacy_mailbox_id,organization_id,owner_user_id)
    REFERENCES public.mailbox_connections (id,organization_id,user_id),
  FOREIGN KEY (legacy_whatsapp_id,organization_id,owner_user_id)
    REFERENCES public.whatsapp_connections (id,organization_id,user_id),
  CHECK ((channel = 'email' AND platform IN ('gmail','outlook','imap') AND backend IN ('direct','unipile'))
      OR (channel = 'whatsapp' AND platform = 'whatsapp' AND backend IN ('baileys','unipile'))
      OR (channel = 'linkedin' AND platform = 'linkedin' AND backend IN ('browser','unipile'))),
  CHECK ((authority = 'service' AND legacy_mailbox_id IS NULL AND legacy_whatsapp_id IS NULL AND legacy_linkedin_reference IS NULL)
      OR (authority = 'legacy_port' AND (
         (channel = 'email' AND backend = 'direct' AND legacy_mailbox_id IS NOT NULL AND legacy_whatsapp_id IS NULL AND legacy_linkedin_reference IS NULL)
      OR (channel = 'whatsapp' AND backend = 'baileys' AND legacy_mailbox_id IS NULL AND legacy_whatsapp_id IS NOT NULL AND legacy_linkedin_reference IS NULL)
      OR (channel = 'linkedin' AND backend = 'browser' AND legacy_mailbox_id IS NULL AND legacy_whatsapp_id IS NULL AND legacy_linkedin_reference IS NOT NULL AND length(legacy_linkedin_reference) > 0))))
);

-- Defaults are mutable selectors for NEW work only. No trigger rewrites work.
CREATE TABLE public.communication_defaults (
  organization_id text NOT NULL,
  owner_user_id text NOT NULL,
  channel text NOT NULL CHECK (channel IN ('email','whatsapp','linkedin')),
  binding_id uuid NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id,owner_user_id,channel),
  FOREIGN KEY (binding_id,organization_id,owner_user_id,channel)
    REFERENCES public.communication_bindings (id,organization_id,owner_user_id,channel)
);

CREATE TABLE public.campaign_channel_bindings (
  enrolment_id uuid NOT NULL,
  organization_id text NOT NULL,
  owner_user_id text NOT NULL,
  channel text NOT NULL CHECK (channel IN ('email','whatsapp','linkedin')),
  binding_id uuid NOT NULL,
  bound_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (enrolment_id,channel),
  UNIQUE (enrolment_id,channel,binding_id,organization_id,owner_user_id),
  FOREIGN KEY (enrolment_id,organization_id,owner_user_id)
    REFERENCES public.campaign_enrolments (id,organization_id,owner_user_id),
  FOREIGN KEY (binding_id,organization_id,owner_user_id,channel)
    REFERENCES public.communication_bindings (id,organization_id,owner_user_id,channel)
);

CREATE UNIQUE INDEX communications_attempt_owner_fk ON public.campaign_send_attempts (id,organization_id,owner_user_id,enrolment_id);
CREATE TABLE public.campaign_attempt_bindings (
  attempt_id uuid PRIMARY KEY,
  enrolment_id uuid NOT NULL,
  organization_id text NOT NULL,
  owner_user_id text NOT NULL,
  channel text NOT NULL,
  binding_id uuid NOT NULL,
  operation_key text NOT NULL CHECK (length(operation_key) BETWEEN 1 AND 200),
  operation text NOT NULL CHECK (operation IN ('message','invitation')),
  -- An imported historical attempt can lack a trustworthy original digest.
  -- Such a row supports lookup only. It cannot authorize a new dispatch.
  payload_digest text CHECK (payload_digest ~ '^[0-9a-f]{64}$'),
  digest_version text,
  recovery_only boolean NOT NULL DEFAULT false,
  journal_authority text NOT NULL CHECK (journal_authority IN ('legacy_gmail','legacy_whatsapp','legacy_linkedin','communications')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id,owner_user_id,operation_key),
  FOREIGN KEY (attempt_id,organization_id,owner_user_id,enrolment_id)
    REFERENCES public.campaign_send_attempts (id,organization_id,owner_user_id,enrolment_id),
  FOREIGN KEY (enrolment_id,channel,binding_id,organization_id,owner_user_id)
    REFERENCES public.campaign_channel_bindings (enrolment_id,channel,binding_id,organization_id,owner_user_id),
  CHECK ((payload_digest IS NULL) = (digest_version IS NULL)),
  CHECK (recovery_only OR payload_digest IS NOT NULL),
  CHECK (operation <> 'invitation' OR channel = 'linkedin')
);

CREATE UNIQUE INDEX communications_message_org_fk ON public.messages (id,organization_id);
CREATE TABLE public.outreach_draft_bindings (
  message_id uuid PRIMARY KEY,
  organization_id text NOT NULL,
  owner_user_id text NOT NULL,
  channel text NOT NULL DEFAULT 'email' CHECK (channel = 'email'),
  binding_id uuid NOT NULL,
  -- Draft IDs remain on existing messages or in the service result; the
  -- binding is frozen before create, then reused for update/revoke/lookup.
  operation_key_prefix text NOT NULL CHECK (length(operation_key_prefix) BETWEEN 1 AND 150),
  recovery_only boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (message_id,organization_id) REFERENCES public.messages (id,organization_id),
  FOREIGN KEY (binding_id,organization_id,owner_user_id,channel)
    REFERENCES public.communication_bindings (id,organization_id,owner_user_id,channel),
  UNIQUE (organization_id,owner_user_id,operation_key_prefix)
);

CREATE TABLE public.communication_reply_monitors (
  binding_id uuid NOT NULL,
  organization_id text NOT NULL,
  owner_user_id text NOT NULL,
  scope_digest text NOT NULL CHECK (scope_digest ~ '^[0-9a-f]{64}$'),
  encrypted_cursor text,
  cursor_key_version text,
  coverage_from timestamptz,
  coverage_through timestamptz,
  observed_at timestamptz,
  complete boolean NOT NULL DEFAULT false,
  initial_sync_complete boolean NOT NULL DEFAULT false,
  invalidated boolean NOT NULL DEFAULT true,
  last_attempt_at timestamptz,
  failure_code text,
  lease_token uuid,
  lease_until timestamptz,
  PRIMARY KEY (binding_id,scope_digest),
  FOREIGN KEY (binding_id,organization_id,owner_user_id)
    REFERENCES public.communication_bindings (id,organization_id,owner_user_id),
  CHECK ((encrypted_cursor IS NULL) = (cursor_key_version IS NULL)),
  CHECK (NOT complete OR (coverage_from IS NOT NULL AND coverage_through IS NOT NULL AND observed_at IS NOT NULL
    AND coverage_from <= coverage_through AND coverage_through <= observed_at))
);

-- Receipt insertion and existing cross-channel holds commit together before
-- acknowledging the service. No message body or raw webhook payload is stored.
CREATE TABLE public.communication_event_receipts (
  binding_id uuid NOT NULL,
  service_event_id text NOT NULL CHECK (length(service_event_id) BETWEEN 1 AND 200),
  organization_id text NOT NULL,
  owner_user_id text NOT NULL,
  event_type text NOT NULL CHECK (event_type IN ('message','receipt','account','email_change')),
  occurred_at timestamptz NOT NULL,
  processed_at timestamptz NOT NULL DEFAULT now(),
  result text NOT NULL CHECK (result IN ('processed','ignored','review')),
  PRIMARY KEY (binding_id,service_event_id),
  FOREIGN KEY (binding_id,organization_id,owner_user_id)
    REFERENCES public.communication_bindings (id,organization_id,owner_user_id)
);

CREATE FUNCTION public.communications_binding_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Recorded communication ownership and binding cannot be changed'; END $$;
REVOKE ALL ON FUNCTION public.communications_binding_immutable() FROM PUBLIC;
CREATE TRIGGER communications_binding_guard BEFORE UPDATE OR DELETE ON public.communication_bindings
  FOR EACH ROW EXECUTE FUNCTION public.communications_binding_immutable();
CREATE TRIGGER communications_enrolment_binding_guard BEFORE UPDATE OR DELETE ON public.campaign_channel_bindings
  FOR EACH ROW EXECUTE FUNCTION public.communications_binding_immutable();
CREATE TRIGGER communications_attempt_binding_guard BEFORE UPDATE OR DELETE ON public.campaign_attempt_bindings
  FOR EACH ROW EXECUTE FUNCTION public.communications_binding_immutable();
CREATE TRIGGER communications_draft_binding_guard BEFORE UPDATE OR DELETE ON public.outreach_draft_bindings
  FOR EACH ROW EXECUTE FUNCTION public.communications_binding_immutable();
CREATE TRIGGER communications_event_receipt_guard BEFORE UPDATE OR DELETE ON public.communication_event_receipts
  FOR EACH ROW EXECUTE FUNCTION public.communications_binding_immutable();

CREATE FUNCTION public.communications_monitor_scope_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF ROW(NEW.binding_id,NEW.organization_id,NEW.owner_user_id,NEW.scope_digest)
     IS DISTINCT FROM ROW(OLD.binding_id,OLD.organization_id,OLD.owner_user_id,OLD.scope_digest) THEN
    RAISE EXCEPTION 'Reply monitor binding/owner/query scope is immutable; create an invalidated new row';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.communications_monitor_scope_immutable() FROM PUBLIC;
CREATE TRIGGER communications_monitor_scope_guard BEFORE UPDATE ON public.communication_reply_monitors
  FOR EACH ROW EXECUTE FUNCTION public.communications_monitor_scope_immutable();

-- User role is entered with app.acquire_org/app.acquire_user by the existing
-- transaction helper. Membership is checked on every scoped read/write, not
-- captured in a FK that would prevent member revocation. Worker SELECT can
-- discover/reconcile work; it must re-enter the owner role before dispatch.

ALTER TABLE public.communication_bindings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.communication_bindings FORCE ROW LEVEL SECURITY;
CREATE POLICY communication_bindings_user ON public.communication_bindings TO acquire_campaign_user
  USING (organization_id = current_setting('app.acquire_org', true)
    AND owner_user_id = current_setting('app.acquire_user', true)
    AND EXISTS (SELECT 1 FROM public.member m WHERE m.organization_id = communication_bindings.organization_id AND m.user_id = communication_bindings.owner_user_id))
  WITH CHECK (organization_id = current_setting('app.acquire_org', true)
    AND owner_user_id = current_setting('app.acquire_user', true)
    AND EXISTS (SELECT 1 FROM public.member m WHERE m.organization_id = communication_bindings.organization_id AND m.user_id = communication_bindings.owner_user_id));
CREATE POLICY communication_bindings_worker_read ON public.communication_bindings FOR SELECT TO acquire_campaign_worker USING (true);
GRANT SELECT, INSERT ON public.communication_bindings TO acquire_campaign_user;
GRANT SELECT ON public.communication_bindings TO acquire_campaign_worker;

ALTER TABLE public.communication_defaults ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.communication_defaults FORCE ROW LEVEL SECURITY;
CREATE POLICY communication_defaults_user ON public.communication_defaults TO acquire_campaign_user
  USING (organization_id = current_setting('app.acquire_org', true)
    AND owner_user_id = current_setting('app.acquire_user', true)
    AND EXISTS (SELECT 1 FROM public.member m WHERE m.organization_id = communication_defaults.organization_id AND m.user_id = communication_defaults.owner_user_id))
  WITH CHECK (organization_id = current_setting('app.acquire_org', true)
    AND owner_user_id = current_setting('app.acquire_user', true)
    AND EXISTS (SELECT 1 FROM public.member m WHERE m.organization_id = communication_defaults.organization_id AND m.user_id = communication_defaults.owner_user_id));
CREATE POLICY communication_defaults_worker_read ON public.communication_defaults FOR SELECT TO acquire_campaign_worker USING (true);
GRANT SELECT, INSERT ON public.communication_defaults TO acquire_campaign_user;
GRANT SELECT ON public.communication_defaults TO acquire_campaign_worker;

ALTER TABLE public.campaign_channel_bindings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.campaign_channel_bindings FORCE ROW LEVEL SECURITY;
CREATE POLICY campaign_channel_bindings_user ON public.campaign_channel_bindings TO acquire_campaign_user
  USING (organization_id = current_setting('app.acquire_org', true)
    AND owner_user_id = current_setting('app.acquire_user', true)
    AND EXISTS (SELECT 1 FROM public.member m WHERE m.organization_id = campaign_channel_bindings.organization_id AND m.user_id = campaign_channel_bindings.owner_user_id))
  WITH CHECK (organization_id = current_setting('app.acquire_org', true)
    AND owner_user_id = current_setting('app.acquire_user', true)
    AND EXISTS (SELECT 1 FROM public.member m WHERE m.organization_id = campaign_channel_bindings.organization_id AND m.user_id = campaign_channel_bindings.owner_user_id));
CREATE POLICY campaign_channel_bindings_worker_read ON public.campaign_channel_bindings FOR SELECT TO acquire_campaign_worker USING (true);
GRANT SELECT, INSERT ON public.campaign_channel_bindings TO acquire_campaign_user;
GRANT SELECT ON public.campaign_channel_bindings TO acquire_campaign_worker;

ALTER TABLE public.campaign_attempt_bindings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.campaign_attempt_bindings FORCE ROW LEVEL SECURITY;
CREATE POLICY campaign_attempt_bindings_user ON public.campaign_attempt_bindings TO acquire_campaign_user
  USING (organization_id = current_setting('app.acquire_org', true)
    AND owner_user_id = current_setting('app.acquire_user', true)
    AND EXISTS (SELECT 1 FROM public.member m WHERE m.organization_id = campaign_attempt_bindings.organization_id AND m.user_id = campaign_attempt_bindings.owner_user_id))
  WITH CHECK (organization_id = current_setting('app.acquire_org', true)
    AND owner_user_id = current_setting('app.acquire_user', true)
    AND EXISTS (SELECT 1 FROM public.member m WHERE m.organization_id = campaign_attempt_bindings.organization_id AND m.user_id = campaign_attempt_bindings.owner_user_id));
CREATE POLICY campaign_attempt_bindings_worker_read ON public.campaign_attempt_bindings FOR SELECT TO acquire_campaign_worker USING (true);
GRANT SELECT, INSERT ON public.campaign_attempt_bindings TO acquire_campaign_user;
GRANT SELECT ON public.campaign_attempt_bindings TO acquire_campaign_worker;

ALTER TABLE public.outreach_draft_bindings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.outreach_draft_bindings FORCE ROW LEVEL SECURITY;
CREATE POLICY outreach_draft_bindings_user ON public.outreach_draft_bindings TO acquire_campaign_user
  USING (organization_id = current_setting('app.acquire_org', true)
    AND owner_user_id = current_setting('app.acquire_user', true)
    AND EXISTS (SELECT 1 FROM public.member m WHERE m.organization_id = outreach_draft_bindings.organization_id AND m.user_id = outreach_draft_bindings.owner_user_id))
  WITH CHECK (organization_id = current_setting('app.acquire_org', true)
    AND owner_user_id = current_setting('app.acquire_user', true)
    AND EXISTS (SELECT 1 FROM public.member m WHERE m.organization_id = outreach_draft_bindings.organization_id AND m.user_id = outreach_draft_bindings.owner_user_id));
CREATE POLICY outreach_draft_bindings_worker_read ON public.outreach_draft_bindings FOR SELECT TO acquire_campaign_worker USING (true);
GRANT SELECT, INSERT ON public.outreach_draft_bindings TO acquire_campaign_user;
GRANT SELECT ON public.outreach_draft_bindings TO acquire_campaign_worker;

ALTER TABLE public.communication_reply_monitors ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.communication_reply_monitors FORCE ROW LEVEL SECURITY;
CREATE POLICY communication_reply_monitors_user ON public.communication_reply_monitors TO acquire_campaign_user
  USING (organization_id = current_setting('app.acquire_org', true)
    AND owner_user_id = current_setting('app.acquire_user', true)
    AND EXISTS (SELECT 1 FROM public.member m WHERE m.organization_id = communication_reply_monitors.organization_id AND m.user_id = communication_reply_monitors.owner_user_id))
  WITH CHECK (organization_id = current_setting('app.acquire_org', true)
    AND owner_user_id = current_setting('app.acquire_user', true)
    AND EXISTS (SELECT 1 FROM public.member m WHERE m.organization_id = communication_reply_monitors.organization_id AND m.user_id = communication_reply_monitors.owner_user_id));
CREATE POLICY communication_reply_monitors_worker_read ON public.communication_reply_monitors FOR SELECT TO acquire_campaign_worker USING (true);
GRANT SELECT, INSERT ON public.communication_reply_monitors TO acquire_campaign_user;
GRANT SELECT ON public.communication_reply_monitors TO acquire_campaign_worker;

ALTER TABLE public.communication_event_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.communication_event_receipts FORCE ROW LEVEL SECURITY;
CREATE POLICY communication_event_receipts_user ON public.communication_event_receipts TO acquire_campaign_user
  USING (organization_id = current_setting('app.acquire_org', true)
    AND owner_user_id = current_setting('app.acquire_user', true)
    AND EXISTS (SELECT 1 FROM public.member m WHERE m.organization_id = communication_event_receipts.organization_id AND m.user_id = communication_event_receipts.owner_user_id))
  WITH CHECK (organization_id = current_setting('app.acquire_org', true)
    AND owner_user_id = current_setting('app.acquire_user', true)
    AND EXISTS (SELECT 1 FROM public.member m WHERE m.organization_id = communication_event_receipts.organization_id AND m.user_id = communication_event_receipts.owner_user_id));
CREATE POLICY communication_event_receipts_worker_read ON public.communication_event_receipts FOR SELECT TO acquire_campaign_worker USING (true);
GRANT SELECT, INSERT ON public.communication_event_receipts TO acquire_campaign_user;
GRANT SELECT ON public.communication_event_receipts TO acquire_campaign_worker;

GRANT UPDATE ON public.communication_defaults,public.communication_reply_monitors TO acquire_campaign_user;
-- No DELETE grants, no automatic defaults/backfills, no credential movement.
-- Existing legacy read/write paths remain usable until new code is activated.
COMMIT;
