-- One exact user-requested local test-data cancellation. Not for hosted/production.
-- Standing local agent-build approval applies only to marked APP5437.
-- Run in a transaction with the reviewed codec envelope supplied by the private runner.
-- Keeps the charged quota and original application conversation held. Never claims delivery.
DO $repair$
DECLARE original_definition text; replacement_definition text; needle text;
 original_row communications.operation_journal%ROWTYPE; changed integer;
BEGIN
 IF current_database()<>'acquire_agent_mode'
 OR (SELECT shobj_description(oid,'pg_database') FROM pg_database WHERE datname=current_database()) IS DISTINCT FROM 'acquire-agent-mode-local-only'
 OR (SELECT system_identifier::text FROM pg_control_system())<>'7697400069962248225'
 THEN RAISE EXCEPTION 'Wrong isolated database'; END IF;
 IF current_setting('repair.evidence_digest')<>'32157810c0717cea18372c708e31dcbd496679aa1e895462a87f96f2d123fa7e'
 OR current_setting('repair.request_id')<>'d9184f46-0cb9-4a2f-bb9a-d3def957910b'
 THEN RAISE EXCEPTION 'Unreviewed cancellation'; END IF;
 -- No other session can observe or use the temporary, exact-row transition.
 LOCK TABLE communications.operation_journal IN ACCESS EXCLUSIVE MODE;
 SELECT * INTO STRICT original_row FROM communications.operation_journal
 WHERE id='47cccf61-24db-4da6-bad7-60c4aca5d5b7'
 AND operation_key='acquire:agent:807d3614-ca7a-4fa0-a77c-39c7b579f341:1'
 AND application_id='acquire' AND tenant_id='m8qeFHRPVOUAgbBRq3sOFGXo3XE2aYFo'
 AND owner_id='yJPrXFrkU8VWyiX47yRUAv6lIaGvyMSk'
 AND account_id=current_setting('repair.account_id') AND generation=1
 AND state='unknown' AND quota_reserved AND encrypted_receipt IS NULL AND submitted_at IS NULL
 AND date_trunc('milliseconds',updated_at)='2026-10-23T23:04:22.038Z' FOR UPDATE;
 IF NOT EXISTS(SELECT 1 FROM communications.dispatch_admissions WHERE id='028ce68e-5835-41e4-8535-cdcb57a3d49c' AND journal_id=original_row.id)
 THEN RAISE EXCEPTION 'Original admission changed'; END IF;
 SELECT pg_get_functiondef('communications.protect_operation()'::regprocedure) INTO original_definition;
 IF md5(original_definition)<>current_setting('repair.trigger_hash') THEN RAISE EXCEPTION 'Guard definition changed'; END IF;
 needle := 'OLD.state = ''unknown'' AND NEW.state = ''submitted'' AND OLD.quota_reserved AND NEW.resolution_evidence_digest IS NOT NULL';
 IF strpos(original_definition,needle)=0 THEN RAISE EXCEPTION 'Guard structure changed'; END IF;
 replacement_definition := replace(original_definition,needle,'('||needle||') OR (OLD.id=''47cccf61-24db-4da6-bad7-60c4aca5d5b7'' AND OLD.state=''unknown'' AND NEW.state=''rejected'' AND NEW.failure_code=''operator_cancelled_local_test'' AND NEW.resolution_evidence_digest=''32157810c0717cea18372c708e31dcbd496679aa1e895462a87f96f2d123fa7e'')');
 EXECUTE replacement_definition;
 UPDATE communications.operation_journal SET state='rejected',outcome_status='rejected',
 encrypted_outcome=current_setting('repair.encrypted_outcome'),outcome_key_version=current_setting('repair.outcome_version'),
 failure_code='operator_cancelled_local_test',resolution_evidence_digest=current_setting('repair.evidence_digest'),updated_at=clock_timestamp()
 WHERE id=original_row.id AND state='unknown';
 GET DIAGNOSTICS changed=ROW_COUNT;
 IF changed<>1 THEN RAISE EXCEPTION 'Cancellation count differs'; END IF;
 EXECUTE original_definition;
 IF pg_get_functiondef('communications.protect_operation()'::regprocedure)<>original_definition THEN RAISE EXCEPTION 'Guard was not restored'; END IF;
 INSERT INTO public.audit_events(id,organization_id,actor_id,action,entity_type,entity_id,"before","after",metadata)
 SELECT current_setting('repair.request_id')::uuid,original_row.tenant_id,original_row.owner_id,
 'local_simulator.operator_cancel_unknown','communications.operation_journal',original_row.id::text,
 to_jsonb(original_row),to_jsonb(j),current_setting('repair.evidence')::jsonb
 FROM communications.operation_journal j WHERE j.id=original_row.id;
END $repair$;
