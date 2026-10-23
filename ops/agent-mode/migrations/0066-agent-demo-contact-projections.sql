-- Stage A only. Immutable server-created mapping evidence; NO outreach enable.
-- The applied0065 assertion/triggers remain unchanged and block every demo send.
CREATE UNIQUE INDEX agent_demo_mode_creator_scope_idx ON public.agent_mandate_execution_modes(mandate_id,organization_id,created_by,demo_id);

CREATE TABLE public.agent_demo_runs(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),organization_id text NOT NULL REFERENCES public.organization(id),
 owner_user_id text NOT NULL REFERENCES public."user"(id),run_id text NOT NULL CHECK(run_id~'^[a-z][a-z0-9-]{2,63}$'),
 integration_id text NOT NULL,configuration_ref text NOT NULL,
 senders jsonb NOT NULL CHECK(jsonb_typeof(senders)='array' AND jsonb_array_length(senders)=3 AND octet_length(senders::text)<=12000),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 CHECK(integration_id='sim-'||run_id AND configuration_ref=integration_id||'-v1'),
 UNIQUE(id,organization_id,owner_user_id),UNIQUE(organization_id,owner_user_id,run_id)
);
CREATE TABLE public.agent_demo_mapping_requests(
 request_key uuid PRIMARY KEY,organization_id text NOT NULL,mandate_id uuid NOT NULL,demo_id uuid NOT NULL,
 created_by text NOT NULL,demo_run_id uuid NOT NULL,manifest jsonb NOT NULL,input_digest text NOT NULL CHECK(input_digest~'^[a-f0-9]{64}$'),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 CHECK(demo_id=mandate_id),CHECK(jsonb_typeof(manifest)='object' AND jsonb_typeof(manifest->'people')='array' AND jsonb_array_length(manifest->'people') BETWEEN 1 AND 50 AND octet_length(manifest::text)<=64000),
 FOREIGN KEY(mandate_id,organization_id,created_by,demo_id) REFERENCES public.agent_mandate_execution_modes(mandate_id,organization_id,created_by,demo_id),
 FOREIGN KEY(demo_run_id,organization_id,created_by) REFERENCES public.agent_demo_runs(id,organization_id,owner_user_id),
 UNIQUE(request_key,organization_id,mandate_id,demo_id,created_by,demo_run_id)
);
CREATE TABLE public.agent_demo_mapping_receipts(
 request_key uuid PRIMARY KEY,organization_id text NOT NULL,mandate_id uuid NOT NULL,demo_id uuid NOT NULL,created_by text NOT NULL,demo_run_id uuid NOT NULL,
 result jsonb NOT NULL CHECK(jsonb_typeof(result)='object' AND octet_length(result::text)<=100000),
 result_digest text NOT NULL CHECK(result_digest~'^[a-f0-9]{64}$'),created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 FOREIGN KEY(request_key,organization_id,mandate_id,demo_id,created_by,demo_run_id) REFERENCES public.agent_demo_mapping_requests(request_key,organization_id,mandate_id,demo_id,created_by,demo_run_id),
 UNIQUE(request_key,organization_id,mandate_id,demo_id,created_by,demo_run_id)
);
CREATE TABLE public.agent_demo_contact_mappings(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),organization_id text NOT NULL,mandate_id uuid NOT NULL,demo_id uuid NOT NULL,created_by text NOT NULL,
 contact_id uuid NOT NULL,source_revision text NOT NULL CHECK(source_revision~'^[0-9]{1,30}$'),source_fingerprint text NOT NULL CHECK(source_fingerprint~'^[a-f0-9]{64}$'),
 demo_run_id uuid NOT NULL,request_key uuid NOT NULL,
 wire jsonb NOT NULL CHECK(jsonb_typeof(wire)='object' AND octet_length(wire::text)<=8000),
 -- The CLI digest seals the complete ordered BATCH, not this individual row.
 mapping_digest text NOT NULL CHECK(mapping_digest~'^[a-f0-9]{64}$'),created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 FOREIGN KEY(contact_id,organization_id) REFERENCES public.contacts(id,organization_id),
 FOREIGN KEY(request_key,organization_id,mandate_id,demo_id,created_by,demo_run_id) REFERENCES public.agent_demo_mapping_receipts(request_key,organization_id,mandate_id,demo_id,created_by,demo_run_id),
 UNIQUE(demo_id,contact_id)
);
-- A simulator recipient may never be reassigned to another source/demo/tenant.
CREATE UNIQUE INDEX agent_demo_email_unique ON public.agent_demo_contact_mappings((wire->>'email'));
CREATE UNIQUE INDEX agent_demo_phone_unique ON public.agent_demo_contact_mappings((wire->>'phone'));
CREATE UNIQUE INDEX agent_demo_linkedin_unique ON public.agent_demo_contact_mappings((wire->>'linkedin'));
CREATE UNIQUE INDEX agent_demo_provider_unique ON public.agent_demo_contact_mappings((wire->>'providerId'));

CREATE FUNCTION public.agent_demo_evidence_immutable() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
BEGIN RAISE EXCEPTION 'Demo mapping evidence is immutable';END $$;
REVOKE ALL ON FUNCTION public.agent_demo_evidence_immutable() FROM PUBLIC;
DO $$ DECLARE name text;owner_column text;BEGIN
 FOREACH name IN ARRAY ARRAY['agent_demo_runs','agent_demo_mapping_requests','agent_demo_mapping_receipts','agent_demo_contact_mappings'] LOOP
  owner_column:=CASE WHEN name='agent_demo_runs' THEN 'owner_user_id' ELSE 'created_by' END;
  EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',name);
  EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY',name);
  EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC,acquire_agent_user,acquire_campaign_user',name);
  EXECUTE format('GRANT SELECT ON public.%I TO acquire_agent_user,acquire_campaign_user',name);
  EXECUTE format('CREATE POLICY agent_demo_owned_read ON public.%I FOR SELECT TO acquire_agent_user,acquire_campaign_user USING(organization_id=current_setting(''app.acquire_org'',true) AND %I=current_setting(''app.acquire_user'',true) AND EXISTS(SELECT 1 FROM public.member WHERE organization_id=current_setting(''app.acquire_org'',true) AND user_id=current_setting(''app.acquire_user'',true)))',name,owner_column);
  EXECUTE format('CREATE POLICY agent_demo_definer ON public.%I TO PUBLIC USING(current_user=pg_get_userbyid((SELECT relowner FROM pg_class WHERE oid=%L::regclass))) WITH CHECK(current_user=pg_get_userbyid((SELECT relowner FROM pg_class WHERE oid=%L::regclass)))',name,name,name);
  EXECUTE format('CREATE TRIGGER agent_demo_evidence_immutable BEFORE UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.agent_demo_evidence_immutable()',name);
 END LOOP;
END $$;

-- Metadata consistency, NOT provider cryptographic verification or send authority.
-- Privileged bootstrap must obtain/decrypt exact wire IDs through the normal SDK.
CREATE FUNCTION public.agent_demo_run_bindings_match(p_org text,p_owner text,p_run text,p_integration text,p_config text,p_senders jsonb) RETURNS boolean
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE item jsonb;b public.communication_bindings%ROWTYPE;seen_channels text[]:='{}';seen_bindings text[]:='{}';
BEGIN
 IF p_run IS NULL OR p_run!~'^[a-z][a-z0-9-]{2,63}$' OR p_integration IS DISTINCT FROM 'sim-'||p_run OR p_config IS DISTINCT FROM p_integration||'-v1'
 OR jsonb_typeof(p_senders) IS DISTINCT FROM 'array' OR jsonb_array_length(p_senders)<>3
 OR NOT EXISTS(SELECT 1 FROM public.member WHERE organization_id=p_org AND user_id=p_owner) THEN RETURN false;END IF;
 FOR item IN SELECT value FROM jsonb_array_elements(p_senders) LOOP
  IF jsonb_typeof(item) IS DISTINCT FROM 'object' OR (SELECT count(*) FROM jsonb_object_keys(item))<>6
  OR item->>'channel' IS NULL OR item->>'channel' NOT IN('email','whatsapp','linkedin')
  OR item->>'bindingId' IS NULL OR item->>'bindingId'!~'^[a-f0-9-]{36}$'
  OR item->>'bindingDigest' IS NULL OR item->>'bindingDigest'!~'^[a-f0-9]{64}$'
  OR item->>'accountId' IS NULL OR item->>'providerAccountId' IS DISTINCT FROM 'sim-'||p_run||'-'||(item->>'channel')
  OR item->>'sourceId' IS DISTINCT FROM 'sim-source-'||(item->>'channel')
  OR item->>'channel'=ANY(seen_channels) OR item->>'bindingId'=ANY(seen_bindings) THEN RETURN false;END IF;
  SELECT * INTO b FROM public.communication_bindings WHERE id::text=item->>'bindingId' AND organization_id=p_org AND owner_user_id=p_owner
   AND channel=item->>'channel' AND application_id='acquire' AND authority='service' AND backend='unipile';
  IF b.id IS NULL OR b.service_account_id IS DISTINCT FROM item->>'accountId' OR public.agent_recorded_binding_digest(b.id) IS DISTINCT FROM item->>'bindingDigest'
  OR NOT EXISTS(SELECT 1 FROM communications.connections c JOIN communications.connection_generations g ON g.connection_id=c.id AND g.generation=c.current_generation
   AND g.application_id=c.application_id AND g.tenant_id=c.tenant_id AND g.owner_id=c.owner_id AND g.account_id=c.account_id AND g.channel=c.channel AND g.platform=c.platform AND g.backend=c.backend
   WHERE c.id=b.service_connection_id AND c.application_id=b.application_id AND c.tenant_id=b.organization_id AND c.owner_id=b.owner_user_id AND c.account_id=b.service_account_id
   AND c.channel=b.channel AND c.platform=b.platform AND c.backend=b.backend AND c.current_generation=b.generation AND c.active AND c.status='connected'
   AND g.integration_id=p_integration AND g.provider_configuration_reference=p_config AND g.provider_api_version='v1' AND g.authority='service')
  THEN RETURN false;END IF;
  seen_channels:=seen_channels||ARRAY[item->>'channel'];seen_bindings:=seen_bindings||ARRAY[item->>'bindingId'];
 END LOOP;
 RETURN cardinality(seen_channels)=3;
END $$;
REVOKE ALL ON FUNCTION public.agent_demo_run_bindings_match(text,text,text,text,text,jsonb) FROM PUBLIC;

-- One canonical DB preimage for both privileged app preparation and SQL gates.
CREATE FUNCTION public.agent_demo_contact_fingerprint(p_contact uuid) RETURNS text
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE org text:=current_setting('app.acquire_org',true);actor text:=current_setting('app.acquire_user',true);person record;source_revision text;
BEGIN
 IF org IS NULL OR org='' OR actor IS NULL OR actor='' OR NOT EXISTS(SELECT 1 FROM public.member WHERE organization_id=org AND user_id=actor) THEN RAISE EXCEPTION 'Current owned contact required';END IF;
 SELECT c.*,c.xmin::text AS source_revision INTO person FROM public.contacts c WHERE c.id=p_contact AND c.organization_id=org FOR SHARE OF c;
 source_revision:=person.source_revision;
 IF person.id IS NULL THEN RAISE EXCEPTION 'Current owned contact required';END IF;
 RETURN encode(sha256(convert_to(public.agent_channel_canonical_json(jsonb_build_object('contactId',person.id,'revision',source_revision,'personalData',person.personal_data,'provenance',person.provenance,'displayName',person.display_name,'role',person.role,'firmablePersonId',person.firmable_person_id,'fictionalised',person.fictionalised)),'UTF8')),'hex');
END $$;
REVOKE ALL ON FUNCTION public.agent_demo_contact_fingerprint(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.agent_demo_contact_fingerprint(uuid) TO acquire_agent_user,acquire_campaign_user;

CREATE FUNCTION public.agent_demo_wire_valid(p_run text,p_wire jsonb) RETURNS boolean
 LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,public AS $$
 SELECT coalesce(CASE WHEN jsonb_typeof(p_wire)='object' THEN
  (SELECT count(*) FROM jsonb_object_keys(p_wire))=8
  AND p_wire->>'sourcePersonId'~'^[a-f0-9-]{36}$' AND p_wire->>'sourceRevision'~'^[0-9]{1,30}$' AND p_wire->>'sourceFingerprint'~'^[a-f0-9]{64}$'
  AND p_wire->>'simulatorLeadId'~'^lead-[0-9]{3}$'
  AND p_wire->>'email'=(p_wire->>'simulatorLeadId')||'@'||p_run||'.leads.acquire.test'
  AND p_wire->>'phone'~'^[+]999[0-9]{12}$'
  AND p_wire->>'linkedin'='https://www.linkedin.com/in/sim-'||p_run||'-'||(p_wire->>'simulatorLeadId')
  AND p_wire->>'providerId'='ACo_sim_'||p_run||'_'||(p_wire->>'simulatorLeadId')
 ELSE false END,false);
$$;
REVOKE ALL ON FUNCTION public.agent_demo_wire_valid(text,jsonb) FROM PUBLIC;

CREATE FUNCTION public.agent_demo_evidence_insert_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE run public.agent_demo_runs%ROWTYPE;request public.agent_demo_mapping_requests%ROWTYPE;receipt public.agent_demo_mapping_receipts%ROWTYPE;item jsonb;wire jsonb;seen uuid[]:='{}';ordinal integer:=0;
BEGIN
 IF TG_TABLE_NAME='agent_demo_runs' THEN
  IF current_setting('app.acquire_org',true) IS DISTINCT FROM NEW.organization_id OR current_setting('app.acquire_user',true) IS DISTINCT FROM NEW.owner_user_id
  OR NOT public.agent_demo_run_bindings_match(NEW.organization_id,NEW.owner_user_id,NEW.run_id,NEW.integration_id,NEW.configuration_ref,NEW.senders) THEN RAISE EXCEPTION 'Exact current owned demo sender registry required';END IF;
  RETURN NEW;
 END IF;
 IF current_setting('app.acquire_org',true) IS DISTINCT FROM NEW.organization_id OR current_setting('app.acquire_user',true) IS DISTINCT FROM NEW.created_by THEN RAISE EXCEPTION 'Current owned demo evidence scope required';END IF;
 SELECT * INTO run FROM public.agent_demo_runs WHERE id=NEW.demo_run_id AND organization_id=NEW.organization_id AND owner_user_id=NEW.created_by;
 IF run.id IS NULL OR NOT public.agent_demo_run_bindings_match(run.organization_id,run.owner_user_id,run.run_id,run.integration_id,run.configuration_ref,run.senders)
 OR NOT EXISTS(SELECT 1 FROM public.agent_mandate_execution_modes m JOIN public.member x ON x.organization_id=m.organization_id AND x.user_id=m.created_by
  WHERE m.mandate_id=NEW.mandate_id AND m.organization_id=NEW.organization_id AND m.created_by=NEW.created_by AND m.mode='demo' AND m.demo_id=NEW.demo_id)
 THEN RAISE EXCEPTION 'Current owned demo source and registry required';END IF;
 IF TG_TABLE_NAME='agent_demo_mapping_requests' THEN
  IF (SELECT count(*) FROM jsonb_object_keys(NEW.manifest))<>7 OR NEW.manifest->>'version' IS DISTINCT FROM '1' OR NEW.manifest->>'demoId' IS DISTINCT FROM NEW.demo_id::text OR NEW.manifest->>'mandateId' IS DISTINCT FROM NEW.mandate_id::text
  OR NEW.manifest->>'organizationId' IS DISTINCT FROM NEW.organization_id OR NEW.manifest->>'userId' IS DISTINCT FROM NEW.created_by OR NEW.manifest->>'requestKey' IS DISTINCT FROM NEW.request_key::text
  OR jsonb_typeof(NEW.manifest->'people') IS DISTINCT FROM 'array' OR jsonb_array_length(NEW.manifest->'people') NOT BETWEEN 1 AND 50 THEN RAISE EXCEPTION 'Exact immutable demo request manifest required';END IF;
  FOR item IN SELECT value FROM jsonb_array_elements(NEW.manifest->'people') LOOP
   IF jsonb_typeof(item) IS DISTINCT FROM 'object' OR (SELECT count(*) FROM jsonb_object_keys(item))<>3
   OR item->>'sourcePersonId' IS NULL OR item->>'sourcePersonId'!~'^[a-f0-9-]{36}$' OR item->>'sourceFingerprint' IS NULL OR item->>'sourceFingerprint'!~'^[a-f0-9]{64}$'
   OR item->>'sourcePersonId'=ANY(seen::text[]) THEN RAISE EXCEPTION 'Exact unique demo source metadata required';END IF;
   IF NOT EXISTS(SELECT 1 FROM public.contacts c WHERE c.id::text=item->>'sourcePersonId' AND c.organization_id=NEW.organization_id AND c.xmin::text=item->>'sourceRevision'
    AND (c.mandate_id=NEW.mandate_id OR EXISTS(SELECT 1 FROM public.mandate_targets mt WHERE mt.mandate_id=NEW.mandate_id AND mt.organization_id=c.organization_id AND mt.target_id=c.target_id)))
   THEN RAISE EXCEPTION 'Current mandate contact revision required';END IF;
   IF item->>'sourceFingerprint' IS DISTINCT FROM public.agent_demo_contact_fingerprint((item->>'sourcePersonId')::uuid) THEN RAISE EXCEPTION 'Current canonical contact fingerprint required';END IF;
   seen:=seen||ARRAY[(item->>'sourcePersonId')::uuid];
  END LOOP;
 ELSIF TG_TABLE_NAME='agent_demo_mapping_receipts' THEN
  SELECT * INTO request FROM public.agent_demo_mapping_requests WHERE request_key=NEW.request_key AND organization_id=NEW.organization_id AND mandate_id=NEW.mandate_id AND created_by=NEW.created_by AND demo_id=NEW.demo_id AND demo_run_id=NEW.demo_run_id;
  IF request.request_key IS NULL OR (SELECT count(*) FROM jsonb_object_keys(NEW.result))<>9 OR NEW.result->>'version' IS DISTINCT FROM '1' OR NEW.result->>'demoId' IS DISTINCT FROM NEW.demo_id::text OR NEW.result->>'runId' IS DISTINCT FROM run.run_id
   OR NEW.result->>'mappingDigest' IS NULL OR NEW.result->>'mappingDigest'!~'^[a-f0-9]{64}$'
   OR jsonb_typeof(NEW.result->'mappings') IS DISTINCT FROM 'array' OR jsonb_array_length(NEW.result->'mappings')<>jsonb_array_length(request.manifest->'people')
   OR jsonb_typeof(NEW.result->'accounts') IS DISTINCT FROM 'array' OR jsonb_array_length(NEW.result->'accounts')<>3
  THEN RAISE EXCEPTION 'Exact verified demo batch receipt required';END IF;
  FOR item IN SELECT value FROM jsonb_array_elements(run.senders) LOOP
   IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(NEW.result->'accounts') a WHERE a->>'channel'=item->>'channel' AND a->>'providerAccountId'=item->>'providerAccountId' AND a->>'sourceId'=item->>'sourceId') THEN RAISE EXCEPTION 'Demo receipt sender differs from registry';END IF;
  END LOOP;
  FOR item IN SELECT value FROM jsonb_array_elements(request.manifest->'people') LOOP
   wire:=NEW.result->'mappings'->ordinal;ordinal:=ordinal+1;
   IF NOT public.agent_demo_wire_valid(run.run_id,wire) OR wire->>'sourcePersonId' IS DISTINCT FROM item->>'sourcePersonId' OR wire->>'sourceRevision' IS DISTINCT FROM item->>'sourceRevision' OR wire->>'sourceFingerprint' IS DISTINCT FROM item->>'sourceFingerprint' THEN RAISE EXCEPTION 'Ordered verified demo batch differs from source manifest';END IF;
   IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(NEW.result->'mappings') m WHERE m->>'sourcePersonId'=item->>'sourcePersonId' AND m->>'sourceRevision'=item->>'sourceRevision' AND m->>'sourceFingerprint'=item->>'sourceFingerprint') THEN RAISE EXCEPTION 'Demo batch changed its source manifest';END IF;
   IF NOT EXISTS(SELECT 1 FROM public.contacts c WHERE c.id::text=item->>'sourcePersonId' AND c.organization_id=NEW.organization_id AND c.xmin::text=item->>'sourceRevision') OR item->>'sourceFingerprint' IS DISTINCT FROM public.agent_demo_contact_fingerprint((item->>'sourcePersonId')::uuid) THEN RAISE EXCEPTION 'Demo source changed before receipt persistence';END IF;
  END LOOP;
 ELSIF TG_TABLE_NAME='agent_demo_contact_mappings' THEN
  SELECT * INTO receipt FROM public.agent_demo_mapping_receipts WHERE request_key=NEW.request_key AND organization_id=NEW.organization_id AND mandate_id=NEW.mandate_id AND demo_id=NEW.demo_id AND created_by=NEW.created_by AND demo_run_id=NEW.demo_run_id;
  wire:=NEW.wire;
  IF receipt.request_key IS NULL OR NOT public.agent_demo_wire_valid(run.run_id,wire)
   OR wire->>'sourcePersonId' IS DISTINCT FROM NEW.contact_id::text OR wire->>'sourceRevision' IS DISTINCT FROM NEW.source_revision OR wire->>'sourceFingerprint' IS DISTINCT FROM NEW.source_fingerprint
   OR wire->>'simulatorLeadId' IS NULL OR wire->>'simulatorLeadId'!~'^lead-[0-9]{3}$' OR wire->>'email' IS DISTINCT FROM (wire->>'simulatorLeadId')||'@'||run.run_id||'.leads.acquire.test'
   OR wire->>'phone' IS NULL OR wire->>'phone'!~'^[+]999[0-9]{12}$' OR wire->>'linkedin' IS DISTINCT FROM 'https://www.linkedin.com/in/sim-'||run.run_id||'-'||(wire->>'simulatorLeadId')
   OR wire->>'providerId' IS DISTINCT FROM 'ACo_sim_'||run.run_id||'_'||(wire->>'simulatorLeadId') OR NEW.mapping_digest IS DISTINCT FROM receipt.result->>'mappingDigest'
   OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(receipt.result->'mappings') m WHERE m=wire)
   OR NOT EXISTS(SELECT 1 FROM public.contacts c WHERE c.id=NEW.contact_id AND c.organization_id=NEW.organization_id AND c.xmin::text=NEW.source_revision)
   OR NEW.source_fingerprint IS DISTINCT FROM public.agent_demo_contact_fingerprint(NEW.contact_id)
  THEN RAISE EXCEPTION 'Exact current immutable demo contact mapping required';END IF;
 ELSE RAISE EXCEPTION 'Unsupported demo evidence table';END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.agent_demo_evidence_insert_guard() FROM PUBLIC;
DO $$ DECLARE name text;BEGIN
 FOREACH name IN ARRAY ARRAY['agent_demo_runs','agent_demo_mapping_requests','agent_demo_mapping_receipts','agent_demo_contact_mappings'] LOOP
  EXECUTE format('CREATE TRIGGER agent_demo_evidence_insert_guard BEFORE INSERT ON public.%I FOR EACH ROW EXECUTE FUNCTION public.agent_demo_evidence_insert_guard()',name);
 END LOOP;
END $$;

-- New read projection only. It does not replace real contact rows, old global
-- person helpers, source/admission functions or the0065 demo-outreach fence.
CREATE FUNCTION public.agent_effective_contact(p_mandate uuid,p_contact uuid) RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE org text:=current_setting('app.acquire_org',true);actor text:=current_setting('app.acquire_user',true);person public.contacts%ROWTYPE;intent public.agent_mandate_execution_modes%ROWTYPE;mapping public.agent_demo_contact_mappings%ROWTYPE;run public.agent_demo_runs%ROWTYPE;source_revision text;source_fingerprint text;source jsonb;
BEGIN
 IF org IS NULL OR org='' OR actor IS NULL OR actor='' OR NOT EXISTS(SELECT 1 FROM public.member WHERE organization_id=org AND user_id=actor)
 OR NOT EXISTS(SELECT 1 FROM public.mandates WHERE id=p_mandate AND organization_id=org) THEN RAISE EXCEPTION 'Current owned mandate contact required';END IF;
 SELECT * INTO person FROM public.contacts c WHERE c.id=p_contact AND c.organization_id=org
 AND (c.mandate_id=p_mandate OR EXISTS(SELECT 1 FROM public.mandate_targets mt WHERE mt.mandate_id=p_mandate AND mt.organization_id=org AND mt.target_id=c.target_id)) FOR SHARE OF c;
 IF person.id IS NULL THEN RAISE EXCEPTION 'Current owned mandate contact required';END IF;
 SELECT xmin::text INTO source_revision FROM public.contacts WHERE id=person.id AND organization_id=org;
 source_fingerprint:=public.agent_demo_contact_fingerprint(person.id);
 source:=jsonb_build_object('id',person.id,'targetId',person.target_id,'displayName',person.display_name,'role',person.role,'personalData',person.personal_data,'provenance',person.provenance,'firmablePersonId',person.firmable_person_id,'fictionalised',person.fictionalised,'revision',source_revision,'fingerprint',source_fingerprint);
 SELECT * INTO intent FROM public.agent_mandate_execution_modes WHERE mandate_id=p_mandate AND organization_id=org;
 IF intent.mode IS DISTINCT FROM 'demo' THEN RETURN jsonb_build_object('mode','real','sourceContact',source,'demoProjection',NULL);END IF;
 IF intent.created_by IS DISTINCT FROM actor THEN RAISE EXCEPTION 'Current owned demo mapping required';END IF;
 SELECT * INTO mapping FROM public.agent_demo_contact_mappings WHERE mandate_id=p_mandate AND organization_id=org AND created_by=actor AND contact_id=person.id AND demo_id=intent.demo_id;
 SELECT * INTO run FROM public.agent_demo_runs WHERE id=mapping.demo_run_id AND organization_id=org AND owner_user_id=actor;
 IF mapping.id IS NULL OR mapping.source_revision IS DISTINCT FROM source_revision OR mapping.source_fingerprint IS DISTINCT FROM source_fingerprint OR run.id IS NULL
 OR NOT public.agent_demo_run_bindings_match(run.organization_id,run.owner_user_id,run.run_id,run.integration_id,run.configuration_ref,run.senders)
 THEN RAISE EXCEPTION 'Current immutable demo recipients are unavailable; real contact fallback is disabled.';END IF;
 RETURN jsonb_build_object('mode','demo','sourceContact',source,'demoProjection',jsonb_build_object('mappingId',mapping.id,'demoId',mapping.demo_id,'demoRunId',run.id,'runId',run.run_id,'integrationId',run.integration_id,'configurationRef',run.configuration_ref,'sourceRevision',mapping.source_revision,'sourceFingerprint',mapping.source_fingerprint,'mappingDigest',mapping.mapping_digest,'requestKey',mapping.request_key,'recipients',jsonb_build_object('email',mapping.wire->>'email','whatsapp',mapping.wire->>'phone','linkedin',mapping.wire->>'linkedin'),'providerId',mapping.wire->>'providerId','simulatorLeadId',mapping.wire->>'simulatorLeadId','senders',run.senders));
END $$;
REVOKE ALL ON FUNCTION public.agent_effective_contact(uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.agent_effective_contact(uuid,uuid) TO acquire_agent_user,acquire_campaign_user;

CREATE FUNCTION public.agent_mandate_person_keys(p_mandate uuid,p_contact uuid) RETURNS text[]
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE effective jsonb;keys text[];prefix text;
BEGIN
 effective:=public.agent_effective_contact(p_mandate,p_contact);
 keys:=public.agent_person_keys(current_setting('app.acquire_org',true),p_contact);
 IF effective->>'mode'='real' THEN RETURN keys;END IF;
 -- Prefix all real canonical keys: duplicate source records still deduplicate
 -- inside this demo, but never acquire or collide with a real/global claim.
 prefix:='demo:'||(effective->'demoProjection'->>'demoId')||':';
 RETURN ARRAY(SELECT prefix||k FROM unnest(keys) k)
  ||ARRAY[prefix||'email:'||(effective->'demoProjection'->'recipients'->>'email'),prefix||'whatsapp:'||(effective->'demoProjection'->'recipients'->>'whatsapp'),prefix||'linkedin:'||(effective->'demoProjection'->'recipients'->>'linkedin')];
END $$;
REVOKE ALL ON FUNCTION public.agent_mandate_person_keys(uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.agent_mandate_person_keys(uuid,uuid) TO acquire_agent_user,acquire_campaign_user;

CREATE FUNCTION public.agent_mandate_person_has_unresolved_sends(p_mandate uuid,p_contact uuid,p_ignored_operation uuid DEFAULT NULL) RETURNS boolean
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE org text:=current_setting('app.acquire_org',true);actor text:=current_setting('app.acquire_user',true);effective jsonb;aliases uuid[];
BEGIN
 IF current_setting('role',true) NOT IN('acquire_agent_user','acquire_campaign_user') OR NOT EXISTS(SELECT 1 FROM public.member WHERE organization_id=org AND user_id=actor)
 OR NOT EXISTS(SELECT 1 FROM public.communication_send_gates WHERE organization_id=org AND writer_xid=txid_current()) THEN RAISE EXCEPTION 'Held current send scope required';END IF;
 effective:=public.agent_effective_contact(p_mandate,p_contact);
 IF effective->>'mode'='real' THEN RETURN public.agent_person_has_unresolved_sends(p_contact,p_ignored_operation);END IF;
 aliases:=public.agent_canonical_contact_aliases(p_contact);
 IF p_ignored_operation IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.agent_operations o JOIN public.agent_conversations c ON c.id=o.conversation_id AND c.organization_id=o.organization_id
  WHERE o.id=p_ignored_operation AND o.organization_id=org AND o.owner_user_id=actor AND o.mandate_id=p_mandate AND c.mandate_id=p_mandate AND c.contact_id=ANY(aliases)) THEN RAISE EXCEPTION 'Only this owned demo operation may be excluded';END IF;
 IF EXISTS(SELECT 1 FROM public.agent_operations o JOIN public.agent_conversations c ON c.id=o.conversation_id AND c.organization_id=o.organization_id
  WHERE o.organization_id=org AND o.mandate_id=p_mandate AND c.mandate_id=p_mandate AND c.contact_id=ANY(aliases) AND o.name~'^(email|whatsapp|linkedin)[.]' AND o.state IN('running','uncertain') AND o.id IS DISTINCT FROM p_ignored_operation) THEN RETURN true;END IF;
 IF EXISTS(SELECT 1 FROM public.agent_linkedin_invitations i JOIN public.agent_conversations c ON c.id=i.conversation_id AND c.organization_id=i.organization_id
  WHERE i.organization_id=org AND c.mandate_id=p_mandate AND c.contact_id=ANY(aliases) AND i.state='unknown' AND i.operation_id IS DISTINCT FROM p_ignored_operation) THEN RETURN true;END IF;
 -- If an original intent on this demo account cannot be assigned to an
 -- immutable native mandate, never guess another namespace or drop the hold.
 IF EXISTS(SELECT 1 FROM public.communication_dispatch_intents i
  WHERE i.organization_id=org AND i.owner_user_id=actor AND i.contact_id=ANY(aliases)
  AND EXISTS(SELECT 1 FROM jsonb_array_elements(effective->'demoProjection'->'senders') b WHERE b->>'bindingId'=i.binding_id::text)
  AND NOT EXISTS(SELECT 1 FROM public.communication_intent_resolutions r WHERE r.intent_id=i.id)
  AND (i.source_kind<>'agent' OR NOT EXISTS(SELECT 1 FROM public.agent_operations o WHERE o.id=i.source_id AND o.organization_id=i.organization_id))
  AND NOT(i.source_kind='campaign' AND EXISTS(SELECT 1 FROM public.campaign_send_attempts a WHERE a.id=i.source_id AND a.organization_id=org AND a.state='sent' AND a.provider_message_id IS NOT NULL AND a.sent_at IS NOT NULL))
  AND NOT(i.source_kind='draft' AND EXISTS(SELECT 1 FROM public.messages m WHERE m.id=i.source_id AND m.organization_id=org AND m.state='sent' AND m.provider_message_id IS NOT NULL AND m.sent_at IS NOT NULL))) THEN RETURN true;END IF;
 RETURN EXISTS(SELECT 1 FROM public.communication_dispatch_intents i JOIN public.agent_operations o ON i.source_kind='agent' AND o.id=i.source_id AND o.organization_id=i.organization_id
  WHERE i.organization_id=org AND o.mandate_id=p_mandate AND i.contact_id=ANY(aliases)
  AND NOT EXISTS(SELECT 1 FROM public.communication_intent_resolutions r WHERE r.intent_id=i.id)
  AND NOT(o.state='complete' AND o.result->'delivery'->>'status'='submitted') AND o.id IS DISTINCT FROM p_ignored_operation);
END $$;
REVOKE ALL ON FUNCTION public.agent_mandate_person_has_unresolved_sends(uuid,uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.agent_mandate_person_has_unresolved_sends(uuid,uuid,uuid) TO acquire_agent_user,acquire_campaign_user;
-- Stage B must migrate all new-admission/claim/ingress consumers and filter demo
-- effects from the old real/global unresolved helpers before any fence is lifted.
-- Original recovery continues using its immutable operation/account/receipt.
