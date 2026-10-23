/** A verified channel history was persisted; the durable event can resume the
 * remaining routes without repeating any outbound operation. */
export class AgentHistoryCheckpointPendingError extends Error {
 constructor(){super('Recorded channel history checkpoint saved');this.name='AgentHistoryCheckpointPendingError';}
}
