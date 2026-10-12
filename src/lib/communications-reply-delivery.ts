import 'server-only';
import { createCommunicationReplyConsumer, type CommunicationReplyConsumerOptions } from './communications-reply-consumer';
import { createOutboxDeliveryWorker, type EventOutboxPort } from '../../communications/packages/core/src/outbox-delivery';
/** Service and Acquire keep separate transactions. Only a resolved Acquire consumer commit can
 * produce the exact service ACK receipt; a lost response replays that app receipt before ACK.
 * This composes injected trusted repositories, not an HTTP authentication or send-readiness route. */
export function createCommunicationReplyDeliveryWorker(options: CommunicationReplyConsumerOptions & {
    outbox: EventOutboxPort;
    timeoutMs?: number;
}) {
    const consumer = createCommunicationReplyConsumer(options), bindingId = options.bindingId;
    return createOutboxDeliveryWorker({ binding: options.binding, subscriberId: options.subscriberId, outbox: options.outbox, timeoutMs: options.timeoutMs,
        async apply(delivery, signal) {
            if (signal.aborted)
                throw Error('Reply delivery deadline reached');
            const result = await consumer.apply({ binding: delivery.binding, bindingId, subscriberId: delivery.subscriberId, serviceEventId: delivery.eventId, sourceKey: delivery.sourceEventKey, payload: delivery.payload });
            if (signal.aborted || !result || !['applied', 'duplicate', 'review'].includes(result.status) || !['stop', 'ignore', 'review'].includes(result.decision) || result.status === 'review' && result.decision !== 'review')
                throw Error('Reply transaction unavailable');
            return { binding: delivery.binding, subscriberId: delivery.subscriberId, eventId: delivery.eventId, fingerprint: delivery.payload.fingerprint, status: result.status === 'duplicate' ? 'duplicate' : 'committed' };
        },
    });
}
