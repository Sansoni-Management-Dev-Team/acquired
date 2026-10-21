-- Deterministic content fingerprint only, not permission or identity proof.
CREATE FUNCTION public.agent_email_reply_parent(history jsonb) RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,public AS $$
 SELECT jsonb_build_object('id',message->>'id','contentDigest',encode(sha256(convert_to(COALESCE(message->>'subject','')||E'\n'||(message->>'text'),'UTF8')),'hex')) FROM jsonb_array_elements(history) message WHERE message->>'id' IS NOT NULL AND message->>'text' IS NOT NULL ORDER BY (message->>'direction'='inbound') DESC,(message->>'at')::timestamptz DESC,message->>'id' DESC LIMIT 1;
$$;
REVOKE ALL ON FUNCTION public.agent_email_reply_parent(jsonb) FROM PUBLIC;
-- Preserve0013's admission and all subsequent current authorization guards.
-- Reply parent derives only from the verified saved history bound by the exact
-- operation context/review, and is re-read from the original provider account.
ALTER FUNCTION public.agent_communications_source(uuid,uuid,bigint,bigint,uuid) RENAME TO agent_communications_source_before_reply_parent;
REVOKE ALL ON FUNCTION public.agent_communications_source_before_reply_parent(uuid,uuid,bigint,bigint,uuid) FROM PUBLIC,acquire_campaign_user;
CREATE FUNCTION public.agent_communications_source(operation uuid,conversation uuid,expected_epoch bigint,expected_fence bigint,binding uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE proof jsonb;op public.agent_operations%ROWTYPE;parent jsonb;
BEGIN
 proof:=public.agent_communications_source_before_reply_parent(operation,conversation,expected_epoch,expected_fence,binding);
 IF proof IS NULL THEN RETURN NULL; END IF;
 SELECT * INTO STRICT op FROM public.agent_operations WHERE id=operation;
 IF op.name='email.initial' THEN RETURN proof||jsonb_build_object('replyParent',NULL); END IF;
 SELECT public.agent_email_reply_parent(c.history) INTO parent FROM public.agent_conversations c WHERE c.id=conversation;
 IF parent IS NULL THEN RETURN NULL; END IF;
 RETURN proof||jsonb_build_object('replyParent',parent);
END $$;
REVOKE ALL ON FUNCTION public.agent_communications_source(uuid,uuid,bigint,bigint,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.agent_communications_source(uuid,uuid,bigint,bigint,uuid) TO acquire_campaign_user;
