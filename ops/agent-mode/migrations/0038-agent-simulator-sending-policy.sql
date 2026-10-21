-- Exact isolated25lead simulator only. No rows/permissions/sends are seeded.
-- Operator provisions an exact original binding after separately verifying its profile.
DO $$ BEGIN
 IF current_database()<>'acquire_agent_mode' OR (SELECT shobj_description(oid,'pg_database') FROM pg_database WHERE datname=current_database()) IS DISTINCT FROM 'acquire-agent-mode-local-only' THEN RAISE EXCEPTION 'Exact marked isolated agent database required'; END IF;
END $$;
CREATE TABLE public.agent_simulator_test_policies(
 mandate_id uuid PRIMARY KEY CHECK(mandate_id='e7da3f8c-8c45-4aef-bac4-392b918e0025'::uuid),
 organization_id text NOT NULL,
 owner_user_id text NOT NULL,
 binding_id uuid NOT NULL,
 binding_digest text NOT NULL CHECK(binding_digest~'^[a-f0-9]{64}$'),
 channel text NOT NULL CHECK(channel='email'),
 integration_id text NOT NULL CHECK(integration_id='sim-agent-conversations-25-20261017'),
 recipient_domain text NOT NULL CHECK(recipient_domain='agent-conversations-25-20261017.leads.acquire.test'),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 expires_at timestamptz NOT NULL,
 CHECK(expires_at>created_at AND expires_at<=created_at+interval '6 hours'),
 FOREIGN KEY(binding_id,organization_id,owner_user_id,channel) REFERENCES public.communication_bindings(id,organization_id,owner_user_id,channel),
 FOREIGN KEY(mandate_id) REFERENCES public.mandates(id)
);
ALTER TABLE public.agent_simulator_test_policies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_simulator_test_policies FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.agent_simulator_test_policies FROM PUBLIC,acquire_agent_user,acquire_agent_worker,acquire_campaign_user,communications_control,communications_scoped;
-- There are deliberately no runtime RLS policies or DML grants. Only the local
-- database operator can create/revoke the short-lived, exact policy.
CREATE FUNCTION public.agent_simulator_window_exception(mandate uuid,binding uuid,binding_hash text,recipient text,at_time timestamptz)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT current_database()='acquire_agent_mode'
 AND (SELECT shobj_description(oid,'pg_database') FROM pg_database WHERE datname=current_database()) IS NOT DISTINCT FROM 'acquire-agent-mode-local-only'
 AND EXISTS(SELECT 1 FROM public.agent_simulator_test_policies p
 JOIN public.communication_bindings b ON b.id=p.binding_id AND b.organization_id=p.organization_id AND b.owner_user_id=p.owner_user_id AND b.channel=p.channel
 JOIN communications.connections c ON c.id=b.service_connection_id AND c.application_id=b.application_id AND c.tenant_id=b.organization_id AND c.owner_id=b.owner_user_id AND c.account_id=b.service_account_id AND c.current_generation=b.generation AND c.channel='email' AND c.platform=b.platform AND c.backend='unipile' AND c.active AND c.status='connected'
 JOIN communications.connection_generations g ON g.connection_id=c.id AND g.generation=c.current_generation AND g.integration_id=p.integration_id AND g.provider_configuration_reference=p.integration_id||'-v1' AND g.provider_api_version='v1' AND g.authority='service'
 WHERE p.mandate_id=mandate AND p.binding_id=binding AND p.binding_digest=binding_hash
 AND p.organization_id=current_setting('app.acquire_org',true) AND p.owner_user_id=current_setting('app.acquire_user',true)
 AND b.application_id='acquire' AND b.backend='unipile' AND b.authority='service' AND b.channel='email'
 AND recipient=lower(recipient) AND split_part(recipient,'@',1)<>'' AND split_part(recipient,'@',2)=p.recipient_domain AND length(recipient)-length(replace(recipient,'@',''))=1
 AND p.created_at<=at_time AND p.expires_at>at_time AND p.expires_at>clock_timestamp());
$$;
REVOKE ALL ON FUNCTION public.agent_simulator_window_exception(uuid,uuid,text,text,timestamptz) FROM PUBLIC;
-- The original0012 admission/cadence code is unchanged except its window clause.
CREATE OR REPLACE FUNCTION agent_native_sending_policy(operation uuid) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE op public.agent_operations%ROWTYPE;conv public.agent_conversations%ROWTYPE;inbound_at timestamptz;outbound_at timestamptz;
BEGIN
 SELECT * INTO op FROM public.agent_operations WHERE id=operation AND organization_id=current_setting('app.acquire_org',true) AND owner_user_id=current_setting('app.acquire_user',true);
 IF op.id IS NULL THEN RETURN false; END IF;
 IF op.name='email.manual_link' THEN RETURN true; END IF;
 SELECT * INTO conv FROM public.agent_conversations WHERE id=op.conversation_id AND thread_id=op.thread_id;
 IF conv.id IS NULL OR (conv.delivery_mode<>'local_sink' AND NOT public.agent_email_window_open(clock_timestamp()) AND NOT public.agent_simulator_window_exception(conv.mandate_id,conv.binding_id,conv.binding_digest,conv.recipient_email,clock_timestamp())) THEN RETURN false; END IF;
 SELECT max((value->>'at')::timestamptz) FILTER(WHERE value->>'direction'='inbound'),max((value->>'at')::timestamptz) FILTER(WHERE value->>'direction'='outbound') INTO inbound_at,outbound_at FROM jsonb_array_elements(conv.history);
 IF op.name='email.initial' THEN RETURN jsonb_array_length(conv.history)=0;
 ELSIF op.name='email.reply' THEN RETURN inbound_at IS NOT NULL AND (outbound_at IS NULL OR inbound_at>outbound_at);
 ELSIF op.name='email.follow_up' THEN RETURN outbound_at IS NOT NULL AND outbound_at<=clock_timestamp()-interval '24 hours' AND (inbound_at IS NULL OR inbound_at<outbound_at);
 END IF;
 RETURN false;
END $$;
REVOKE ALL ON FUNCTION agent_native_sending_policy(uuid) FROM PUBLIC;
