import {readFileSync} from 'node:fs';import {it,expect} from 'vitest';
it('retains every original native cadence condition and changes only the window predicate',()=>{
 const old=readFileSync('ops/agent-mode/migrations/0012-agent-delegation-policy.sql','utf8'),next=readFileSync('ops/agent-mode/migrations/0038-agent-simulator-sending-policy.sql','utf8');
 const original=old.slice(old.indexOf('CREATE FUNCTION agent_native_sending_policy'),old.indexOf('ALTER FUNCTION agent_operation_authorised'));
 const replacement=next.slice(next.indexOf('CREATE OR REPLACE FUNCTION agent_native_sending_policy'));
 expect(replacement.replace('CREATE OR REPLACE FUNCTION','CREATE FUNCTION').replace(' AND NOT public.agent_simulator_window_exception(conv.mandate_id,conv.binding_id,conv.binding_digest,conv.recipient_email,clock_timestamp())','')).toBe(original);
 expect(next).not.toMatch(/INSERT INTO|GRANT .*agent_simulator_test_policies/);
});
