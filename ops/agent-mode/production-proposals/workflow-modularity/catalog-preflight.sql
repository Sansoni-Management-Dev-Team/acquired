-- WF-01 READ-ONLY catalog inventory; NOT an application migration or approval bundle.
-- Caller must enforce a read-only transaction and a short statement timeout (e.g. 5s)
-- plus a client deadline. This file deliberately contains SELECT statements only:
-- no SET/BEGIN/DDL, application functions, business-row reads or dynamic SQL.
-- Do not run against the user's occupied local simulator database.
-- Function bodies are schema evidence; keep the returned inventory private until
-- reviewed for historical embedded configuration. Do not paste raw output into Plane.
-- Source inventory: local migrations 0065/0066/0068/0070/0072. Installed direct
-- references and trigger functions seed a transitive static public-function call
-- closure, including overloads, to detect later overrides. Dynamically constructed
-- function names cannot be proven by this static catalog scan and need source review.

WITH RECURSIVE wanted_tables(name) AS (
  SELECT unnest(ARRAY[
    'mandates',
    'member',
    'mandate_targets',
    'targets',
    'contacts',
    'research_jobs',
    'agent_threads',
    'agent_runs',
    'agent_events',
    'agent_responsibilities',
    'agent_runtime_registrations',
    'agent_mandate_execution_modes',
    'agent_demo_runs',
    'agent_demo_mapping_requests',
    'agent_demo_mapping_receipts',
    'agent_demo_contact_mappings',
    'agent_conversations',
    'agent_conversation_channels',
    'agent_operations',
    'agent_person_claims',
    'agent_review_batches',
    'campaign_enrolments',
    'campaign_send_attempts',
    'sequence_enrolments',
    'outreach_draft_bindings',
    'messages',
    'communication_dispatch_intents',
    'communication_dispatch_permits',
    'communication_submission_receipts',
    'communication_bindings',
    'agent_production_schema_migrations'
  ]::text[])
), wanted_functions(name) AS (
  SELECT unnest(ARRAY[
    'agent_allocate_channel_target',
    'agent_allowed_mandate_binding',
    'agent_assert_execution_context_scope',
    'agent_assert_mandate_outreach_mode',
    'agent_assert_manual_mandate_outreach_mode',
    'agent_channel_communications_change',
    'agent_channel_local_binding',
    'agent_channel_operation_before_invitations',
    'agent_channel_proposal_permitted',
    'agent_channel_reserved_recipient',
    'agent_contact_delivery_recipients',
    'agent_delivery_candidate_projection',
    'agent_delivery_contact_projection',
    'agent_demo_contact_fingerprint',
    'agent_demo_evidence_immutable',
    'agent_demo_evidence_insert_guard',
    'agent_demo_execution_readiness',
    'agent_demo_manual_outreach_guard',
    'agent_demo_original_effect_identity_guard',
    'agent_demo_run_bindings_match',
    'agent_demo_runtime_ready',
    'agent_demo_wire_valid',
    'agent_effective_contact',
    'agent_intent_execution_context_guard',
    'agent_invitation_operation_authorised',
    'agent_is_demo_origin',
    'agent_is_original_demo_source',
    'agent_load_mandate_execution_context',
    'agent_load_mandate_research_context',
    'agent_mandate_execution_mode_immutable',
    'agent_mandate_identity_scope',
    'agent_mandate_legacy_sequence_occupied',
    'agent_mandate_outreach_mode_guard',
    'agent_mandate_person_has_unresolved_sends',
    'agent_mandate_person_keys',
    'agent_manual_target_snapshot',
    'agent_origin_mandate',
    'agent_person_has_unresolved_sends',
    'agent_person_unresolved_before_invitations',
    'agent_recorded_demo_route_matches',
    'agent_recorded_reply_execution_scope',
    'agent_recorded_reply_identity_registration',
    'agent_register_channel',
    'agent_review_history_holds_clear',
    'agent_route_execution_permitted',
    'agent_same_execution_identity_scope',
    'agent_save_channel_policy',
    'agent_target_snapshot',
    'communications_submission_receipt_guard',
    'communications_submission_receipt_immutable'
  ]::text[])
), relations AS (
  SELECT c.* FROM pg_catalog.pg_class c
  JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
  JOIN wanted_tables w ON w.name=c.relname
  WHERE n.nspname='public' AND c.relkind IN ('r','p','v','m')
), seed_functions AS (
  SELECT p.* FROM pg_catalog.pg_proc p
  JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='public' AND p.prokind IN ('f','p') AND (
    EXISTS (SELECT 1 FROM wanted_functions f WHERE f.name=p.proname)
    OR EXISTS (SELECT 1 FROM pg_catalog.pg_trigger t JOIN relations r ON r.oid=t.tgrelid WHERE t.tgfoid=p.oid AND NOT t.tgisinternal)
    OR p.prosrc ~ '(agent_mandate_execution_modes|agent_demo_mapping_requests|agent_demo_mapping_receipts|agent_demo_contact_mappings|agent_is_demo_origin|agent_effective_contact|agent_mandate_identity_scope|agent_load_mandate_execution_context|agent_assert_manual_mandate_outreach_mode)'
  )
), public_function_calls AS (
  -- Static call graph, including every overload of a referenced public name.
  -- Regex extraction only; this never invokes an application function.
  SELECT DISTINCT caller.oid AS caller_oid,callee.oid AS callee_oid
  FROM pg_catalog.pg_proc caller
  JOIN pg_catalog.pg_namespace caller_ns ON caller_ns.oid=caller.pronamespace AND caller_ns.nspname='public'
  CROSS JOIN LATERAL regexp_matches(caller.prosrc,'([a-z_][a-z0-9_]*)[[:space:]]*[(]','gi') called
  JOIN pg_catalog.pg_proc callee ON callee.proname=lower(called[1]) AND callee.prokind IN ('f','p')
  JOIN pg_catalog.pg_namespace callee_ns ON callee_ns.oid=callee.pronamespace AND callee_ns.nspname='public'
  WHERE caller.prokind IN ('f','p')
), function_closure(oid) AS (
  SELECT oid FROM seed_functions
  UNION
  SELECT edge.callee_oid FROM function_closure parent
  JOIN public_function_calls edge ON edge.caller_oid=parent.oid
), selected_functions AS (
  SELECT p.* FROM pg_catalog.pg_proc p JOIN function_closure c ON c.oid=p.oid
), evidence(section,identity,detail) AS (
  SELECT 'identity',current_database()::text,jsonb_build_object(
    'database',current_database(),'role',current_user,'serverVersion',current_setting('server_version'),
    'systemIdentifier',(SELECT system_identifier::text FROM pg_catalog.pg_control_system()),
    'transactionReadOnly',current_setting('transaction_read_only'),
    'statementTimeout',current_setting('statement_timeout'),
    'databaseMarker',pg_catalog.shobj_description(d.oid,'pg_database'))
  FROM pg_catalog.pg_database d WHERE d.datname=current_database()
  UNION ALL
  SELECT 'table-presence',w.name::text,jsonb_build_object('present',r.oid IS NOT NULL)
  FROM wanted_tables w LEFT JOIN relations r ON r.relname=w.name
  UNION ALL
  SELECT 'tables',r.relname::text,jsonb_build_object('kind',r.relkind,'owner',pg_catalog.pg_get_userbyid(r.relowner),
    'rlsEnabled',r.relrowsecurity,'rlsForced',r.relforcerowsecurity,'acl',r.relacl::text)
  FROM relations r
  UNION ALL
  SELECT 'columns',r.relname||'.'||a.attname,jsonb_build_object('position',a.attnum,
    'type',pg_catalog.format_type(a.atttypid,a.atttypmod),'notNull',a.attnotnull,
    'default',pg_catalog.pg_get_expr(d.adbin,d.adrelid),'identity',a.attidentity,'generated',a.attgenerated)
  FROM relations r JOIN pg_catalog.pg_attribute a ON a.attrelid=r.oid AND a.attnum>0 AND NOT a.attisdropped
  LEFT JOIN pg_catalog.pg_attrdef d ON d.adrelid=r.oid AND d.adnum=a.attnum
  UNION ALL
  SELECT 'constraints',c.conrelid::regclass::text||'.'||c.conname,jsonb_build_object(
    'type',c.contype,'validated',c.convalidated,'deferrable',c.condeferrable,'initiallyDeferred',c.condeferred,
    'definition',pg_catalog.pg_get_constraintdef(c.oid,true))
  FROM pg_catalog.pg_constraint c
  WHERE c.conrelid IN (SELECT oid FROM relations) OR c.confrelid IN (SELECT oid FROM relations)
  UNION ALL
  SELECT 'indexes',i.indexrelid::regclass::text,jsonb_build_object('table',i.indrelid::regclass::text,
    'valid',i.indisvalid,'ready',i.indisready,'unique',i.indisunique,'definition',pg_catalog.pg_get_indexdef(i.indexrelid))
  FROM pg_catalog.pg_index i WHERE i.indrelid IN (SELECT oid FROM relations)
  UNION ALL
  SELECT 'triggers',t.tgrelid::regclass::text||'.'||t.tgname,jsonb_build_object(
    'enabled',t.tgenabled,'function',t.tgfoid::regprocedure::text,'definition',pg_catalog.pg_get_triggerdef(t.oid,true))
  FROM pg_catalog.pg_trigger t WHERE t.tgrelid IN (SELECT oid FROM relations) AND NOT t.tgisinternal
  UNION ALL
  SELECT 'policies',p.polrelid::regclass::text||'.'||p.polname,jsonb_build_object(
    'command',p.polcmd,'permissive',p.polpermissive,
    'roles',(SELECT jsonb_agg(CASE WHEN x=0 THEN 'PUBLIC' ELSE pg_catalog.pg_get_userbyid(x) END ORDER BY x) FROM unnest(p.polroles) x),
    'using',pg_catalog.pg_get_expr(p.polqual,p.polrelid),'withCheck',pg_catalog.pg_get_expr(p.polwithcheck,p.polrelid))
  FROM pg_catalog.pg_policy p WHERE p.polrelid IN (SELECT oid FROM relations)
  UNION ALL
  SELECT 'function-presence',w.name::text,jsonb_build_object('present',EXISTS(SELECT 1 FROM selected_functions p WHERE p.proname=w.name))
  FROM wanted_functions w
  UNION ALL
  SELECT 'functions',p.oid::regprocedure::text,jsonb_build_object(
    'identityArguments',pg_catalog.pg_get_function_identity_arguments(p.oid),'result',pg_catalog.pg_get_function_result(p.oid),
    'owner',pg_catalog.pg_get_userbyid(p.proowner),'securityDefiner',p.prosecdef,'volatility',p.provolatile,
    'configuration',p.proconfig,'acl',p.proacl::text,'definition',pg_catalog.pg_get_functiondef(p.oid))
  FROM selected_functions p
)
SELECT section,identity,detail FROM evidence ORDER BY section,identity;

-- The production ledger is expected to exist; a missing table is a failed
-- prerequisite, not an invitation to create it. Contains artifact metadata only.
SELECT artifact,installed_at,source_revision
FROM public.agent_production_schema_migrations
ORDER BY artifact;
