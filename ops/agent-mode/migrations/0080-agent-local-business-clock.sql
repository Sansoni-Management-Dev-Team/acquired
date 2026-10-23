-- SIM28: current local agent business clock. No production target is permitted.
-- Operational leases, grants, budgets, authentication and audit time remain real.
-- Apply via migrate-agent-mode-local with the exact reviewed artifact; never startup.
SET LOCAL statement_timeout='15s';
SET LOCAL lock_timeout='5s';
SELECT pg_advisory_xact_lock(1094930773,2901);
DO $target$ BEGIN
 IF current_database()<>'acquire_agent_mode'
 OR (SELECT shobj_description(oid,'pg_database') FROM pg_database WHERE datname=current_database()) IS DISTINCT FROM 'acquire-agent-mode-local-only'
 OR (SELECT system_identifier::text FROM pg_control_system())<>'7697400069962248225'
 OR to_regprocedure('public.local_simulator_business_now()') IS NOT NULL THEN
 RAISE EXCEPTION 'Exact unapplied local agent clock target required';END IF;
END $target$;
DO $predecessors$ DECLARE entry record; BEGIN
 IF (SELECT count(*) FROM public.agent_local_migrations)<>77 THEN RAISE EXCEPTION 'Exact native0079 predecessor batch required';END IF;
 FOR entry IN SELECT * FROM (VALUES
 ('0001-agent-state.sql','28e41e4795f32a6aeff1f0a6c61c50a77befe0a75e4696250f713cdb6fad774c'),
 ('0002-agent-scope-fences.sql','302860b755d59ef1bac29276e4aa3037ee3520d9dcf5ced43e3250a770d06d55'),
 ('0003-agent-history-retention.sql','fda42e77451836fb471d9614e87ea8519718b10a48dfd34d062624c66b72c9bc'),
 ('0004-agent-conversation-turns.sql','f2775028fb97d146d8bc21b844e436a69f208d0b6e562acdddb6615abd2b324c'),
 ('0005-agent-review-state.sql','785b6a8320b1c77d89f5ee70f0e5c0de1b95a0c6082466e73525890150ffa4c5'),
 ('0006-agent-execution-control.sql','94cd62c03a9fa8e99d4cdba415a7a48ae7459fb7b3653200194cc59eb9b25bdd'),
 ('0007-agent-public-context.sql','2706ad0d1281c204ee4b182168be5656a603f0d029669f5d25bca18bf6f37808'),
 ('0008-agent-ownership-reconciliation.sql','f2ea79316a3b91134cf6bece20fea94184a0b7ea504be7f2a84bf241042d463a'),
 ('0009-agent-sequence-handover.sql','1126a588a64729cabfe02f90398d40ca062f25ec3c2a9d8803bf9596b597e787'),
 ('0010-agent-local-member-fence.sql','a6311fb80c219b4ee400adb1028f43401473dfdffa7c561dbb3c83bb510a7d16'),
 ('0011-agent-handoff-controls.sql','b7935af0319af55c8ebb0cde0fe2ef86f1b7e9b4e16bf9cd353d57082578a058'),
 ('0012-agent-delegation-policy.sql','03bb2d6410bbf7db97da696af09a4dfc701a2d87f0f342625bd8dd030b3dcf89'),
 ('0013-agent-communications-source.sql','c54392d18932b103dbe46358e476734fabe5c991de1fad3ef4441481a8bfea71'),
 ('0014-agent-handoff-integrity.sql','e11e5c467cde8b052407583338067413248bf12d88a25cb8ddde0db886d13e83'),
 ('0015-agent-research-launch.sql','a165e5eb19f514b4a26b2553dc9de1cf001c102bee4dfff8dd6236face4b4803'),
 ('0016-agent-handoff-reminders.sql','23e9925b623085200b1207c75337e46c98f5228431caadc3c9f91ec34e221d1a'),
 ('0017-agent-history-account-guard.sql','531ec385ed55645661c20dd009c909a1995ea57a4fcb3e3a7183f3515b01c539'),
 ('0018-agent-firmable-execution.sql','d31e4ae294ecde776dc382c78fefdb04100c14167acd2f60f0183851da157644'),
 ('0019-agent-email-reply-parent.sql','f89fc9da00338f256286860deaf627a16e1aa88718979e1817ff6731df44dcfa'),
 ('0020-agent-target-selection.sql','cb703dad1dd751aac5c270609be4c83e318a13f163bd61ebb12ea118902aa0e3'),
 ('0021-agent-research-counts.sql','2a7e09f7ce9e0bdfe76c916fa7538b7e1c01aa724b315d59f79f7abeb2277d7f'),
 ('0022-agent-incoming-email-events.sql','56cfd47cb1682e8f0925e318f73df3dd96a1acd2b14d0c5a1a313851bc89c886'),
 ('0023-agent-people-phase.sql','874e92dfbbb0fe867776b1e4c472322d525a22ab38cefcdcee72c52bc9787a2b'),
 ('0024-agent-incoming-conversation-dedup.sql','2925b6233efed46e9329217b41f4197882733423c17ef2d9f2d55ff39710b83f'),
 ('0025-agent-canonical-alias-performance.sql','2862539956965663e99c38ee9be4a27fb95ad3c2d00c16d6499e1ef283f73706'),
 ('0026-agent-sequence-drafts.sql','b6cf3e64474bbfa870db5cece201d2e688457f1a536d91050ee0f23c9977b744'),
 ('0027-agent-sequence-publication.sql','5af0d501bb6dfbb0bbda5dd53184058628e35f6c76e392d4dd511782ce84caa6'),
 ('0028-agent-no-submission-reconciliation.sql','e3016b18329f79b312ebfc1873af1598429e6bae39578168f685c04bff4c7251'),
 ('0030-agent-sequence-enrolment.sql','38ab9aed40110daf7c3b2f595b05ca087e5342a20819edba478911928ed1cc6d'),
 ('0031-agent-safe-event-eligibility.sql','8a2a570819e870632295e32220dc23fc4bcbeab8c318c77b02b5085289a38eab'),
 ('0032-agent-sequence-audit.sql','9d5e9e2f6c86d31745c20148566574545b5ac4cd9eccf221ac2c4d4c7522a2c0'),
 ('0033-agent-company-guidance-evidence.sql','2c680aafd13f57d17b03d718ce09ad294a643705de32a42163e8987f2861654c'),
 ('0034-agent-delivery-failure-events.sql','45fcf4d15b77d9cf218d992855d526bd4544d86fbfa49c1f360c72443d187aaf'),
 ('0035-agent-manual-feedback-source.sql','3ea3b3f12332d70b6f55b342797df2dd9481455a91650a40333de8b1266253bc'),
 ('0036-agent-isolated-communications-storage.sql','e048fa042abbfaa4f800424a4e5a62d02263a2c1928a21f18682740010f47e32'),
 ('0037-agent-worker-mandate-scope.sql','2dfa316fc1aa61e7b404eb48dfe001120b9266872048eeaf66828f74441f3dc6'),
 ('0038-agent-simulator-sending-policy.sql','f34f7d5ddbf23551430e1988db6de78461e25631eeeb90fa03238aa8d3ff4bc1'),
 ('0039-agent-isolated-pilot-policy.sql','57f6cbded5f63c0b2c0eb4ee6eb2325915378b1585870c66a862cf171a1288b4'),
 ('0040-agent-receipt-association-wake.sql','d6bb0c9b99fc003fb9cbe93662a29926d6d756c6e281c254caaa37a95443fac9'),
 ('0041-agent-fifty-pilot-policy.sql','51cca6595f46512e620b7fbc62772f031a14903b61afab0069049023219d7027'),
 ('0042-agent-person-channels.sql','ab684dfb9588e0dadcad446ff63db912ca66bc0de811039bb11ef7e7c989bb97'),
 ('0043-agent-runtime-registry.sql','0ba55832446ea4969c49071ffe9521bcbc769f3bd42bed5c2b3a2934a5bb54e3'),
 ('0044-agent-manual-contact-targets.sql','492c4e28442bd4736c059b2e899968d43c1abb4bf1c9d1ca7d55955d931855ab'),
 ('0045-agent-channel-target-allocation.sql','a9ef4fadbd7b4d2f1c357ce901b2c8a3b4fce98ddaf02ce956c8551735dd58ab'),
 ('0046-agent-channel-no-submission.sql','05b2c9f860475ee3b88b8b3c8ade4f91e8901d5a03928c833dad40aa637bf178'),
 ('0047-agent-linkedin-invitations.sql','10fc4476084d0e08f05bed0020c8de21c98002361988eb0fb549d8a4d59d4688'),
 ('0048-agent-channel-incoming.sql','52535af4d79224c81df23ad2d6f82e976a59d5d3e5982fa61b453226cdec37c6'),
 ('0049-agent-channel-due-events.sql','024dc4372b54570fa0bf5f503cc1c5e8692470f61f5296200de795a0bb2a41e3'),
 ('0050-agent-channel-allocation-review-alias.sql','b1c43fe18539f9937b33fcd47794836e22f00e8a64653f568cbf40899dcf4ac1'),
 ('0051-agent-sequence-channel-handover.sql','b89b3970bbfa9eefaed1540074e4cde490d90e284681e7e812fea0d4d083eeba'),
 ('0052-agent-unrelated-review-ingress.sql','b94721440a609bcd8c82cff698626afdff9cb4f95b838ebb13392ad756c2b983'),
 ('0053-agent-channel-reply-grants.sql','0f4dabe38118f8e7eb553416e7d736c693bd9e032817c9e79d5d82f4595c7063'),
 ('0054-agent-review-dependency-recovery.sql','73dfb6203033278173996c070568f58959bc120ef5c5fe3429661ad56c2a6d45'),
 ('0055-agent-untracked-outbound-review.sql','6c7887751641739a99d822d61a50e80c29ac58a6cfc9c96d2505d6daf2446d0d'),
 ('0056-agent-untracked-review-recovery.sql','10c0ef06b5aac24e368bd71d8dfcf070e15479e8984dfa8eaa826c66080d8fa1'),
 ('0057-agent-untracked-capture-timestamps.sql','b1d6edc09ea8da803b4c822c44ae4da8b268cc3791aab636857f34d1c2518b12'),
 ('0058-agent-untracked-review-authority-locks.sql','46f34bf38948993752df18f5260dfe6ebf69e33ddee1ebb65ce8c7058e0b7ced'),
 ('0059-agent-invitation-exact-admission.sql','4fb1843f99103687e9d3adf07841c5616aa23557f4251da4120ff1569d831814'),
 ('0060-agent-simultaneous-reply-routes.sql','bf253a5dd9edb08462e34f12625c7dfc1451de7d3d566b231bf1a5a897172074'),
 ('0061-agent-routed-email-receipt-wake.sql','c7179ed9c38c8cada494742297e632f6641e463b3ecbe161f04e9179f05a12c2'),
 ('0062-agent-warm-reply-continuity.sql','cb7aa733b77c87d61c47db59b881b17fdbcc3f18a939593b74155e9a8126f9a1'),
 ('0063-agent-verified-unread-history-refresh.sql','736e14b876ba638c55109cb9b78f4e84b393af2531f88254c6b9a0cc24cdcb31'),
 ('0064-agent-whatsapp-canonical-source-ingress.sql','2d857e80e235e4b186d280be3fe6cb494df5dbb8517cb9c70a331287e40bee5f'),
 ('0065-agent-mandate-execution-mode.sql','4576884bd34de7c51b98fba9b8af33914e24462a461bea4c342441e7a3a1669b'),
 ('0066-agent-demo-contact-projections.sql','7b28f98b914ea2d38a684bad72f9c5c454587c7f905387f2067b737c53f3e046'),
 ('0067-agent-hybrid-native-research.sql','d5765cec86cbc8d147654c8c4a59e0f2452e12e4fe8a319da64cb33c07d61236'),
 ('0068-agent-demo-manual-outreach-fence.sql','7fe74002974a5b607bfd3c9c321941b99cf706b78c68b9705059ceaa97993fb7'),
 ('0069-agent-public-fields-research.sql','8dd26bf0f14e6993512d1c2061eb9520f76c23b99255ef62b15fd15486a9aa11'),
 ('0070-agent-mandate-execution-context.sql','c561c147222ee5aad16673fd0154b97bec59f41822a9fb26cd67c874f7d213e7'),
 ('0071-agent-research-phase-budgets.sql','a64b5988895a3d0a9951075ee16a8b8e49d0b970156b3e7cd2bcfc10d7fd7be6'),
 ('0072-agent-demo-original-effect-identity.sql','5f956023f9b66dfe66982e4a549dbad6967efe3084658dd28e389d8707c9e008'),
 ('0074-company-canonical-identity.sql','dd960a4c0641662d2253e151a84b06bb6937bc20bed53ce0997806a160822809'),
 ('0075-agent-company-membership-projection.sql','03eec37a7f3524d0e62503347b9231bb0d072ce4324b9b9a99737b975ac8c2db'),
 ('0076-company-sync-observations.sql','c1ee4647651b1869b3428eb6e93e76082348fe307b9a69b305aafe719d4e72e6'),
 ('0077-agent-fields-current-company-source.sql','4cfc553c10604955077574ebd310b997f4680d63a27800191d364a790b0802de'),
 ('0078-agent-readable-company-control-context.sql','148bcc8d8a9b8a338f13708aa63c06974ea0918bd2674f3da41e712b716ad19a'),
 ('0079-agent-identity-batches.sql','25a032919ce69e32a8f74d286a896e92f1324923084ea767b7a791715e838161')
 ) frozen(name,sha256) LOOP
 IF (SELECT sha256 FROM public.agent_local_migrations WHERE name=entry.name) IS DISTINCT FROM entry.sha256 THEN RAISE EXCEPTION 'Changed predecessor: %',entry.name;END IF;
 END LOOP;
 IF (SELECT encode(sha256(convert_to(prosrc,'UTF8')),'hex') FROM pg_proc WHERE oid='public.agent_control_handoff(uuid,uuid,jsonb,text)'::regprocedure AND pg_get_userbyid(proowner)='project_acquire' AND proacl::text='{project_acquire=X/project_acquire,acquire_agent_user=X/project_acquire}' AND prosecdef AND provolatile='v') IS DISTINCT FROM 'a605792b22780549f0243017b2bc29c9a8ec04221ba2dfa14ed46a9a80f14800' THEN RAISE EXCEPTION 'Changed predecessor: agent_control_handoff';END IF;
 IF (SELECT encode(sha256(convert_to(prosrc,'UTF8')),'hex') FROM pg_proc WHERE oid='public.agent_registered_worker_scopes(integer,text)'::regprocedure AND pg_get_userbyid(proowner)='project_acquire' AND proacl::text='{project_acquire=X/project_acquire,acquire_agent_worker=X/project_acquire}' AND prosecdef AND provolatile='v') IS DISTINCT FROM '4135367ed77d7c0841d48933d384e287abdabca35151be6a1308a51cadd3af4a' THEN RAISE EXCEPTION 'Changed predecessor: agent_registered_worker_scopes';END IF;
 IF (SELECT encode(sha256(convert_to(prosrc,'UTF8')),'hex') FROM pg_proc WHERE oid='public.agent_worker_scopes(integer)'::regprocedure AND pg_get_userbyid(proowner)='project_acquire' AND proacl::text='{project_acquire=X/project_acquire,acquire_agent_worker=X/project_acquire}' AND prosecdef AND provolatile='v') IS DISTINCT FROM '52b7053342740fd8bf607f4d09abce85fb579a5bf0a8cfe98a77ee241e78e350' THEN RAISE EXCEPTION 'Changed predecessor: agent_worker_scopes';END IF;
 IF (SELECT encode(sha256(convert_to(prosrc,'UTF8')),'hex') FROM pg_proc WHERE oid='public.agent_worker_scopes_for_mandate(integer,uuid)'::regprocedure AND pg_get_userbyid(proowner)='project_acquire' AND proacl::text='{project_acquire=X/project_acquire,acquire_agent_worker=X/project_acquire}' AND prosecdef AND provolatile='v') IS DISTINCT FROM '7564a4013ed2c274d4625844fe38971c3a49f138092f8dfb6a8593a6a954fdb3' THEN RAISE EXCEPTION 'Changed predecessor: agent_worker_scopes_for_mandate';END IF;
 IF (SELECT encode(sha256(convert_to(pg_get_functiondef(oid),'UTF8')),'hex') FROM pg_proc WHERE oid='public.agent_control_handoff(uuid,uuid,jsonb,text)'::regprocedure) IS DISTINCT FROM '4202033d8a2a19337658a6e2740c2dfa27f8a14f90fa66250c17c2cf788bf04e' THEN RAISE EXCEPTION 'Changed full function metadata: agent_control_handoff';END IF;
 IF (SELECT encode(sha256(convert_to(pg_get_functiondef(oid),'UTF8')),'hex') FROM pg_proc WHERE oid='public.agent_registered_worker_scopes(integer,text)'::regprocedure) IS DISTINCT FROM '6c984cc907f6c53ccfef80d6b1f096977937370b71ed390287a19b6e89ce309c' THEN RAISE EXCEPTION 'Changed full function metadata: agent_registered_worker_scopes';END IF;
 IF (SELECT encode(sha256(convert_to(pg_get_functiondef(oid),'UTF8')),'hex') FROM pg_proc WHERE oid='public.agent_worker_scopes(integer)'::regprocedure) IS DISTINCT FROM '2b9cc30492dd4dd877539f3da0f15419fa9da13a85d4be69d0b2b78a09fee18c' THEN RAISE EXCEPTION 'Changed full function metadata: agent_worker_scopes';END IF;
 IF (SELECT encode(sha256(convert_to(pg_get_functiondef(oid),'UTF8')),'hex') FROM pg_proc WHERE oid='public.agent_worker_scopes_for_mandate(integer,uuid)'::regprocedure) IS DISTINCT FROM '4f42c6e10c454e0093e23698b7724a8d356a4fbd1a179891bbb49b7972321de9' THEN RAISE EXCEPTION 'Changed full function metadata: agent_worker_scopes_for_mandate';END IF;
END $predecessors$;

CREATE TABLE public.local_simulator_business_runs(
 run_id text PRIMARY KEY CHECK(run_id~'^[a-z][a-z0-9-]{2,79}$'),
 organization_id text NOT NULL,owner_user_id text NOT NULL,
 runtime_id text NOT NULL UNIQUE CHECK(runtime_id~'^[a-z][a-z0-9-]{2,99}$'),
 enabled boolean NOT NULL DEFAULT true,created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
REVOKE ALL ON public.local_simulator_business_runs FROM PUBLIC,acquire_agent_user,acquire_agent_worker,acquire_campaign_user,acquire_campaign_worker,acquire_communications_writer,communications_control,communications_scoped;
-- Only the separately operated local bootstrap may register a clock. This is
-- evidence/scheduling configuration, never membership or send authority.
CREATE FUNCTION public.local_simulator_business_now() RETURNS timestamptz
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,public AS $clock$
DECLARE run text:=nullif(current_setting('acquire.simulator_business_run',true),'');
 stamp text:=nullif(current_setting('acquire.simulator_business_time',true),'');
 runtime text:=nullif(current_setting('app.acquire_runtime_id',true),'');
 config public.local_simulator_business_runs%ROWTYPE;
BEGIN
 IF run IS NULL AND stamp IS NULL THEN
  IF EXISTS(SELECT 1 FROM public.local_simulator_business_runs WHERE runtime_id=runtime AND enabled) THEN RAISE EXCEPTION 'Configured local clock context missing';END IF;
  RETURN clock_timestamp();
 END IF;
 SELECT * INTO config FROM public.local_simulator_business_runs WHERE run_id=run AND enabled;
 IF config.run_id IS NULL OR config.runtime_id IS DISTINCT FROM runtime
 OR config.organization_id IS DISTINCT FROM current_setting('app.acquire_org',true)
 OR config.owner_user_id IS DISTINCT FROM current_setting('app.acquire_user',true)
 OR stamp IS NULL OR stamp!~'^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d[.]\d{3}Z$'
 OR current_database()<>'acquire_agent_mode'
 OR (SELECT shobj_description(oid,'pg_database') FROM pg_database WHERE datname=current_database()) IS DISTINCT FROM 'acquire-agent-mode-local-only'
 OR (SELECT system_identifier::text FROM pg_control_system())<>'7697400069962248225' THEN RAISE EXCEPTION 'Exact registered business clock scope required';END IF;
 RETURN stamp::timestamptz;
END $clock$;
REVOKE ALL ON FUNCTION public.local_simulator_business_now() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.local_simulator_business_now() TO acquire_agent_user,acquire_agent_worker,acquire_campaign_user,acquire_campaign_worker,acquire_communications_writer,communications_control,communications_scoped;
ALTER TABLE public.agent_events ADD COLUMN operational_not_before_at timestamptz;
ALTER TABLE public.agent_events ALTER COLUMN available_at SET DEFAULT public.local_simulator_business_now();
ALTER TABLE public.agent_operations ADD COLUMN business_completed_at timestamptz;
CREATE FUNCTION public.agent_local_business_completion_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $anchor$
BEGIN
 IF TG_OP='INSERT' THEN
  IF NEW.business_completed_at IS NOT NULL THEN RAISE EXCEPTION 'Business completion is server recorded';END IF;
 ELSIF NEW.business_completed_at IS DISTINCT FROM OLD.business_completed_at THEN RAISE EXCEPTION 'Original business completion is immutable';
 END IF;
 IF nullif(current_setting('acquire.simulator_business_run',true),'') IS NOT NULL
 AND NEW.state IN('complete','failed') AND (TG_OP='INSERT' OR OLD.state IS DISTINCT FROM NEW.state)
 AND NEW.business_completed_at IS NULL THEN
  IF NEW.organization_id IS DISTINCT FROM current_setting('app.acquire_org',true) OR NEW.owner_user_id IS DISTINCT FROM current_setting('app.acquire_user',true) THEN RAISE EXCEPTION 'Original business completion scope differs';END IF;
  NEW.business_completed_at:=public.local_simulator_business_now();
 END IF;
 RETURN NEW;
END $anchor$;
REVOKE ALL ON FUNCTION public.agent_local_business_completion_guard() FROM PUBLIC;
CREATE TRIGGER agent_business_completion_guard BEFORE INSERT OR UPDATE ON public.agent_operations FOR EACH ROW EXECUTE FUNCTION public.agent_local_business_completion_guard();

-- Frozen current predecessor: agent_control_handoff(uuid,uuid,jsonb,text)
CREATE OR REPLACE FUNCTION public.agent_control_handoff(p_mandate uuid, p_key uuid, p_input jsonb, p_digest text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE org text:=current_setting('app.acquire_org',true);actor text:=current_setting('app.acquire_user',true);
 task public.agent_handoffs%ROWTYPE;conv public.agent_conversations%ROWTYPE;prior public.agent_operations%ROWTYPE;op uuid;new_revision integer;action text:=p_input->>'action';next_state text;receipt jsonb;notice jsonb;proof jsonb;request text:='handoff:'||actor||':'||p_key::text;
BEGIN
 PERFORM public.agent_assert_control_scope();
 IF p_digest!~'^[a-f0-9]{64}$' OR octet_length(p_input::text)>6000 THEN RAISE EXCEPTION 'Invalid task command'; END IF;
 SELECT * INTO task FROM public.agent_handoffs h WHERE h.id=(p_input->>'taskId')::uuid AND h.organization_id=org AND h.mandate_id=p_mandate AND (h.owner_user_id=actor OR h.assignee_user_id=actor);
 IF task.id IS NULL OR NOT EXISTS(SELECT 1 FROM public.member WHERE organization_id=org AND user_id=task.owner_user_id) THEN RAISE EXCEPTION 'Task unavailable'; END IF;
 -- Same lock order as ordinary owner commands; serialises owner and assignee.
 PERFORM 1 FROM public.agent_threads WHERE id=task.thread_id FOR UPDATE;
 SELECT * INTO task FROM public.agent_handoffs WHERE id=task.id FOR UPDATE;
 IF actor<>task.owner_user_id AND actor<>task.assignee_user_id THEN RAISE EXCEPTION 'Task assignment changed'; END IF;
 SELECT * INTO prior FROM public.agent_operations WHERE thread_id=task.thread_id AND request_key=request;
 IF prior.id IS NOT NULL THEN
  IF prior.input_digest<>p_digest OR prior.input IS DISTINCT FROM p_input OR prior.state<>'complete' THEN RAISE EXCEPTION 'Task command key reused'; END IF;
  RETURN prior.result;
 END IF;
 SELECT * INTO conv FROM public.agent_conversations WHERE id=task.conversation_id FOR UPDATE;
 IF task.revision<>(p_input->>'revision')::integer OR public.agent_handoff_context(task.id) IS DISTINCT FROM p_input->>'contextRevision' THEN RAISE EXCEPTION 'Task or conversation changed'; END IF;
 IF task.state IN('dismissed','meeting_confirmed') THEN RAISE EXCEPTION 'Task already closed'; END IF;
 IF jsonb_array_length(coalesce(task.human_evidence->'events','[]'::jsonb))>=100 OR octet_length(task.human_evidence::text)+octet_length(p_input::text)>58000 THEN RAISE EXCEPTION 'Task evidence limit reached; manual review required'; END IF;
 next_state:=task.state;
 IF action='acknowledge' THEN
  IF task.state<>'pending' THEN RAISE EXCEPTION 'Task is not pending'; END IF;next_state:='acknowledged';
 ELSIF action='reassign' THEN
  IF actor<>task.owner_user_id OR coalesce(length(p_input->>'assigneeUserId'),0) NOT BETWEEN 1 AND 200 OR NOT EXISTS(SELECT 1 FROM public.member WHERE organization_id=org AND user_id=p_input->>'assigneeUserId') THEN RAISE EXCEPTION 'Current member assignment requires owner'; END IF;
  IF task.assignee_user_id=p_input->>'assigneeUserId' THEN RAISE EXCEPTION 'Task already assigned'; END IF;
 ELSIF action='remind' THEN
  IF jsonb_typeof(p_input->'reminder')<>'object' OR coalesce(length(trim(p_input->'reminder'->>'reason')),0) NOT BETWEEN 1 AND 2000
   OR (p_input->'reminder'->>'wakeAt') IS NULL OR (p_input->'reminder'->>'wakeAt')::timestamptz<=public.local_simulator_business_now()
   OR (p_input->'reminder'->>'wakeAt')::timestamptz>public.local_simulator_business_now()+interval '30 days'
   OR NOT EXISTS(SELECT 1 FROM pg_catalog.pg_timezone_names WHERE name=p_input->'reminder'->>'timeZone') THEN RAISE EXCEPTION 'Bounded internal reminder required'; END IF;
 ELSIF action='dismiss' THEN
  IF coalesce(length(trim(p_input->>'reason')),0) NOT BETWEEN 5 AND 2000 THEN RAISE EXCEPTION 'Dismissal reason required'; END IF;next_state:='dismissed';
 ELSIF action IN('link_sent','meeting_confirmed') THEN
  proof:=p_input->'evidence';
  IF jsonb_typeof(proof)<>'object' OR coalesce(length(trim(proof->>'note')),0) NOT BETWEEN 5 AND 2000 OR coalesce(length(trim(proof->>'externalReference')),0) NOT BETWEEN 3 AND 1000 OR (proof->>'occurredAt') IS NULL OR (proof->>'occurredAt')::timestamptz>public.local_simulator_business_now()+interval '1 minute' THEN RAISE EXCEPTION 'Past external evidence required'; END IF;
  IF action='link_sent' AND (task.state NOT IN('pending','acknowledged') OR conv.driver_kind<>'human' OR conv.phase<>'paused' OR conv.engagement<>'handoff') THEN RAISE EXCEPTION 'Booking-link record unavailable for current conversation'; END IF;
  IF action='meeting_confirmed' AND task.state<>'link_sent' THEN RAISE EXCEPTION 'Link sent is not a confirmed meeting'; END IF;
  next_state:=action;
 ELSE RAISE EXCEPTION 'Invalid task action';END IF;
 INSERT INTO public.agent_operations(thread_id,organization_id,mandate_id,owner_user_id,request_key,name,input,input_digest,state)
 VALUES(task.thread_id,org,p_mandate,task.owner_user_id,request,'human.handoff.'||action,p_input,p_digest,'running') RETURNING id INTO op;
 proof:=jsonb_build_object('action',action,'actorId',actor,'recordedAt',clock_timestamp(),'evidence',p_input->'evidence','reason',p_input->'reason','previousAssignee',task.assignee_user_id,'reminder',p_input->'reminder');
 UPDATE public.agent_handoffs SET state=next_state,assignee_user_id=CASE WHEN action='reassign' THEN p_input->>'assigneeUserId' ELSE assignee_user_id END,
  revision=revision+1,human_evidence=jsonb_set(human_evidence,'{events}',coalesce(human_evidence->'events','[]'::jsonb)||jsonb_build_array(proof)),updated_at=clock_timestamp()
 WHERE id=task.id RETURNING revision INTO new_revision;
 receipt:=jsonb_build_object('id',task.id,'revision',new_revision,'status',next_state);
 UPDATE public.agent_operations SET state='complete',result=receipt,updated_at=clock_timestamp() WHERE id=op;
 INSERT INTO public.audit_events(organization_id,actor_id,action,entity_type,entity_id,metadata)
 VALUES(org,actor,'agent.handoff.'||action,'agent_handoff',task.id::text,jsonb_build_object('revision',new_revision,'commandId',op,'previousState',task.state,'state',next_state));
 notice:=jsonb_build_object('text',CASE action WHEN 'acknowledge' THEN 'The human handoff was acknowledged.' WHEN 'reassign' THEN 'The human handoff was reassigned.' WHEN 'remind' THEN 'An internal human-task reminder was saved. Automation remains paused.' WHEN 'dismiss' THEN 'The human handoff was dismissed. Automation remains paused.' WHEN 'link_sent' THEN 'A human recorded sending the booking link externally. This does not confirm a meeting. Automation remains paused.' ELSE 'A human recorded a confirmed meeting with external evidence. Automation remains paused.' END,'details',receipt||jsonb_build_object('actorId',actor));
 INSERT INTO public.agent_messages(thread_id,organization_id,mandate_id,owner_user_id,request_key,role,content,content_digest)
 VALUES(task.thread_id,org,p_mandate,task.owner_user_id,'handoff-notice:'||op,'assistant',notice,encode(sha256(convert_to(jsonb_build_object('role','assistant','content',notice)::text,'UTF8')),'hex'));
 INSERT INTO public.agent_events(thread_id,organization_id,mandate_id,owner_user_id,event_key,kind,payload,payload_digest)
 VALUES(task.thread_id,org,p_mandate,task.owner_user_id,'handoff-control:'||op,'human.handoff_updated',receipt,encode(sha256(convert_to(receipt::text,'UTF8')),'hex'));
 IF action='remind' THEN
  proof:=jsonb_build_object('taskId',task.id,'revision',new_revision,'assigneeUserId',task.assignee_user_id,'reminder',p_input->'reminder');
  INSERT INTO public.agent_events(thread_id,organization_id,mandate_id,owner_user_id,event_key,kind,payload,payload_digest,available_at)
  VALUES(task.thread_id,org,p_mandate,task.owner_user_id,'handoff-reminder:'||op,'human.handoff_reminder',proof,encode(sha256(convert_to(proof::text,'UTF8')),'hex'),(p_input->'reminder'->>'wakeAt')::timestamptz);
 END IF;
 RETURN receipt;
END $function$
;

-- Frozen current predecessor: agent_registered_worker_scopes(integer,text)
CREATE OR REPLACE FUNCTION public.agent_registered_worker_scopes(p_max integer, p_runtime_id text)
 RETURNS TABLE(organization_id text, owner_user_id text, mandate_id uuid, thread_id uuid, responsibility_id uuid, responsibility_revision integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
BEGIN
 IF current_setting('role',true)<>'acquire_agent_worker' OR p_max IS NULL OR p_max NOT BETWEEN 1 AND 100 OR p_runtime_id IS NULL OR p_runtime_id!~'^[a-z][a-z0-9-]{2,99}$' OR p_runtime_id IS DISTINCT FROM current_setting('app.acquire_runtime_id',true) THEN RAISE EXCEPTION 'Configured registered worker runtime required';END IF;
 RETURN QUERY SELECT g.organization_id,g.owner_user_id,g.mandate_id,g.thread_id,g.responsibility_id,g.responsibility_revision
 FROM public.agent_runtime_registrations g JOIN public.agent_responsibilities r ON r.id=g.responsibility_id AND r.thread_id=g.thread_id
 JOIN public.member m ON m.organization_id=g.organization_id AND m.user_id=g.owner_user_id
 JOIN public.agent_events e ON e.thread_id=g.thread_id AND e.organization_id=g.organization_id AND e.owner_user_id=g.owner_user_id AND e.mandate_id=g.mandate_id
 WHERE g.runtime_id=p_runtime_id AND g.responsibility_revision=r.revision AND public.agent_event_eligible(e.thread_id,e.kind)
 AND e.available_at<=public.local_simulator_business_now() AND (e.operational_not_before_at IS NULL OR e.operational_not_before_at<=clock_timestamp()) AND (nullif(current_setting('acquire.simulator_business_run',true),'') IS NULL OR e.organization_id=current_setting('app.acquire_org',true) AND e.owner_user_id=current_setting('app.acquire_user',true)) AND (e.state='pending' OR e.state='leased' AND e.lease_until<=clock_timestamp())
 AND NOT EXISTS(SELECT 1 FROM public.agent_runs run WHERE run.thread_id=g.thread_id AND run.state='running' AND (run.lease_until IS NULL OR run.lease_until>clock_timestamp()))
 GROUP BY g.organization_id,g.owner_user_id,g.mandate_id,g.thread_id,g.responsibility_id,g.responsibility_revision
 ORDER BY min(e.available_at),g.organization_id,g.owner_user_id,g.mandate_id LIMIT p_max;
END $function$
;

-- Frozen current predecessor: agent_worker_scopes(integer)
CREATE OR REPLACE FUNCTION public.agent_worker_scopes(maximum integer)
 RETURNS TABLE(organization_id text, owner_user_id text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
BEGIN
 IF current_setting('role',true)<>'acquire_agent_worker' OR maximum NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION 'Authenticated agent worker scope required'; END IF;
 RETURN QUERY SELECT r.organization_id,r.owner_user_id FROM public.agent_responsibilities r
 JOIN public.member m ON m.organization_id=r.organization_id AND m.user_id=r.owner_user_id
 JOIN public.agent_events e ON e.thread_id=r.thread_id AND e.organization_id=r.organization_id AND e.owner_user_id=r.owner_user_id
 WHERE public.agent_event_eligible(e.thread_id,e.kind) AND e.available_at<=public.local_simulator_business_now() AND (e.operational_not_before_at IS NULL OR e.operational_not_before_at<=clock_timestamp()) AND (nullif(current_setting('acquire.simulator_business_run',true),'') IS NULL OR e.organization_id=current_setting('app.acquire_org',true) AND e.owner_user_id=current_setting('app.acquire_user',true))
 AND (e.state='pending' OR e.state='leased' AND e.lease_until<=clock_timestamp())
 AND NOT EXISTS(SELECT 1 FROM public.agent_runs run WHERE run.thread_id=r.thread_id AND run.state='running' AND (run.lease_until IS NULL OR run.lease_until>clock_timestamp()))
 GROUP BY r.organization_id,r.owner_user_id ORDER BY min(e.available_at),r.organization_id,r.owner_user_id LIMIT maximum;
END $function$
;

-- Frozen current predecessor: agent_worker_scopes_for_mandate(integer,uuid)
CREATE OR REPLACE FUNCTION public.agent_worker_scopes_for_mandate(maximum integer, selected_mandate uuid)
 RETURNS TABLE(organization_id text, owner_user_id text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
BEGIN
 IF current_setting('role',true)<>'acquire_agent_worker' OR maximum IS NULL OR maximum NOT BETWEEN 1 AND 10 OR selected_mandate IS NULL THEN RAISE EXCEPTION 'Exact authenticated native mandate scope required'; END IF;
 RETURN QUERY SELECT r.organization_id,r.owner_user_id FROM public.agent_responsibilities r
 JOIN public.member m ON m.organization_id=r.organization_id AND m.user_id=r.owner_user_id
 JOIN public.agent_events e ON e.thread_id=r.thread_id AND e.organization_id=r.organization_id AND e.owner_user_id=r.owner_user_id
 WHERE r.mandate_id=selected_mandate AND e.mandate_id=selected_mandate
 AND public.agent_event_eligible(e.thread_id,e.kind) AND e.available_at<=public.local_simulator_business_now() AND (e.operational_not_before_at IS NULL OR e.operational_not_before_at<=clock_timestamp()) AND (nullif(current_setting('acquire.simulator_business_run',true),'') IS NULL OR e.organization_id=current_setting('app.acquire_org',true) AND e.owner_user_id=current_setting('app.acquire_user',true))
 AND (e.state='pending' OR e.state='leased' AND e.lease_until<=clock_timestamp())
 AND NOT EXISTS(SELECT 1 FROM public.agent_runs run WHERE run.thread_id=r.thread_id AND run.state='running' AND (run.lease_until IS NULL OR run.lease_until>clock_timestamp()))
 GROUP BY r.organization_id,r.owner_user_id ORDER BY min(e.available_at),r.organization_id,r.owner_user_id LIMIT maximum;
END $function$
;
