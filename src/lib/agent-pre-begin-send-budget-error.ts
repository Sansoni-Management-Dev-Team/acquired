/** Emitted only when the native send reservation transaction rolls back before
 * any dispatch intent. This is a review stop, never permission to retry. */
export class AgentPreBeginSendBudgetError extends Error{
 constructor(readonly threadId:string,readonly conversationId:string,readonly operationId:string){
  super('A shared sending limit has been reached or needs renewing. This message was not sent. Check sending limits before continuing.');
  this.name='AgentPreBeginSendBudgetError';
 }
}
