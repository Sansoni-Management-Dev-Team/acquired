-- Forward-only correction: an original demo channel effect cannot be renamed
-- into a control operation or reparented to hide its immutable send identity.
-- Existing receipt/result bookkeeping never reloads current recipient context.
DO $$ BEGIN IF current_database()<>'acquire_agent_mode' OR shobj_description((SELECT oid FROM pg_database WHERE datname=current_database()),'pg_database') IS DISTINCT FROM 'acquire-agent-mode-local-only' THEN RAISE EXCEPTION 'Exact marked local database required';END IF;END $$;

CREATE FUNCTION public.agent_demo_original_effect_identity_guard() RETURNS trigger
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE body_changed boolean;
BEGIN
 IF NOT (OLD.name~'^(email|whatsapp|linkedin)[.]' OR NEW.name~'^(email|whatsapp|linkedin)[.]')
 OR NOT (public.agent_is_demo_origin(OLD.mandate_id) OR public.agent_is_demo_origin(NEW.mandate_id)) THEN RETURN NEW;END IF;
 IF NEW.id IS DISTINCT FROM OLD.id OR NEW.name IS DISTINCT FROM OLD.name
 OR NEW.thread_id IS DISTINCT FROM OLD.thread_id OR NEW.organization_id IS DISTINCT FROM OLD.organization_id
 OR NEW.mandate_id IS DISTINCT FROM OLD.mandate_id OR NEW.owner_user_id IS DISTINCT FROM OLD.owner_user_id
 OR NEW.conversation_id IS DISTINCT FROM OLD.conversation_id OR NEW.request_key IS DISTINCT FROM OLD.request_key
 OR NEW.created_at IS DISTINCT FROM OLD.created_at
 OR (NEW.input-'body') IS DISTINCT FROM (OLD.input-'body') THEN
  RAISE EXCEPTION 'Original demo effect source is immutable';
 END IF;
 body_changed:=NEW.input IS DISTINCT FROM OLD.input;
 IF (body_changed OR NEW.input_digest IS DISTINCT FROM OLD.input_digest)
 AND NOT (body_changed AND OLD.state='proposed' AND NEW.state='proposed' AND OLD.fence=0 AND NEW.fence=0) THEN
  RAISE EXCEPTION 'Original demo effect body requires a current pending human review';
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.agent_demo_original_effect_identity_guard() FROM PUBLIC;
-- Alphabetically before the0070 new-effect guard, including when NEW.name is a
-- non-channel control name. The existing guard still verifies legitimate edits.
CREATE TRIGGER agent_00_demo_original_effect_identity BEFORE UPDATE ON public.agent_operations
 FOR EACH ROW EXECUTE FUNCTION public.agent_demo_original_effect_identity_guard();
