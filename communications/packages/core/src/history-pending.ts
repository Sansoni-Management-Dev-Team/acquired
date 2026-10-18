/** Trusted database-only pending reply observation. Carries no message or scope data. */
export class ReplyProcessingPendingError extends Error {
 constructor(){super('Recorded reply processing is pending');this.name='ReplyProcessingPendingError';}
}
