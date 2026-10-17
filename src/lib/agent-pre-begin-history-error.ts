/** Server-only dispatch evidence: this error is emitted solely by the read-only
 * refresh boundary before native begin, reservations, intent creation or sends. */
export class AgentPreBeginHistoryError extends Error{
 constructor(readonly threadId:string,readonly conversationId:string,readonly operationId:string,readonly historyError:unknown){super('Recorded history verification failed before outbound admission.');this.name='AgentPreBeginHistoryError';Object.defineProperty(this,'historyError',{value:historyError,enumerable:false});}
}
