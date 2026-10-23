import {assertAgentBusinessTimeScope,type AgentBusinessTimeContext} from './agent-business-time';
/** Trusted configured adapter only, after a current no-effect proof and before
 * native begin. Waiting preserves the original approval; it grants no effect. */
export class AgentPreBeginSendWindowError extends Error{
 constructor(readonly threadId:string,readonly conversationId:string,readonly operationId:string,readonly wakeAt:string,readonly businessContext?:AgentBusinessTimeContext){super('Waiting for the next permitted sending window.');if(businessContext)assertAgentBusinessTimeScope(businessContext,businessContext.scope);this.name='AgentPreBeginSendWindowError';}
}
