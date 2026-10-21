-- PROPOSED ONLY. APP5437, NOT the sim5549 cluster. No application/startup hook.
-- Requires specific approval of this exact file/hash/target before application.
-- Supersedes the UNAPPLIED SQL126 acceleration proposal. This exception changes
-- only sending hours for exact current GUI-run mapped routes, not cold cadence.
-- Per-request five-second recipient scheduling is separate worker behavior.
-- Legacy send policy, acceleration predicates, reminders, authority, quotas,
-- real leases, review/hold/opt-out guards and channel policy remain unchanged.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='15s';


DO $guard$
DECLARE p pg_catalog.pg_proc%ROWTYPE;expected record;
BEGIN
 IF current_database() IS DISTINCT FROM 'acquire_agent_mode'
 OR shobj_description((SELECT oid FROM pg_database WHERE datname=current_database()),'pg_database') IS DISTINCT FROM 'acquire-agent-mode-local-only'
 OR (SELECT system_identifier::text FROM pg_control_system()) IS DISTINCT FROM '7697400069962248225'
 OR current_user IS DISTINCT FROM 'project_acquire' OR session_user IS DISTINCT FROM 'project_acquire'
 THEN RAISE EXCEPTION 'Exact approved isolated APP5437 database owner required';END IF;
 IF (SELECT sha256 FROM public.agent_local_migrations WHERE name='125-app5437-gui-wall-clock-run.proposed.sql') IS DISTINCT FROM 'bb7aca752ab4f2b31988729797c2f87d96a65a2e9ac356c2041fbcff4cfe2d6c'
 OR EXISTS(SELECT 1 FROM public.agent_local_migrations WHERE name='126-app5437-gui-testing-acceleration.proposed.sql')
 THEN RAISE EXCEPTION 'SQL125 required; superseded SQL126 must be unapplied';END IF;
 IF to_regprocedure('public.agent_gui_testing_send_window_exempt(uuid)') IS NOT NULL THEN RAISE EXCEPTION 'New helper must be absent';END IF;
 FOR expected IN SELECT * FROM (VALUES
   ('public.agent_channel_local_binding(uuid)','3c86bed205a096a517fdf2297fcf114ba66eb1b1f45921749355a198c574646d',true,'s','plpgsql'),
   ('public.agent_channel_operation_before_invitations(uuid)','668638229780bad9d7b93a249f5d032debfb76d47ba9be6df72dceea7c00a537',true,'v','plpgsql'),
   ('public.agent_channel_reserved_recipient(text,text)','e935e46c9e95d732ab3fa6a7a4e9b99a776e1c4c638a60c3b45f555187289370',false,'i','sql'),
   ('public.agent_demo_run_bindings_match(text,text,text,text,text,jsonb)','1826989529b1de05a1d9c00b2549461e1ce7d7a22cf04a024d811f10319db744',true,'v','plpgsql'),
   ('public.agent_demo_runtime_ready(uuid)','a1165251184c4b7a5eb7c34720188aa9fd4a9ee1bb30eb82d17e2a3abf9a0b28',true,'s','plpgsql'),
   ('public.agent_invitation_before_company_projection(uuid)','9245fdd68921fdf1b21eec4e5a2560ff7d8b6be42b9ec1095c49dd1cb06316cf',true,'v','plpgsql'),
   ('public.agent_native_sending_policy(uuid)','72d367e5aed878e1e7919e121bcc7cd4164f518e8cc7d9c6756810dd19f25a93',true,'v','plpgsql')
 ) AS specs(signature,body_sha,security_definer,volatility,language_name) LOOP
  SELECT * INTO p FROM pg_catalog.pg_proc WHERE oid=to_regprocedure(expected.signature);
  IF p.oid IS NULL OR encode(sha256(convert_to(p.prosrc,'UTF8')),'hex') IS DISTINCT FROM expected.body_sha
  OR pg_get_userbyid(p.proowner) IS DISTINCT FROM 'project_acquire'
  OR p.prosecdef IS DISTINCT FROM expected.security_definer OR p.provolatile::text IS DISTINCT FROM expected.volatility
  OR p.proacl::text IS DISTINCT FROM '{project_acquire=X/project_acquire}'
  OR p.proconfig IS DISTINCT FROM ARRAY['search_path=pg_catalog, public']::text[]
  OR p.prorettype IS DISTINCT FROM 'boolean'::regtype OR p.prolang IS DISTINCT FROM (SELECT oid FROM pg_language WHERE lanname=expected.language_name)
  THEN RAISE EXCEPTION 'Exact reviewed function body and authority required: %',expected.signature;END IF;
 END LOOP;
 
END $guard$;

CREATE FUNCTION public.agent_gui_testing_send_window_exempt(p_route uuid)
 RETURNS boolean LANGUAGE plpgsql VOLATILE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE org text:=current_setting('app.acquire_org',true);actor text:=current_setting('app.acquire_user',true);
BEGIN
 IF current_database() IS DISTINCT FROM 'acquire_agent_mode'
 OR shobj_description((SELECT oid FROM pg_database WHERE datname=current_database()),'pg_database') IS DISTINCT FROM 'acquire-agent-mode-local-only'
 OR (SELECT system_identifier::text FROM pg_control_system()) IS DISTINCT FROM '7697400069962248225'
 OR current_setting('role',true) NOT IN('acquire_agent_user','acquire_campaign_user')
 OR current_setting('app.acquire_channel_simulation',true) IS DISTINCT FROM 'true'
 OR current_setting('app.acquire_runtime_id',true) IS DISTINCT FROM 'agent-multichannel-20261017'
 OR org IS DISTINCT FROM 'm8qeFHRPVOUAgbBRq3sOFGXo3XE2aYFo'
 OR actor IS DISTINCT FROM 'yJPrXFrkU8VWyiX47yRUAv6lIaGvyMSk' THEN RETURN false;END IF;
 RETURN EXISTS(
 SELECT 1 FROM public.agent_conversation_channels r
 JOIN public.agent_conversations c ON c.id=r.conversation_id AND c.thread_id=r.thread_id AND c.mandate_id=r.mandate_id AND c.organization_id=org AND c.owner_user_id=actor
 JOIN public.agent_threads t ON t.id=c.thread_id AND t.mandate_id=c.mandate_id AND t.organization_id=org AND t.owner_user_id=actor
 JOIN public.mandates mandate ON mandate.id=c.mandate_id AND mandate.organization_id=org
 JOIN public.agent_demo_contact_mappings mapping ON mapping.contact_id=c.contact_id AND mapping.mandate_id=c.mandate_id AND mapping.organization_id=org AND mapping.created_by=actor
 JOIN public.agent_demo_runs run ON mapping.demo_run_id=run.id AND run.organization_id=org AND run.owner_user_id=actor
 JOIN LATERAL jsonb_array_elements(run.senders) sender ON sender->>'bindingId'=r.binding_id::text AND sender->>'bindingDigest'=r.binding_digest AND sender->>'channel'=r.channel
 WHERE r.id=p_route AND r.organization_id=org AND r.owner_user_id=actor AND c.delivery_mode='communications'
 AND run.run_id='agent-deep-gui-20261020' AND run.integration_id='sim-agent-deep-gui-20261020' AND run.configuration_ref='sim-agent-deep-gui-20261020-v1'
 AND public.agent_demo_run_bindings_match(run.organization_id,run.owner_user_id,run.run_id,run.integration_id,run.configuration_ref,run.senders)
 AND mapping.wire->>'email'~'^lead-[0-9]{3}@agent-deep-gui-20261020[.]leads[.]acquire[.]test$'
 AND mapping.wire->>'phone'~'^[+]999[0-9]{12}$'
 AND mapping.wire->>'linkedin'~'^https://www[.]linkedin[.]com/in/sim-agent-deep-gui-20261020-lead-[0-9]{3}$'
 AND CASE r.channel
  WHEN 'email' THEN r.recipient_kind='email' AND r.recipient_value=mapping.wire->>'email'
  WHEN 'whatsapp' THEN r.recipient_kind='phone' AND r.recipient_value=mapping.wire->>'phone'
  WHEN 'linkedin' THEN r.recipient_kind='linkedin_profile' AND r.recipient_value=mapping.wire->>'linkedin'
  ELSE false END);
END $function$;
REVOKE ALL ON FUNCTION public.agent_gui_testing_send_window_exempt(uuid) FROM PUBLIC,acquire_campaign_user;
GRANT EXECUTE ON FUNCTION public.agent_gui_testing_send_window_exempt(uuid) TO acquire_agent_user;

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
 IF NOT p.accelerated_simulation AND NOT public.agent_email_window_open(public.local_simulator_business_now()) AND NOT public.agent_gui_testing_send_window_exempt(r.id) THEN RETURN false;END IF;
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
END $function$;

CREATE OR REPLACE FUNCTION public.agent_invitation_before_company_projection(p_operation uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE org text:=current_setting('app.acquire_org',true);actor text:=current_setting('app.acquire_user',true);o public.agent_operations%ROWTYPE;c public.agent_conversations%ROWTYPE;r public.agent_conversation_channels%ROWTYPE;p public.agent_channel_policies%ROWTYPE;a public.agent_authority_uses%ROWTYPE;b public.agent_review_batches%ROWTYPE;stage text;kind text;latest_in jsonb;aliases uuid[];
BEGIN
 IF current_setting('role',true) NOT IN('acquire_agent_user','acquire_campaign_user') OR NOT EXISTS(SELECT 1 FROM public.member WHERE organization_id=org AND user_id=actor) OR NOT EXISTS(SELECT 1 FROM public.communication_send_gates WHERE organization_id=org AND writer_xid=txid_current()) THEN RAISE EXCEPTION 'Held current routed authority required';END IF;
 SELECT * INTO o FROM public.agent_operations WHERE id=p_operation AND organization_id=org AND owner_user_id=actor;
 IF o.id IS NULL OR o.state<>'running' OR o.lease_until IS NULL OR o.lease_until<=clock_timestamp() OR NOT o.input ? 'routeId' OR coalesce(o.input->>'routeId','')!~'^[a-f0-9-]{36}$' THEN RETURN false;END IF;
 SELECT * INTO r FROM public.agent_conversation_channels WHERE id=(o.input->>'routeId')::uuid AND conversation_id=o.conversation_id AND thread_id=o.thread_id AND organization_id=org AND owner_user_id=actor;
 SELECT * INTO c FROM public.agent_conversations WHERE id=r.conversation_id AND organization_id=org AND owner_user_id=actor;
 SELECT * INTO p FROM public.agent_channel_policies WHERE thread_id=c.thread_id;
 IF c.id IS NOT NULL THEN PERFORM public.agent_load_mandate_execution_context(jsonb_build_object('kind','agent','operationId',o.id),org,actor);END IF;
 stage:=split_part(o.name,'.',2);kind:=stage||'_'||r.channel;
 IF r.id IS NULL OR c.id IS NULL OR p.thread_id IS NULL OR o.name<>r.channel||'.'||stage OR stage IS DISTINCT FROM 'invitation' OR r.channel<>'linkedin' OR o.input->'requiresHumanReview' IS DISTINCT FROM 'true'::jsonb OR c.delivery_mode<>'communications'
 OR o.input->>'bindingDigest' IS DISTINCT FROM r.binding_digest OR o.input->>'identityRevision' IS DISTINCT FROM r.identity_revision OR o.input->>'policyRevision' IS DISTINCT FROM p.revision::text OR o.input->>'routeHistoryRevision' IS DISTINCT FROM r.history_revision
 OR o.input->>'recipientKey' IS DISTINCT FROM r.channel||':'||r.recipient_value OR o.input->>'contextRevision' IS DISTINCT FROM public.agent_context_revision(c.id) OR o.input->>'epoch' IS DISTINCT FROM c.epoch::text
 OR o.input->>'kind' IS DISTINCT FROM kind OR coalesce(o.input->>'body','')='' OR length(o.input->>'body')>300 OR (o.input->>'body')~*'(https?://|www[.]|calendly|cal[.]com)' OR o.input->>'intent' IN('meeting_ready','opt_out','uncertain')
 OR r.channel<>'email' AND o.input->>'subject' IS DISTINCT FROM '' OR r.channel='email' AND coalesce(o.input->>'subject','')='' OR NOT public.agent_channel_proposal_before_invitations(r.id,'initial') THEN RETURN false;END IF;
 -- Admission validates this already-running exact HIL operation. Proposal-time
 -- duplicate checks still reject every running invitation, including this one.
 IF NOT EXISTS(SELECT 1 FROM public.agent_linkedin_relationships relationship WHERE relationship.route_id=r.id AND relationship.binding_digest=r.binding_digest AND relationship.identity_revision=r.identity_revision AND relationship.status='not_connected' AND relationship.can_message IS NOT TRUE AND relationship.observed_at<=public.local_simulator_business_now() AND relationship.observed_at>=public.local_simulator_business_now()-interval '5 minutes')
 OR EXISTS(SELECT 1 FROM public.agent_linkedin_invitations invitation WHERE invitation.route_id=r.id AND invitation.state IN('unknown','pending','accepted'))
 OR EXISTS(SELECT 1 FROM public.agent_operations other WHERE other.conversation_id=r.conversation_id AND other.name='linkedin.invitation' AND other.id<>o.id AND other.state IN('running','uncertain','complete')) THEN RETURN false;END IF;
 IF NOT p.accelerated_simulation AND NOT public.agent_email_window_open(public.local_simulator_business_now()) AND NOT public.agent_gui_testing_send_window_exempt(r.id) THEN RETURN false;END IF;
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
 IF EXISTS(SELECT 1 FROM public.campaign_reply_holds h WHERE h.organization_id=org AND h.contact_id=ANY(aliases) AND (stage IN('initial','invitation') OR h.reason<>'reply_received' OR latest_in IS NULL OR h.received_at>(latest_in->>'at')::timestamptz))
 OR EXISTS(SELECT 1 FROM public.campaign_contact_holds h WHERE h.organization_id=org AND EXISTS(SELECT 1 FROM public.contacts x WHERE x.id=ANY(aliases) AND lower(x.personal_data->>'email')=lower(h.email)) AND (stage IN('initial','invitation') OR h.reason<>'reply_received' OR latest_in IS NULL)) THEN RETURN false;END IF;
 SELECT * INTO a FROM public.agent_authority_uses WHERE operation_id=o.id AND organization_id=org AND owner_user_id=actor;
 IF a.operation_id IS NULL OR a.state<>'reserved' OR a.operation_revision<>o.revision OR a.operation_fence<>o.fence OR a.operation_digest<>o.input_digest OR a.context_revision IS DISTINCT FROM o.input->>'contextRevision' OR a.binding_digest IS DISTINCT FROM r.binding_digest THEN RETURN false;END IF;
 IF a.grant_id IS NOT NULL OR a.review_batch_id IS NULL THEN RETURN false;END IF;
 SELECT * INTO b FROM public.agent_review_batches WHERE id=a.review_batch_id AND thread_id=o.thread_id AND organization_id=org AND owner_user_id=actor;
 IF b.id IS NULL OR b.state<>'approved' OR NOT b.manifest @> jsonb_build_array(jsonb_build_object('operationId',o.id,'revision',o.revision,'digest',o.input_digest,'contextRevision',o.input->>'contextRevision')) THEN RETURN false;END IF;
 IF (SELECT count(*) FROM public.agent_budget_reservations WHERE operation_id=o.id)<>4 THEN RETURN false;END IF;
 RETURN (SELECT count(DISTINCT x.scope_key)=4 FROM public.agent_budget_reservations z JOIN public.agent_budget_accounts x ON x.id=z.account_id AND x.organization_id=z.organization_id WHERE z.operation_id=o.id AND z.organization_id=org AND z.state='reserved' AND z.amount=1 AND x.unit='sends' AND x.scope_key=ANY(ARRAY['organization:sends','user:'||actor||':sends','mandate:'||c.mandate_id::text||':sends','binding:'||r.binding_digest||':sends']) AND x.window_start<=clock_timestamp() AND x.window_end>clock_timestamp() AND x.spent+x.reserved<=x.cap);
END $function$;

DO $readback$
DECLARE p pg_catalog.pg_proc%ROWTYPE;expected record;
BEGIN
 IF current_database() IS DISTINCT FROM 'acquire_agent_mode'
 OR shobj_description((SELECT oid FROM pg_database WHERE datname=current_database()),'pg_database') IS DISTINCT FROM 'acquire-agent-mode-local-only'
 OR (SELECT system_identifier::text FROM pg_control_system()) IS DISTINCT FROM '7697400069962248225'
 OR current_user IS DISTINCT FROM 'project_acquire' OR session_user IS DISTINCT FROM 'project_acquire'
 THEN RAISE EXCEPTION 'Exact approved isolated APP5437 database owner required';END IF;
 IF (SELECT sha256 FROM public.agent_local_migrations WHERE name='125-app5437-gui-wall-clock-run.proposed.sql') IS DISTINCT FROM 'bb7aca752ab4f2b31988729797c2f87d96a65a2e9ac356c2041fbcff4cfe2d6c'
 OR EXISTS(SELECT 1 FROM public.agent_local_migrations WHERE name='126-app5437-gui-testing-acceleration.proposed.sql')
 THEN RAISE EXCEPTION 'SQL125 required; superseded SQL126 must be unapplied';END IF;
 
 FOR expected IN SELECT * FROM (VALUES
   ('public.agent_channel_local_binding(uuid)','3c86bed205a096a517fdf2297fcf114ba66eb1b1f45921749355a198c574646d',true,'s','plpgsql'),
   ('public.agent_channel_operation_before_invitations(uuid)','079e9d3c61de7bcf601b25e09b3391b1ed0cebf5e0df8123c0d8532ec4535d58',true,'v','plpgsql'),
   ('public.agent_channel_reserved_recipient(text,text)','e935e46c9e95d732ab3fa6a7a4e9b99a776e1c4c638a60c3b45f555187289370',false,'i','sql'),
   ('public.agent_demo_run_bindings_match(text,text,text,text,text,jsonb)','1826989529b1de05a1d9c00b2549461e1ce7d7a22cf04a024d811f10319db744',true,'v','plpgsql'),
   ('public.agent_demo_runtime_ready(uuid)','a1165251184c4b7a5eb7c34720188aa9fd4a9ee1bb30eb82d17e2a3abf9a0b28',true,'s','plpgsql'),
   ('public.agent_invitation_before_company_projection(uuid)','3ddf6a1fb4c2c26185cd7e95479a5c20ae9f1b8b21ef526470208d2523ccab8d',true,'v','plpgsql'),
   ('public.agent_native_sending_policy(uuid)','72d367e5aed878e1e7919e121bcc7cd4164f518e8cc7d9c6756810dd19f25a93',true,'v','plpgsql')
 ) AS specs(signature,body_sha,security_definer,volatility,language_name) LOOP
  SELECT * INTO p FROM pg_catalog.pg_proc WHERE oid=to_regprocedure(expected.signature);
  IF p.oid IS NULL OR encode(sha256(convert_to(p.prosrc,'UTF8')),'hex') IS DISTINCT FROM expected.body_sha
  OR pg_get_userbyid(p.proowner) IS DISTINCT FROM 'project_acquire'
  OR p.prosecdef IS DISTINCT FROM expected.security_definer OR p.provolatile::text IS DISTINCT FROM expected.volatility
  OR p.proacl::text IS DISTINCT FROM '{project_acquire=X/project_acquire}'
  OR p.proconfig IS DISTINCT FROM ARRAY['search_path=pg_catalog, public']::text[]
  OR p.prorettype IS DISTINCT FROM 'boolean'::regtype OR p.prolang IS DISTINCT FROM (SELECT oid FROM pg_language WHERE lanname=expected.language_name)
  THEN RAISE EXCEPTION 'Exact reviewed function body and authority required: %',expected.signature;END IF;
 END LOOP;
 SELECT * INTO p FROM pg_catalog.pg_proc WHERE oid=to_regprocedure('public.agent_gui_testing_send_window_exempt(uuid)');
 IF p.oid IS NULL OR encode(sha256(convert_to(p.prosrc,'UTF8')),'hex') IS DISTINCT FROM '0593365ee1bc868678a69b483470784d071fe52313df4b4e7871a9fa0533f992'
 OR pg_get_userbyid(p.proowner) IS DISTINCT FROM 'project_acquire' OR NOT p.prosecdef OR p.provolatile IS DISTINCT FROM 'v'
 OR p.proconfig IS DISTINCT FROM ARRAY['search_path=pg_catalog, public']::text[]
 OR p.prorettype IS DISTINCT FROM 'boolean'::regtype OR p.prolang IS DISTINCT FROM (SELECT oid FROM pg_language WHERE lanname='plpgsql')
 OR p.proacl::text IS DISTINCT FROM '{project_acquire=X/project_acquire,acquire_agent_user=X/project_acquire}'
 THEN RAISE EXCEPTION 'Exact new scoped helper body/owner/ACL required';END IF;
END $readback$;

COMMIT;
