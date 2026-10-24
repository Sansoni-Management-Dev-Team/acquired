import {expect,it} from 'vitest';
import {agentReadinessReason} from './agent-runtime-readiness';
it('explains registered-runtime and explicit account-selection blockers without internal codes',()=>{
 expect(agentReadinessReason('registered_runtime_not_configured')).toBe('The background runtime is not configured. Ask the operator to finish local setup.');
 expect(agentReadinessReason('choose_recorded_account')).toBe('Review and confirm the sender accounts in chat.');
});
import {agentRuntimeConfiguration} from './agent-runtime-readiness';
it('uses the reviewed shared agent model selection for credential readiness',()=>{
 expect(agentRuntimeConfiguration({AGENT_AI_PROVIDER:'anthropic',AGENT_DECISION_MODEL:'claude-haiku-5-5',ANTHROPIC_API_KEY:'test-only'}).modelConfigured).toBe(true);
 expect(agentRuntimeConfiguration({AGENT_AI_PROVIDER:'anthropic',AGENT_DECISION_MODEL:'claude-haiku-5-5',OPENAI_API_KEY:'test-only'}).modelConfigured).toBe(false);
 expect(agentRuntimeConfiguration({OPENAI_API_KEY:'test-only'}).modelConfigured).toBe(true);
 expect(agentRuntimeConfiguration({AGENT_AI_PROVIDER:'anthropic',AGENT_DECISION_MODEL:'unreviewed',ANTHROPIC_API_KEY:'test-only'}).modelConfigured).toBe(false);
});
