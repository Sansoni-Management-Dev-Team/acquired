-- One immutable authority use consumes one delegated send, in the same TX.
CREATE FUNCTION agent_consume_delegation() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE op public.agent_operations%ROWTYPE;conv public.agent_conversations%ROWTYPE;kind text;
BEGIN
 IF NEW.grant_id IS NULL THEN RETURN NEW; END IF;
 PERFORM public.agent_assert_control_scope();
 SELECT * INTO op FROM public.agent_operations WHERE id=NEW.operation_id AND thread_id=NEW.thread_id AND organization_id=NEW.organization_id AND owner_user_id=NEW.owner_user_id;
 SELECT * INTO conv FROM public.agent_conversations WHERE id=NEW.conversation_id AND thread_id=NEW.thread_id;
 kind:=CASE op.name WHEN 'email.initial' THEN 'initial_email' WHEN 'email.reply' THEN 'reply_email' WHEN 'email.follow_up' THEN 'follow_up_email' ELSE NULL END;
 IF kind IS NULL OR op.state<>'running' OR op.fence<>NEW.operation_fence OR op.revision<>NEW.operation_revision OR op.input_digest<>NEW.operation_digest OR NEW.state<>'reserved' OR conv.binding_digest IS DISTINCT FROM NEW.binding_digest THEN RAISE EXCEPTION 'Current delegated operation required'; END IF;
 UPDATE public.agent_authority_grants SET used_sends=used_sends+1
 WHERE id=NEW.grant_id AND thread_id=NEW.thread_id AND organization_id=NEW.organization_id AND owner_user_id=NEW.owner_user_id
 AND revision=NEW.grant_revision AND revoked_at IS NULL AND expires_at>clock_timestamp() AND approved_at<=clock_timestamp()
 AND used_sends<max_sends AND binding_digest=conv.binding_digest AND actions ? kind AND recipient_keys ? ('email:'||conv.recipient_email);
 IF NOT FOUND THEN RAISE EXCEPTION 'Delegated grant expired, revoked, changed or at cap'; END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION agent_consume_delegation() FROM PUBLIC;
CREATE TRIGGER agent_consume_delegation AFTER INSERT ON agent_authority_uses FOR EACH ROW EXECUTE FUNCTION agent_consume_delegation();

CREATE FUNCTION agent_grant_immutable_scope() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
 IF ROW(NEW.id,NEW.thread_id,NEW.organization_id,NEW.mandate_id,NEW.owner_user_id,NEW.channel,NEW.actions,NEW.recipient_keys,NEW.binding_digest,NEW.max_sends,NEW.expires_at,NEW.approved_by,NEW.approved_at)
 IS DISTINCT FROM ROW(OLD.id,OLD.thread_id,OLD.organization_id,OLD.mandate_id,OLD.owner_user_id,OLD.channel,OLD.actions,OLD.recipient_keys,OLD.binding_digest,OLD.max_sends,OLD.expires_at,OLD.approved_by,OLD.approved_at) THEN RAISE EXCEPTION 'Grant scope is immutable; approve a new grant'; END IF;
 IF NEW.used_sends<>OLD.used_sends THEN
  IF pg_trigger_depth()<2 OR NEW.used_sends<>OLD.used_sends+1 OR NEW.revision<>OLD.revision OR NEW.revoked_at IS DISTINCT FROM OLD.revoked_at THEN RAISE EXCEPTION 'Only an atomic authority use can consume a grant'; END IF;
 ELSIF NOT(OLD.revoked_at IS NULL AND NEW.revoked_at IS NOT NULL AND NEW.revision=OLD.revision+1) THEN
  RAISE EXCEPTION 'Only explicit revocation can change a grant';
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION agent_grant_immutable_scope() FROM PUBLIC;
CREATE TRIGGER agent_grant_immutable_scope BEFORE UPDATE ON agent_authority_grants FOR EACH ROW EXECUTE FUNCTION agent_grant_immutable_scope();

CREATE FUNCTION agent_authority_use_immutable() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
 IF ROW(NEW.operation_id,NEW.conversation_id,NEW.organization_id,NEW.mandate_id,NEW.owner_user_id,NEW.thread_id,NEW.grant_id,NEW.grant_revision,NEW.review_batch_id,NEW.operation_revision,NEW.operation_fence,NEW.operation_digest,NEW.context_revision,NEW.binding_digest)
 IS DISTINCT FROM ROW(OLD.operation_id,OLD.conversation_id,OLD.organization_id,OLD.mandate_id,OLD.owner_user_id,OLD.thread_id,OLD.grant_id,OLD.grant_revision,OLD.review_batch_id,OLD.operation_revision,OLD.operation_fence,OLD.operation_digest,OLD.context_revision,OLD.binding_digest) THEN RAISE EXCEPTION 'Recorded authority cannot be substituted'; END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION agent_authority_use_immutable() FROM PUBLIC;
CREATE TRIGGER agent_authority_use_immutable BEFORE UPDATE ON agent_authority_uses FOR EACH ROW EXECUTE FUNCTION agent_authority_use_immutable();

-- Use the existing sequence product's weekday 09:00–17:00 Melbourne default.
-- A local sink is explicitly a simulation; real-account admission never skips it.
CREATE FUNCTION agent_email_window_open(at_time timestamptz) RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,public AS $$
 SELECT extract(isodow FROM at_time AT TIME ZONE 'Australia/Melbourne') BETWEEN 1 AND 5
 AND extract(hour FROM at_time AT TIME ZONE 'Australia/Melbourne')>=9
 AND extract(hour FROM at_time AT TIME ZONE 'Australia/Melbourne')<17;
$$;
REVOKE ALL ON FUNCTION agent_email_window_open(timestamptz) FROM PUBLIC;
CREATE FUNCTION agent_native_sending_policy(operation uuid) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE op public.agent_operations%ROWTYPE;conv public.agent_conversations%ROWTYPE;inbound_at timestamptz;outbound_at timestamptz;
BEGIN
 SELECT * INTO op FROM public.agent_operations WHERE id=operation AND organization_id=current_setting('app.acquire_org',true) AND owner_user_id=current_setting('app.acquire_user',true);
 IF op.id IS NULL THEN RETURN false; END IF;
 IF op.name='email.manual_link' THEN RETURN true; END IF;
 SELECT * INTO conv FROM public.agent_conversations WHERE id=op.conversation_id AND thread_id=op.thread_id;
 IF conv.id IS NULL OR (conv.delivery_mode<>'local_sink' AND NOT public.agent_email_window_open(clock_timestamp())) THEN RETURN false; END IF;
 SELECT max((value->>'at')::timestamptz) FILTER(WHERE value->>'direction'='inbound'),max((value->>'at')::timestamptz) FILTER(WHERE value->>'direction'='outbound') INTO inbound_at,outbound_at FROM jsonb_array_elements(conv.history);
 IF op.name='email.initial' THEN RETURN jsonb_array_length(conv.history)=0;
 ELSIF op.name='email.reply' THEN RETURN inbound_at IS NOT NULL AND (outbound_at IS NULL OR inbound_at>outbound_at);
 ELSIF op.name='email.follow_up' THEN RETURN outbound_at IS NOT NULL AND outbound_at<=clock_timestamp()-interval '24 hours' AND (inbound_at IS NULL OR inbound_at<outbound_at);
 END IF;
 RETURN false;
END $$;
REVOKE ALL ON FUNCTION agent_native_sending_policy(uuid) FROM PUBLIC;
ALTER FUNCTION agent_operation_authorised(uuid) RENAME TO agent_operation_authorised_before_sending_policy;
REVOKE ALL ON FUNCTION agent_operation_authorised_before_sending_policy(uuid) FROM PUBLIC,acquire_agent_user,acquire_campaign_user;
CREATE FUNCTION agent_operation_authorised(operation uuid) RETURNS boolean LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT public.agent_operation_authorised_before_sending_policy(operation) AND public.agent_native_sending_policy(operation);
$$;
REVOKE ALL ON FUNCTION agent_operation_authorised(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION agent_operation_authorised(uuid) TO acquire_agent_user,acquire_campaign_user;
