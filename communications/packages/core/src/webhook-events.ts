import type { ConnectionBinding, CommunicationEvent } from '../../contracts/src';
import { createReplyProcessor, type ClaimedWebhook, type ReplyNormalization, type WebhookClaim } from './reply-ingress';

export type NormalizedWebhookOutcome =
  | { kind: 'event'; event: CommunicationEvent; eventKey: string; fingerprint: string }
  | { kind: 'ignore'; reason: string }
  | { kind: 'review'; code: 'protocol' | 'account_changed' | 'identity_pending' };
export interface NormalizedWebhookPort {
  claim(input: { binding: ConnectionBinding; key: string }): Promise<WebhookClaim>;
  /** One service transaction: recheck current grant/generation/claim; compare semantic
   * fingerprints; persist encrypted event + scoped subscriber outbox + terminal inbox.
   * Review invalidates coverage and queues a review event. No application person IDs.
   * Resolve only after commit; no send-readiness or application acknowledgement implied. */
  finish(input: { record: ClaimedWebhook; outcome: NormalizedWebhookOutcome }): Promise<{ binding: ConnectionBinding; key: string; committed: boolean }>;
}
export interface WebhookEventProcessorOptions {
  binding: ConnectionBinding;
  journal: NormalizedWebhookPort;
  normalize(raw: unknown, binding: ConnectionBinding): Promise<ReplyNormalization>;
}
/** The reusable service ends at normalized events. Application reply policy runs
 * in its own receipt/hold transaction, then acknowledges the scoped outbox. */
export function createWebhookEventProcessor(options: WebhookEventProcessorOptions): { process(key: string): Promise<{ status: 'processed' | 'duplicate' | 'busy' | 'retry' | 'forbidden' }> } {
  const finish=options.journal.finish.bind(options.journal);
  // Reuse the strict claim, UTF-8, event, semantic-key and fingerprint validation.
  // An empty resolver deliberately contains no application policy or person IDs.
  const processor=createReplyProcessor({binding:options.binding,normalize:options.normalize.bind(options),resolve:async()=>[],journal:{claim:options.journal.claim.bind(options.journal),async finish(input){
    let outcome:NormalizedWebhookOutcome;
    if(input.decision.action==='review')outcome={kind:'review',code:input.decision.code};
    else if(input.event && input.eventKey && input.eventFingerprint)outcome={kind:'event',event:input.event,eventKey:input.eventKey,fingerprint:input.eventFingerprint};
    else if(input.decision.action==='ignore')outcome={kind:'ignore',reason:input.decision.reason};
    else outcome={kind:'review',code:'protocol'};
    return finish({record:input.record,outcome});
  }}});
  return {async process(key){const result=await processor.process(key);return {status:result.status};}};
}
