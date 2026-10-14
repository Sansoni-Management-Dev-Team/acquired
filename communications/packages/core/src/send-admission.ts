import type { DispatchBlock, DispatchRecord, BeginDispatchDecision } from './dispatch';
import { assertOperationMatches, assertSameBinding } from '../../contracts/src';
import { types, isDeepStrictEqual } from 'node:util';
export interface AdmissionChallenge {
    record: DispatchRecord;
    claimToken: string;
    serviceRevision: string;
}
export interface ServiceAdmissionReceipt {
    permitId: string;
    intentDigest: string;
    journalId: string;
    admissionId: string;
    snapshot: DispatchRecord['snapshot'];
    fencingToken: string;
    serviceRevision: string;
}
/** A live application transaction, never a boolean obtained from a closed transaction. */
export interface HeldApplicationPermit {
    permitId: string;
    intentDigest: string;
    coverageScopes: readonly {
        binding: DispatchRecord['snapshot']['binding'];
        recipient: DispatchRecord['recipient'];
        scopeDigest: string;
        requiredSince: string;
    }[];
    commit(receipt: ServiceAdmissionReceipt, signal: AbortSignal): Promise<'committed'>;
    abort(): Promise<void>;
}
export interface HeldApplicationAdmission {
    open(challenge: AdmissionChallenge, signal: AbortSignal): Promise<{
        kind: 'blocked';
        outcome: DispatchBlock;
    } | {
        kind: 'held';
        permit: HeldApplicationPermit;
    }>;
}
export async function consumeHeldApplicationPermit(application: HeldApplicationAdmission, challenge: AdmissionChallenge, commitService: (permit: Pick<HeldApplicationPermit, 'permitId' | 'intentDigest' | 'coverageScopes'>) => Promise<{
    receipt: ServiceAdmissionReceipt;
    record: DispatchRecord;
}>, signal: AbortSignal): Promise<BeginDispatchDecision> {
    let abort: (() => Promise<void>) | undefined, stopped = false;
    const denied = (): BeginDispatchDecision => ({ kind: 'uncertain' });
    const cleanup = () => {
        const port = abort;
        abort = undefined;
        if (port) {
            try {
                void Promise.resolve(port()).catch(() => { });
            }
            catch { /* private */ }
        }
    };
    let onAbort: (() => void) | undefined;
    try {
        if (types.isProxy(signal) || Object.getOwnPropertyDescriptor(AbortSignal.prototype, 'aborted')!.get!.call(signal))
            return denied();
        const input = structuredClone(challenge), openPort = application.open;
        if (typeof openPort !== 'function' || typeof commitService !== 'function' || input.record.state !== 'claimed')
            return denied();
        const open = Function.prototype.bind.call(openPort, application);
        let resolveStopped!: (value: BeginDispatchDecision) => void;
        const stop = new Promise<BeginDispatchDecision>(resolve => { resolveStopped = resolve; });
        onAbort = () => { stopped = true; cleanup(); resolveStopped(denied()); };
        EventTarget.prototype.addEventListener.call(signal, 'abort', onAbort, { once: true });
        const run = async (): Promise<BeginDispatchDecision> => {
            const opened = await open(structuredClone(input), signal);
            if (opened?.kind === 'blocked') {
                const value = structuredClone(opened.outcome);
                if (!value || !['waiting', 'review', 'rejected'].includes(value.status) || typeof value.code !== 'string' || Object.keys(value).some(k => !['status', 'code', ...(value.status === 'waiting' ? ['retryAt'] : [])].includes(k)) || value.status === 'waiting' && !['incomplete', 'stale', 'busy', 'timeout', 'rate_limited', 'unavailable', 'identity_pending'].includes(value.code) || value.status === 'review' && !['reconnect', 'account_changed', 'protocol', 'unexpected', 'delivery_disabled', 'unresolved_send', 'unsupported', 'forbidden', 'operation_conflict'].includes(value.code) || value.status === 'rejected' && !/^[a-zA-Z0-9_:/.-]{1,100}$/.test(value.code) || ('retryAt' in value && (typeof value.retryAt !== 'string' || value.retryAt.length > 64 || !Number.isFinite(Date.parse(value.retryAt)) || new Date(value.retryAt).toISOString() !== value.retryAt)))
                    return denied();
                return { kind: 'blocked', outcome: value };
            }
            if (opened?.kind !== 'held')
                return denied();
            const permit = opened.permit, commitPort = permit.commit, abortPort = permit.abort;
            if (typeof commitPort !== 'function' || typeof abortPort !== 'function')
                return denied();
            abort = Function.prototype.bind.call(abortPort, permit);
            if (stopped) {
                cleanup();
                return denied();
            }
            if (typeof permit.permitId !== 'string' || !permit.permitId || permit.permitId.length > 200 || !/^[a-f0-9]{64}$/.test(permit.intentDigest))
                return denied();
            const proof = { permitId: permit.permitId, intentDigest: permit.intentDigest, coverageScopes: structuredClone(permit.coverageScopes) };
            for (const scope of proof.coverageScopes ?? []) {
                assertSameBinding(scope.binding, scope.binding);
                if (!scope.recipient || Object.keys(scope.recipient).some(k => !['kind', 'value'].includes(k)) || typeof scope.recipient.value !== 'string')
                    return denied();
                const value = scope.recipient.value;
                if (scope.binding.channel === 'email' ? scope.recipient.kind !== 'email' || value !== value.toLowerCase() || !/^[^\s<>@]+@[^\s<>@]+$/.test(value) : scope.binding.channel === 'whatsapp' ? scope.recipient.kind !== 'phone' || !/^\+[1-9]\d{6,14}$/.test(value) : scope.recipient.kind !== 'linkedin_profile' || !/^https:\/\/www\.linkedin\.com\/in\/[^/?#]+\/?$/.test(value))
                    return denied();
            }
            if (!Array.isArray(proof.coverageScopes) || proof.coverageScopes.length < 1 || proof.coverageScopes.length > 3 || proof.coverageScopes.some(scope => scope.binding.applicationId !== input.record.snapshot.binding.applicationId || scope.binding.tenantId !== input.record.snapshot.binding.tenantId || scope.binding.ownerId !== input.record.snapshot.binding.ownerId || !/^[a-f0-9]{64}$/.test(scope.scopeDigest) || !Number.isFinite(Date.parse(scope.requiredSince))))
                return denied();
            const committed = structuredClone(await commitService(structuredClone(proof)));
            if (stopped || signal.aborted || committed.record.state !== 'dispatching' || committed.receipt.permitId !== proof.permitId || committed.receipt.intentDigest !== proof.intentDigest || committed.receipt.serviceRevision !== input.serviceRevision)
                return denied();
            if (Object.keys(committed.receipt).some(k => !['permitId', 'intentDigest', 'journalId', 'admissionId', 'snapshot', 'fencingToken', 'serviceRevision'].includes(k)) || typeof committed.receipt.journalId !== 'string' || !committed.receipt.journalId || typeof committed.receipt.admissionId !== 'string' || !committed.receipt.admissionId || !/^[1-9]\d{0,18}$/.test(committed.receipt.fencingToken) || Object.keys(committed.record).some(k => !['snapshot', 'recipient', 'state', 'message', 'conversation', 'rfcMessageId'].includes(k)) || !isDeepStrictEqual(committed.record.recipient, input.record.recipient) || !isDeepStrictEqual(committed.record.conversation, input.record.conversation) || !isDeepStrictEqual(committed.record.message, input.record.message) || committed.record.rfcMessageId !== input.record.rfcMessageId)
                return denied();
            assertOperationMatches(input.record.snapshot, committed.receipt.snapshot);
            assertOperationMatches(input.record.snapshot, committed.record.snapshot);
            const appCommit = Function.prototype.bind.call(commitPort, permit);
            if (await appCommit(structuredClone(committed.receipt), signal) !== 'committed' || stopped || signal.aborted)
                return denied();
            return { kind: 'admitted', record: committed.record };
        };
        const work = Promise.resolve().then(run);
        void work.catch(() => { });
        return await Promise.race([work, stop]);
    }
    catch {
        return denied();
    }
    finally {
        if (onAbort)
            EventTarget.prototype.removeEventListener.call(signal, 'abort', onAbort);
        cleanup();
    }
}
