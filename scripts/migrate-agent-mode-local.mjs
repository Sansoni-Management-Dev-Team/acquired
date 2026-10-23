import pg from 'pg';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { agentDatabaseConfig, assertAgentDatabaseIdentity } from './agent-mode-local-database.mjs';
if (!process.argv.includes('--apply-isolated-local')) throw new Error('Explicit --apply-isolated-local required; no automatic migration at startup');
const migrations=['0001-agent-state.sql','0002-agent-scope-fences.sql','0003-agent-history-retention.sql','0004-agent-conversation-turns.sql','0005-agent-review-state.sql','0006-agent-execution-control.sql','0007-agent-public-context.sql','0008-agent-ownership-reconciliation.sql','0009-agent-sequence-handover.sql','0010-agent-local-member-fence.sql','0011-agent-handoff-controls.sql','0012-agent-delegation-policy.sql','0013-agent-communications-source.sql','0014-agent-handoff-integrity.sql','0015-agent-research-launch.sql','0016-agent-handoff-reminders.sql','0017-agent-history-account-guard.sql','0018-agent-firmable-execution.sql','0019-agent-email-reply-parent.sql','0020-agent-target-selection.sql','0021-agent-research-counts.sql','0022-agent-incoming-email-events.sql','0023-agent-people-phase.sql','0024-agent-incoming-conversation-dedup.sql','0025-agent-canonical-alias-performance.sql','0026-agent-sequence-drafts.sql','0027-agent-sequence-publication.sql','0028-agent-no-submission-reconciliation.sql','0030-agent-sequence-enrolment.sql','0031-agent-safe-event-eligibility.sql','0032-agent-sequence-audit.sql','0033-agent-company-guidance-evidence.sql','0034-agent-delivery-failure-events.sql','0035-agent-manual-feedback-source.sql','0036-agent-isolated-communications-storage.sql','0037-agent-worker-mandate-scope.sql','0038-agent-simulator-sending-policy.sql','0039-agent-isolated-pilot-policy.sql','0040-agent-receipt-association-wake.sql','0041-agent-fifty-pilot-policy.sql','0042-agent-person-channels.sql','0043-agent-runtime-registry.sql','0044-agent-manual-contact-targets.sql','0045-agent-channel-target-allocation.sql','0046-agent-channel-no-submission.sql','0047-agent-linkedin-invitations.sql','0048-agent-channel-incoming.sql','0049-agent-channel-due-events.sql','0050-agent-channel-allocation-review-alias.sql','0051-agent-sequence-channel-handover.sql','0052-agent-unrelated-review-ingress.sql','0053-agent-channel-reply-grants.sql','0054-agent-review-dependency-recovery.sql','0055-agent-untracked-outbound-review.sql','0056-agent-untracked-review-recovery.sql','0057-agent-untracked-capture-timestamps.sql','0058-agent-untracked-review-authority-locks.sql','0059-agent-invitation-exact-admission.sql','0060-agent-simultaneous-reply-routes.sql','0061-agent-routed-email-receipt-wake.sql','0062-agent-warm-reply-continuity.sql','0063-agent-verified-unread-history-refresh.sql','0064-agent-whatsapp-canonical-source-ingress.sql','0065-agent-mandate-execution-mode.sql','0066-agent-demo-contact-projections.sql','0067-agent-hybrid-native-research.sql','0068-agent-demo-manual-outreach-fence.sql','0069-agent-public-fields-research.sql','0071-agent-research-phase-budgets.sql','0070-agent-mandate-execution-context.sql','0072-agent-demo-original-effect-identity.sql','0074-company-canonical-identity.sql','0075-agent-company-membership-projection.sql','0076-company-sync-observations.sql','0077-agent-fields-current-company-source.sql','0078-agent-readable-company-control-context.sql','0079-agent-identity-batches.sql','0080-agent-local-business-clock.sql','0081-agent-local-business-consumers.sql','0082-agent-local-submission-business-clock.sql','0083-agent-reply-causal-turn.sql','0084-agent-email-causal-optional-conversation.sql','0085-agent-cold-quiet-business-clock.sql','0086-agent-company-only-funding.sql','0087-agent-company-continuation.sql','0088-agent-company-continuation-reader.sql','0089-agent-automatic-basic-people.sql','0090-agent-automatic-people-context-domain.sql'];
const selected=process.argv.find(value=>value.startsWith('--migration='))?.slice('--migration='.length);
if(!selected||!migrations.includes(selected))throw new Error('Select exactly the specifically approved artifact with --migration=<name>');
const client = new pg.Client({ connectionString: agentDatabaseConfig().url });
await client.connect();
try {
  assertAgentDatabaseIdentity((await client.query("SELECT current_database() AS database,shobj_description(oid,'pg_database') AS marker FROM pg_database WHERE datname=current_database()")).rows[0]);
  await client.query('BEGIN');
  await client.query('SELECT pg_advisory_xact_lock(1094930773,2901)');
  await client.query('CREATE TABLE IF NOT EXISTS agent_local_migrations(name text PRIMARY KEY,sha256 text NOT NULL,applied_at timestamptz NOT NULL DEFAULT now())');
  const results=[];
  for (const name of migrations.slice(0,migrations.indexOf(selected)+1)) {
    const sql=readFileSync(new URL('../ops/agent-mode/migrations/'+name,import.meta.url),'utf8');
    const hash=createHash('sha256').update(sql).digest('hex');
    const prior=(await client.query('SELECT sha256 FROM agent_local_migrations WHERE name=$1',[name])).rows[0];
    if (prior && prior.sha256!==hash) throw new Error('Applied migration changed; prepare a new forward migration');
    if (!prior) {
      if(name!==selected)throw new Error('Predecessor not applied; approval for the selected migration does not authorise another artifact');
      await client.query(sql);
      await client.query('INSERT INTO agent_local_migrations(name,sha256) VALUES($1,$2)',[name,hash]);
    }
    results.push({name,sha256:hash,applied:!prior});
  }
  await client.query('COMMIT');
  console.log(JSON.stringify({database:agentDatabaseConfig().database,migrations:results}));
} catch(error) {await client.query('ROLLBACK'); throw error;} finally {await client.end();}
