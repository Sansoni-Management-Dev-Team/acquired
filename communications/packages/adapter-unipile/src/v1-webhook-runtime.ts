import { assertSameBinding, type ConnectionBinding } from '../../contracts/src';
import type { ReplyIngress, ClaimedWebhook, ReplyNormalization, WebhookCapturePort } from '../../core/src/reply-ingress';
import type { NormalizedWebhookPort } from '../../core/src/webhook-events';
import type { ProviderWebhookSpool } from '../../storage-postgres/src/provider-webhook-spool';
export interface ConfiguredV1WebhookRuntimeOptions {
    spool: ProviderWebhookSpool;
    authenticate(headers: readonly string[]): boolean;
    journal(binding: ConnectionBinding): Promise<NormalizedWebhookPort & WebhookCapturePort>;
    history(binding: ConnectionBinding): Promise<{
        repository: {
            recordInitialSync(record: ClaimedWebhook, signal?: AbortSignal): Promise<{
                status: 'recorded' | 'duplicate';
            }>;
        };
        normalizeWebhook(raw: unknown, binding: ConnectionBinding): Promise<ReplyNormalization>;
    }>;
    associateSent(record: ClaimedWebhook): Promise<{
        kind: 'associated' | 'duplicate' | 'missing' | 'review';
    }>;
}
export interface ConfiguredV1WebhookRuntime {
    ingress: ReplyIngress;
    runOne(): Promise<{
        status: 'idle' | 'waiting' | 'processed' | 'retry';
    }>;
    process(binding: ConnectionBinding, key: string): Promise<{
        status: 'processed' | 'duplicate' | 'busy' | 'retry' | 'forbidden';
    }>;
    blocked(binding: ConnectionBinding): Promise<boolean>;
}
import { createHash } from 'node:crypto';
import { types } from 'node:util';
import { createWebhookEventProcessor } from '../../core/src/webhook-events';
import { plain, portMethod } from './v1-read-guard';
function fail(): never { throw Error('Configured webhook runtime unavailable'); }
const hash = (v: unknown) => createHash('sha256').update(JSON.stringify(v)).digest('hex');
function binding(v: ConnectionBinding) { if (!plain(v) || Object.keys(v).sort().join(',') !== 'accountId,applicationId,backend,channel,connectionId,generation,ownerId,platform,tenantId')
    fail(); const b = structuredClone(v); assertSameBinding(b, b); if (b.backend !== 'unipile')
    fail(); return b; }
function observed(value: unknown) { if (types.isPromise(value)) {
    void Promise.prototype.then.call(value, undefined, () => { });
    fail();
} }
/** Durable integration receipt precedes ACK. Routing preserves original bytes/time and pins exactly
 * recorded generation; original encrypted receipt proof precedes sent-event association. No app
 * policy, provider registration, memory fallback or implicit scope/grant creation is supplied. */
export function createConfiguredUnipileV1WebhookRuntime(options: ConfiguredV1WebhookRuntimeOptions): ConfiguredV1WebhookRuntime {
    if (!plain(options))
        fail();
    const authenticate = Function.prototype.bind.call(options.authenticate, options), journal = Function.prototype.bind.call(options.journal, options), history = Function.prototype.bind.call(options.history, options), associate = Function.prototype.bind.call(options.associateSent, options);
    if ([options.authenticate, options.journal, options.history, options.associateSent].some(fn => typeof fn !== 'function' || types.isProxy(fn)))
        fail();
    const capture = portMethod<ProviderWebhookSpool['capture']>(options.spool, 'capture'), claimSpool = portMethod<ProviderWebhookSpool['claim']>(options.spool, 'claim'), pending = portMethod<ProviderWebhookSpool['pendingScoped']>(options.spool, 'pendingScoped'), complete = portMethod<ProviderWebhookSpool['complete']>(options.spool, 'complete'), defer = portMethod<ProviderWebhookSpool['defer']>(options.spool, 'defer'), blocked = portMethod<ProviderWebhookSpool['blocked']>(options.spool, 'blocked');
    const runtime: ConfiguredV1WebhookRuntime = { blocked,
        ingress: { authenticate(headers) { try {
                return authenticate([...headers]) === true;
            }
            catch {
                return false;
            } }, async capture(input) { if (!runtime.ingress.authenticate(input.rawHeaders))
                return { status: 'rejected', code: 'unauthorized' }; try {
                const r = await capture({ rawHeaders: [...input.rawHeaders], rawBody: Buffer.from(input.rawBody) });
                if (!plain(r))
                    return { status: 'retry' };
                for (const value of Object.values(r))
                    observed(value);
                if (r.status === 'accepted' || r.status === 'duplicate' || r.status === 'retry')
                    return { status: r.status };
                if (r.status === 'rejected' && ['unauthorized', 'invalid_request', 'too_large'].includes(r.code))
                    return r;
                return { status: 'retry' };
            }
            catch {
                return { status: 'retry' };
            } } },
        async process(requested, key) {
            const b = binding(requested);
            if (typeof key !== 'string' || !/^[a-f0-9]{64}$/.test(key))
                return { status: 'retry' };
            try {
                const port = await journal(b), claim = portMethod<NormalizedWebhookPort['claim']>(port, 'claim'), finish = portMethod<NormalizedWebhookPort['finish']>(port, 'finish'), leased = await claim({ binding: b, key });
                if (!plain(leased))
                    fail();
                if (leased.kind === 'completed')
                    return { status: 'duplicate' };
                if (leased.kind === 'busy' || leased.kind === 'forbidden')
                    return { status: leased.kind };
                if (leased.kind !== 'claimed' || !plain(leased.record))
                    fail();
                for (const value of Object.values(leased.record))
                    observed(value);
                const record = leased.record as unknown as ClaimedWebhook;
                assertSameBinding(b, binding(record.binding));
                if (record.key !== key || typeof record.token !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(record.token) || !types.isUint8Array(record.rawBody) || types.isProxy(record.rawBody) || record.rawBody.byteLength > 262144 || typeof record.receivedAt !== 'string' || !Number.isFinite(Date.parse(record.receivedAt)))
                    fail();
                const original = { ...record, rawBody: Buffer.from(record.rawBody) }, raw = JSON.parse(new TextDecoder('utf8', { fatal: true }).decode(original.rawBody));
                if (b.channel !== 'email' && plain(raw) && plain(raw.AccountStatus) && raw.AccountStatus.message === 'SYNC_SUCCESS') {
                    const source = await history(b), sync = portMethod<typeof source.repository.recordInitialSync>(source.repository, 'recordInitialSync'), result = await sync(original);
                    if (!plain(result) || !['recorded', 'duplicate'].includes(result.status as string))
                        fail();
                    return { status: 'processed' };
                }
                if (b.channel === 'email' && plain(raw) && plain(raw.AccountStatus) && raw.AccountStatus.message === 'SYNC_SUCCESS') {
                    const completed = await finish({ record: original, outcome: { kind: 'ignore', reason: 'email_sync_observed' } });
                    assertSameBinding(b, completed.binding);
                    return { status: completed.key === key && completed.committed ? 'processed' : 'retry' };
                }
                if (b.channel === 'email' && plain(raw) && raw.event === 'mail_sent') {
                    const result = await associate(original);
                    if (!plain(result) || !['associated', 'duplicate', 'missing', 'review'].includes(result.kind as string))
                        fail();
                    if (result.kind === 'missing')
                        return { status: 'retry' };
                    const completed = await finish({ record: original, outcome: result.kind === 'review' ? { kind: 'review', code: 'protocol' } : { kind: 'ignore', reason: 'verified_email_sent' } });
                    assertSameBinding(b, completed.binding);
                    return { status: completed.key === key && completed.committed === true ? 'processed' : 'retry' };
                }
                const source = await history(b), normalize = portMethod<typeof source.normalizeWebhook>(source, 'normalizeWebhook');
                const processor = createWebhookEventProcessor({ binding: b, journal: { claim: async () => ({ kind: 'claimed', record: original }), finish: input => finish(input) }, normalize: (raw, requested) => normalize(raw, requested) });
                return processor.process(key);
            }
            catch {
                return { status: 'retry' };
            }
        },
        async runOne() {
            let original: Awaited<ReturnType<ProviderWebhookSpool['claim']>>;
            try {
                original = await claimSpool();
                if (!original) {
                    const records = await pending();
                    if (!records.length)
                        return { status: 'idle' };
                    const result = await runtime.process(records[0].binding, records[0].key);
                    return { status: result.status === 'processed' || result.status === 'duplicate' ? 'processed' : 'retry' };
                }
                if (!original.binding) {
                    await defer(original);
                    return { status: 'waiting' };
                }
                const b = binding(original.binding), key = hash(['communications.webhook.receipt.v1', [b.applicationId, b.tenantId, b.ownerId, b.connectionId, b.accountId, b.generation, b.channel, b.platform, b.backend], createHash('sha256').update(original.rawBody).digest('hex')]), port = await journal(b), save = portMethod<WebhookCapturePort['capture']>(port, 'capture');
                const result = await save({ binding: b, key, rawBody: Buffer.from(original.rawBody), receivedAt: original.receivedAt });
                assertSameBinding(b, result.binding);
                if (result.key !== key || !['accepted', 'duplicate'].includes(result.status))
                    fail();
                await complete(original, key);
                const processed = await runtime.process(b, key);
                return { status: processed.status === 'processed' || processed.status === 'duplicate' ? 'processed' : 'retry' };
            }
            catch {
                if (original!) {
                    try {
                        await defer(original);
                    }
                    catch { /* Retain original pending/leased receipt; retry after DB lease expiry. */ }
                }
                return { status: 'retry' };
            }
        }
    };
    return runtime;
}
