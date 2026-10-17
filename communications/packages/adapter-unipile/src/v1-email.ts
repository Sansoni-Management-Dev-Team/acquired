import {createHash} from 'node:crypto';
import { types } from 'node:util';
import { performance } from 'node:perf_hooks';
import { assertSameBinding, ContractError, type ActionReceipt, type CanonicalIdentity, type Capabilities, type ConnectionBinding, type ConnectionRecord, type DeliveryOutcome, type MessagingAdapter, type OperationSnapshot, type ProviderReference, type Readiness } from '../../contracts/src';
import { messageDigest } from '../../core/src/message-digest';
import { normalizeV1AccountReadiness } from './v1-normalization';
import type { UnipileHttpResult, UnipileRequestOptions } from './http-core';
import type { UnipileV1EmailPayload } from './v1-http';
export interface UnipileV1EmailPort {
    getAccount(id: string, options?: UnipileRequestOptions): Promise<UnipileHttpResult>;
    getEmail(accountId: string, id: string, options?: UnipileRequestOptions): Promise<UnipileHttpResult>;
    sendEmail(accountId: string, payload: UnipileV1EmailPayload, key: string, options?: UnipileRequestOptions): Promise<UnipileHttpResult>;
}
/** Original, persisted message evidence. Never infer this association from a provider search. */
export interface VerifiedV1EmailOriginal {
    providerAccountId: string;
    recipient: CanonicalIdentity;
    message: ProviderReference;
    rfcMessageId: string;
    conversation?: ProviderReference;
}
export interface UnipileV1EmailAdapterOptions {
    connection: ConnectionRecord;
    providerAccountId: string;
    sourceId: string;
    ownerAddresses: readonly string[];
    transport: UnipileV1EmailPort;
    timeoutMs?: number;
    /** Required physical mailbox ownership/alias authority; an OK source is insufficient. */
    verifyOwner(input: {
        binding: ConnectionBinding;
        providerAccountId: string;
        sourceId: string;
        account: unknown;
        ownerAddresses: readonly string[];
        signal: AbortSignal;
    }): Promise<boolean>;
    /** Required original operation/message/thread correlation, backed by trusted recorded evidence. */
    verifyOriginal(input: {
        snapshot: OperationSnapshot;
        recipient: CanonicalIdentity;
        message?: ProviderReference;
        conversation?: ProviderReference;
        rfcMessageId?: string;
        signal: AbortSignal;
    }): Promise<VerifiedV1EmailOriginal | null>;
}
function observed(value: unknown): void {
    if (types.isPromise(value))
        void Promise.prototype.then.call(value, undefined, () => { });
}
function data(value: unknown, seen = new Set<object>()): void {
    if (value === null || typeof value !== 'object') {
        if (!['string', 'number', 'boolean', 'undefined'].includes(typeof value) && value !== null)
            throw new Error();
        return;
    }
    observed(value);
    if (types.isProxy(value) || seen.has(value) || (!Array.isArray(value) && ![Object.prototype, null].includes(Object.getPrototypeOf(value))))
        throw new Error();
    seen.add(value);
    const descriptors = Object.getOwnPropertyDescriptors(value);
    for (const key of Reflect.ownKeys(descriptors)) {
        if (typeof key !== 'string' || !('value' in descriptors[key]))
            throw new Error();
        data(descriptors[key].value, seen);
    }
    seen.delete(value);
}
function copied<T>(value: T): T {
    try {
        data(value);
        return structuredClone(value);
    }
    catch {
        throw new ContractError('operation_conflict');
    }
}
const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const exact = (v: unknown, keys: string[]) => record(v) && Object.keys(v).every(k => keys.includes(k));
const id = (v: unknown): v is string => typeof v === 'string' && v.length > 0 && v.length <= 2048 && v === v.trim() && v !== '.' && v !== '..' && !/[\u0000-\u001f\u007f]/.test(v);
const email = (v: unknown): v is string => typeof v === 'string' && v.length <= 320 && v === v.toLowerCase() && /^[^@\s<>]+@[^@\s<>]+\.[^@\s<>]+$/.test(v);
const recipientOK = (v: unknown): v is CanonicalIdentity => record(v) && exact(v, ['kind', 'value']) && v.kind === 'email' && email(v.value);
const rfc = (v: unknown): v is string => typeof v === 'string' && v.length <= 998 && /^<[^<>@\s]+@[^<>@\s]+>$/.test(v);
const timestamp = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(v) && Number.isFinite(Date.parse(v)) && new Date(v).toISOString() === v;
function readFailure(result: UnipileHttpResult): Exclude<Readiness, {
    status: 'ready';
}> {
    if (result.kind === 'rejected') {
        if (result.reason === 'authentication')
            return { status: 'review', code: 'reconnect' };
        if (result.reason === 'authorization')
            return { status: 'review', code: 'forbidden' };
        if (result.reason === 'rate_limited')
            return { status: 'waiting', code: 'rate_limited' };
        return { status: 'review', code: 'protocol' };
    }
    return { status: 'waiting', code: 'unavailable' };
}
function writeFailure(result: UnipileHttpResult): Exclude<DeliveryOutcome, {
    status: 'submitted';
}> {
    if (result.kind === 'not_submitted')
        return { status: 'waiting', code: 'unavailable' };
    if (result.kind !== 'rejected')
        return { status: 'unknown' };
    if (result.reason === 'authentication')
        return { status: 'review', code: 'reconnect' };
    if (result.reason === 'authorization')
        return { status: 'review', code: 'forbidden' };
    if (result.reason === 'rate_limited')
        return { status: 'waiting', code: 'rate_limited' };
    if (result.reason === 'not_found')
        return { status: 'review', code: 'protocol' };
    return ['invalid_request', 'provider_rejection'].includes(result.reason) ? { status: 'rejected', code: result.reason } : { status: 'unknown' };
}
interface Budget {
    signal: AbortSignal;
    check(): void;
    call<T>(fn: () => Promise<T>): Promise<T>;
    writing: boolean;
}
export type EmailAcknowledgementOutcome = Exclude<DeliveryOutcome, {
    status: 'submitted';
}> | {
    status: 'acknowledged';
    receipt: ActionReceipt;
};
export interface UnipileV1EmailAdapter extends MessagingAdapter {
    capabilities: Capabilities;
    /** This performs the same single send as submit. Choose one entry point, never call both.
     * An acknowledgement is not a message receipt and cannot complete the durable journal. */
    submitAcknowledged(input: Parameters<MessagingAdapter['submit']>[0]): Promise<EmailAcknowledgementOutcome>;
}
/** Raw v1 transport composition only. Durable admission/journal/quota authority is mandatory
 * outside this adapter. Provider idempotency is memory-only; this adapter never retries a POST. */
export function createUnipileV1EmailAdapter(options: UnipileV1EmailAdapterOptions): UnipileV1EmailAdapter {
    let connection: ConnectionRecord, providerAccountId: string, sourceId: string, ownerAddresses: string[], timeoutMs: number;
    let getAccount: UnipileV1EmailPort['getAccount'], getEmail: UnipileV1EmailPort['getEmail'], sendEmail: UnipileV1EmailPort['sendEmail'];
    let verifyOwner: UnipileV1EmailAdapterOptions['verifyOwner'], verifyOriginal: UnipileV1EmailAdapterOptions['verifyOriginal'];
    try {
        observed(options);
        if (!options || types.isProxy(options) || ![Object.prototype, null].includes(Object.getPrototypeOf(options)))
            throw new Error();
        const fields = Object.getOwnPropertyDescriptors(options);
        if (Reflect.ownKeys(fields).some(k => typeof k !== 'string' || !['connection', 'providerAccountId', 'sourceId', 'ownerAddresses', 'transport', 'timeoutMs', 'verifyOwner', 'verifyOriginal'].includes(k) || !('value' in fields[k])))
            throw new Error();
        connection = copied(options.connection);
        providerAccountId = options.providerAccountId;
        sourceId = options.sourceId;
        ownerAddresses = copied(options.ownerAddresses) as string[];
        timeoutMs = options.timeoutMs ?? 15000;
        assertSameBinding(connection.binding, connection.binding);
        if (connection.binding.channel !== 'email' || connection.binding.backend !== 'unipile' || !['gmail', 'outlook', 'imap'].includes(connection.binding.platform) || !id(providerAccountId) || !id(sourceId) || (connection.providerAccountId !== undefined && connection.providerAccountId !== providerAccountId) || !ownerAddresses.length || ownerAddresses.length > 100 || ownerAddresses.some(a => !email(a)) || new Set(ownerAddresses).size !== ownerAddresses.length || !Number.isSafeInteger(timeoutMs) || timeoutMs <= 0 || timeoutMs > 60000)
            throw new Error();
        observed(options.transport);
        if (!options.transport || types.isProxy(options.transport))
            throw new Error();
        const ga = options.transport.getAccount, ge = options.transport.getEmail, se = options.transport.sendEmail, vo = options.verifyOwner, vr = options.verifyOriginal;
        for (const method of [ga, ge, se, vo, vr])
            observed(method);
        if ([ga, ge, se, vo, vr].some(f => typeof f !== 'function'))
            throw new Error();
        getAccount = Function.prototype.bind.call(ga, options.transport);
        getEmail = Function.prototype.bind.call(ge, options.transport);
        sendEmail = Function.prototype.bind.call(se, options.transport);
        verifyOwner = Function.prototype.bind.call(vo, options);
        verifyOriginal = Function.prototype.bind.call(vr, options);
    }
    catch {
        throw new ContractError('invalid_binding');
    }
    const binding = connection.binding;
    const capabilities: Capabilities = { messaging: { send: connection.capabilities.messaging.send, durableIdempotency: false, receiptLookup: connection.capabilities.messaging.receiptLookup }, events: { read: false, history: false, realtime: false }, email: { drafts: false, threading: true, rfcMessageId: false } };
    async function bounded<T>(work: (budget: Budget) => Promise<T>, failure: (writing: boolean) => T): Promise<T> {
        const controller = new AbortController(), start = performance.now();
        let timer: ReturnType<typeof setTimeout>;
        let rejectDeadline!: (error: Error) => void;
        const deadline = new Promise<never>((_, reject) => { rejectDeadline = reject; timer = setTimeout(() => { controller.abort(); reject(Error('Email deadline')); }, timeoutMs); });
        const budget: Budget = { signal: controller.signal, writing: false, check() {
                if (controller.signal.aborted || performance.now() - start >= timeoutMs) {
                    controller.abort();
                    throw Error('Email deadline');
                }
            }, call<TValue>(fn: () => Promise<TValue>): Promise<TValue> {
                this.check();
                let value: Promise<TValue>;
                try {
                    value = Promise.resolve(fn());
                }
                catch {
                    throw Error('Email unavailable');
                }
                observed(value);
                try {
                    this.check();
                }
                catch (e) {
                    rejectDeadline(Error('Email deadline'));
                    throw e;
                }
                return Promise.race([value, deadline]).then(result => { this.check(); return result; });
            } };
        try {
            const operation = Promise.resolve().then(() => work(budget));
            observed(operation);
            const result = await Promise.race([operation, deadline]);
            budget.check();
            return result;
        }
        catch {
            return failure(budget.writing);
        }
        finally {
            clearTimeout(timer!);
            controller.abort();
        }
    }
    function snapshotValid(snapshot: OperationSnapshot): void {
        assertSameBinding(binding, snapshot.binding);
        if (!exact(snapshot, ['key', 'binding', 'operation', 'payloadDigest']) || !id(snapshot.key) || snapshot.key.length > 200 || snapshot.operation !== 'message' || !/^[a-f0-9]{64}$/.test(snapshot.payloadDigest))
            throw new ContractError('operation_conflict');
    }
    function referenceValid(reference: ProviderReference): void {
        if (!exact(reference, ['id', 'binding']) || !id(reference.id))
            throw new ContractError('operation_conflict');
        assertSameBinding(binding, reference.binding);
    }
    async function owner(budget: Budget, requireReady: boolean): Promise<Readiness> {
        if (requireReady) {
            if (!connection.capabilities.messaging.send)
                return { status: 'review', code: 'delivery_disabled' };
            if (['connecting', 'syncing'].includes(connection.status))
                return { status: 'waiting', code: 'incomplete' };
            if (connection.status !== 'connected')
                return { status: 'review', code: 'reconnect' };
        }
        const result = copied(await budget.call(() => getAccount(providerAccountId, { signal: budget.signal })));
        if (!record(result))
            return { status: 'waiting', code: 'unavailable' };
        if (result.kind !== 'success')
            return readFailure(result);
        if (result.status !== 200 || !record(result.data))
            return { status: 'review', code: 'protocol' };
        const health = normalizeV1AccountReadiness(result.data, { binding, providerAccountId, sourceId });
        if (requireReady && health.status !== 'ready')
            return health;
        const expectedType = { gmail: 'GOOGLE_OAUTH', outlook: 'OUTLOOK', imap: 'MAIL' }[binding.platform as 'gmail' | 'outlook' | 'imap'];
        if (result.data.object !== 'Account' || result.data.id !== providerAccountId || result.data.type !== expectedType || !record(result.data.connection_params) || !record(result.data.connection_params.mail))
            return { status: 'review', code: 'account_changed' };
        return await budget.call(() => verifyOwner({ binding: copied(binding), providerAccountId, sourceId, account: copied(result.data), ownerAddresses: [...ownerAddresses], signal: budget.signal })) === true ? { status: 'ready' } : { status: 'review', code: 'account_changed' };
    }
    function proofValid(proof: VerifiedV1EmailOriginal | null, recipient: CanonicalIdentity, message?: ProviderReference, conversation?: ProviderReference, rfcId?: string): proof is VerifiedV1EmailOriginal {
        if (!proof || !exact(proof, ['providerAccountId', 'recipient', 'message', 'conversation', 'rfcMessageId']) || proof.providerAccountId !== providerAccountId || !recipientOK(proof.recipient) || proof.recipient.value !== recipient.value || !rfc(proof.rfcMessageId) || (rfcId !== undefined && proof.rfcMessageId !== rfcId))
            return false;
        try {
            referenceValid(proof.message);
            if (proof.conversation)
                referenceValid(proof.conversation);
        }
        catch {
            return false;
        }
        return (!message || message.id === proof.message.id) && (!conversation || conversation.id === proof.conversation?.id);
    }
    function mailValid(raw: unknown, proof: VerifiedV1EmailOriginal, sent: boolean): raw is Record<string, unknown> {
        if (!record(raw) || raw.object !== 'Email' || raw.kind !== '2_full' || raw.account_id !== providerAccountId || !id(raw.id) || (raw.id !== proof.message.id && raw.provider_id !== proof.message.id) || raw.message_id !== proof.rfcMessageId || raw.type !== { gmail: 'GOOGLE_OAUTH', outlook: 'OUTLOOK', imap: 'MAIL' }[binding.platform as 'gmail' | 'outlook' | 'imap'] || !timestamp(raw.date) || (proof.conversation && raw.thread_id !== proof.conversation.id) || !record(raw.from_attendee) || !Array.isArray(raw.to_attendees) || raw.to_attendees.length !== 1 || !record(raw.to_attendees[0]) || !email(raw.from_attendee.identifier) || !email(raw.to_attendees[0].identifier) || !Array.isArray(raw.headers) || (raw.cc_attendees !== undefined && (!Array.isArray(raw.cc_attendees) || raw.cc_attendees.length)) || (raw.bcc_attendees !== undefined && (!Array.isArray(raw.bcc_attendees) || raw.bcc_attendees.length)))
            return false;
        const headers = raw.headers.filter(h => record(h) && typeof h.name === 'string' && h.name.toLowerCase() === 'message-id');
        if (headers.length !== 1 || !record(headers[0]) || headers[0].value !== proof.rfcMessageId)
            return false;
        const from = raw.from_attendee.identifier, to = raw.to_attendees[0].identifier;
        return (ownerAddresses.includes(from) && to === proof.recipient.value && (!sent || raw.role === 'sent')) || (!sent && from === proof.recipient.value && ownerAddresses.includes(to) && raw.role === 'inbox');
    }
    const adapter: UnipileV1EmailAdapter = { capabilities: copied(capabilities),
        async ready(requested) { assertSameBinding(binding, copied(requested)); return bounded<Readiness>(b => owner(b, true), () => ({ status: 'waiting', code: 'unavailable' })); },
        async submit(request) {
            const result = await submitAcknowledged(request);
            return result.status === 'acknowledged' ? { status: 'unknown' } : result;
        },
        async submitAcknowledged(request) {
            const input = copied(request);
            if (!exact(input, ['snapshot', 'message']) || !record(input.message))
                throw new ContractError('operation_conflict');
            snapshotValid(input.snapshot);
            if (!recipientOK(input.message.recipient) || typeof input.message.text !== 'string' || input.message.text.length > 1000000 || !exact(input.message, ['recipient', 'text', 'subject', 'conversation', 'rfcMessageId', 'replyTo','replyParent']) || messageDigest(input.snapshot.operation, input.message) !== input.snapshot.payloadDigest)
                throw new ContractError('operation_conflict');
            if (input.message.conversation)
                referenceValid(input.message.conversation);
            if(input.message.replyParent){
                if(!exact(input.message.replyParent,['message','contentDigest'])||typeof input.message.replyParent.contentDigest!=='string'||!/^[a-f0-9]{64}$/.test(input.message.replyParent.contentDigest)||input.message.conversation)throw new ContractError('operation_conflict');
                referenceValid(input.message.replyParent.message);
            }
            if (input.message.rfcMessageId !== undefined || (input.message.subject !== undefined && (typeof input.message.subject !== 'string' || input.message.subject.length > 8192 || /[\r\n\u0000]/.test(input.message.subject))) || (input.message.replyTo !== undefined && !email(input.message.replyTo)))
                return { status: 'review', code: 'unsupported' };
            return bounded<EmailAcknowledgementOutcome>(async (budget) => {
                const health = await owner(budget, true);
                if (health.status !== 'ready')
                    return health;
                let parent: string | undefined;
                if (input.message.conversation) {
                    const proof = copied(await budget.call(() => verifyOriginal({ snapshot: copied(input.snapshot), recipient: copied(input.message.recipient), conversation: copied(input.message.conversation), signal: budget.signal })));
                    if (!proofValid(proof, input.message.recipient, undefined, input.message.conversation))
                        return { status: 'review', code: 'protocol' };
                    const result = copied(await budget.call(() => getEmail(providerAccountId, proof.message.id, { signal: budget.signal })));
                    if (result.kind !== 'success')
                        return readFailure(result);
                    if (result.status !== 200 || !mailValid(result.data, proof, false) || typeof result.data.subject !== 'string' || typeof input.message.subject !== 'string' || input.message.subject.replace(/^re:\s*/i, '') !== result.data.subject.replace(/^re:\s*/i, ''))
                        return { status: 'review', code: 'protocol' };
                    parent = proof.message.id;
                }
                if(input.message.replyParent){
                    const expected=input.message.replyParent,result=copied(await budget.call(()=>getEmail(providerAccountId,expected.message.id,{signal:budget.signal})));
                    if(result.kind!=='success')return readFailure(result);
                    const mail=result.data;
                    if(result.status!==200||!record(mail)||mail.object!=='Email'||mail.kind!=='2_full'||typeof mail.role!=='string'||['draft','drafts'].includes(mail.role.toLowerCase())||mail.id!==expected.message.id||mail.account_id!==providerAccountId||mail.type!=={gmail:'GOOGLE_OAUTH',outlook:'OUTLOOK',imap:'MAIL'}[binding.platform as 'gmail'|'outlook'|'imap']||!timestamp(mail.date)||Date.parse(mail.date)>Date.now()||typeof mail.body!=='string'||typeof mail.subject!=='string'||!Array.isArray(mail.headers)||!mail.headers.length||!record(mail.from_attendee)||mail.from_attendee.identifier_type!=='EMAIL_ADDRESS'||!email(mail.from_attendee.identifier)||!Array.isArray(mail.to_attendees)||!Array.isArray(mail.cc_attendees)||!Array.isArray(mail.bcc_attendees))return {status:'review',code:'protocol'};
                    const from=(mail.from_attendee.identifier as string).toLowerCase(),recipients=[...mail.to_attendees,...mail.cc_attendees,...mail.bcc_attendees];
                    if(!recipients.length||recipients.length>1000||!recipients.every(p=>record(p)&&p.identifier_type==='EMAIL_ADDRESS'&&email(p.identifier)))return {status:'review',code:'protocol'};
                    const addresses=recipients.map(p=>(p.identifier as string).toLowerCase()),peer=input.message.recipient.value;
                    const inbound=from===peer&&addresses.some(a=>ownerAddresses.includes(a)),outbound=ownerAddresses.includes(from)&&addresses.includes(peer);
                    if((!inbound&&!outbound)||addresses.some(a=>a!==peer&&!ownerAddresses.includes(a))||createHash('sha256').update(mail.subject+'\n'+mail.body).digest('hex')!==expected.contentDigest||typeof input.message.subject!=='string'||input.message.subject.replace(/^re:\s*/i,'')!==mail.subject.replace(/^re:\s*/i,''))return {status:'review',code:'protocol'};
                    // Revalidate physical owner after the parent read, before the
                    // held service coordinator permits its one provider write.
                    const current=await owner(budget,true);if(current.status!=='ready')return current;
                    parent=expected.message.id;
                }
                const payload: UnipileV1EmailPayload = { to: [{ identifier: input.message.recipient.value }], body: input.message.text, custom_headers: [{ name: 'Content-Type', value: 'text/plain; charset=utf-8' }], ...(input.message.subject !== undefined ? { subject: input.message.subject } : {}), ...(parent ? { reply_to: parent } : {}) };
                if (input.message.replyTo)
                    payload.custom_headers!.push({ name: 'Reply-To', value: input.message.replyTo });
                budget.check();
                budget.writing = true;
                const result = copied(await budget.call(() => sendEmail(providerAccountId, payload, input.snapshot.key, { signal: budget.signal })));
                if (!record(result))
                    return { status: 'unknown' };
                if (result.kind !== 'success')
                    return writeFailure(result);
                // The documented tracking ID is an action, even when optional provider IDs exist.
                if (result.status !== 201 || !record(result.data) || result.data.object !== 'EmailSent' || !id(result.data.tracking_id))
                    return { status: 'unknown' };
                return { status: 'acknowledged', receipt: { operation: { binding: copied(binding), id: result.data.tracking_id }, recipient: copied(input.message.recipient) } };
            }, writing => writing ? { status: 'unknown' } : { status: 'waiting', code: 'unavailable' });
        },
        async lookup(request) {
            const input = copied(request);
            if (!exact(input, ['snapshot', 'message', 'expectedRecipient', 'rfcMessageId']))
                throw new ContractError('operation_conflict');
            snapshotValid(input.snapshot);
            if (input.message)
                referenceValid(input.message);
            if (input.expectedRecipient && !recipientOK(input.expectedRecipient))
                throw new ContractError('operation_conflict');
            if (input.rfcMessageId !== undefined && !rfc(input.rfcMessageId))
                throw new ContractError('operation_conflict');
            if (!connection.capabilities.messaging.receiptLookup || !input.message || !input.expectedRecipient)
                return { status: 'review', code: 'unsupported' };
            return bounded<DeliveryOutcome | null>(async (budget) => {
                const health = await owner(budget, false);
                if (health.status !== 'ready')
                    return health;
                const proof = copied(await budget.call(() => verifyOriginal({ snapshot: copied(input.snapshot), recipient: copied(input.expectedRecipient!), message: copied(input.message!), ...(input.rfcMessageId !== undefined ? { rfcMessageId: input.rfcMessageId } : {}), signal: budget.signal })));
                if (!proofValid(proof, input.expectedRecipient!, input.message, undefined, input.rfcMessageId))
                    return { status: 'review', code: 'protocol' };
                const result = copied(await budget.call(() => getEmail(providerAccountId, proof.message.id, { signal: budget.signal })));
                if (result.kind === 'rejected' && result.reason === 'not_found')
                    return null;
                if (result.kind !== 'success')
                    return readFailure(result);
                if (result.status !== 200 || !mailValid(result.data, proof, true))
                    return { status: 'unknown' };
                return { status: 'submitted', receipt: { message: copied(input.message!), ...(proof.conversation ? { conversation: copied(proof.conversation) } : {}), recipient: copied(proof.recipient), submittedAt: result.data.date as string } };
            }, () => ({ status: 'waiting', code: 'unavailable' }));
        }
    };
    const submitAcknowledged = adapter.submitAcknowledged;
    return adapter;
}
