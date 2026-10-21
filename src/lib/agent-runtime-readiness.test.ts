import {expect,it} from 'vitest';
import {agentReadinessReason} from './agent-runtime-readiness';
it('explains registered-runtime and explicit account-selection blockers without internal codes',()=>{
 expect(agentReadinessReason('registered_runtime_not_configured')).toBe('The background runtime is not configured. Ask the operator to finish local setup.');
 expect(agentReadinessReason('choose_recorded_account')).toBe('Review and confirm the sender accounts in chat.');
});
