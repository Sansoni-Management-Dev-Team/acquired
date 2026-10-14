import { assertSameBinding, type ConnectionBinding, type CanonicalIdentity, type LinkedinRelationshipAdapter, type MessageSubmission, type DeliveryOutcome, type ActionReceipt, type ProviderReference } from '../../contracts/src';
import { parseLifecycleRecord, type RecordedLifecycleConnection } from '../../core/src/connection-lifecycle';
import { projectV1Account } from './v1-account-lifecycle';
import type { UnipileHttpResult, UnipileRequestOptions } from './http-core';
import { plain, opaque, pinned, boundedRead, unavailable, portMethod, vendorDate } from './v1-read-guard';
export interface V1RelationshipTransport {
    getAccount(id: string, options?: UnipileRequestOptions): Promise<UnipileHttpResult>;
    getProfile(accountId: string, identifier: string, options?: UnipileRequestOptions): Promise<UnipileHttpResult>;
    listInvitations(accountId: string, cursor: string | null, options?: UnipileRequestOptions): Promise<UnipileHttpResult>;
}
export interface V1RelationshipOptions {
    record: RecordedLifecycleConnection;
    transport: V1RelationshipTransport;
    resolveCurrent(binding: ConnectionBinding, signal: AbortSignal): Promise<RecordedLifecycleConnection | null>; /** Required existing durable invitation coordinator. This adapter never directly POSTs an invitation. */
    submitInvitation(input: MessageSubmission, signal: AbortSignal): Promise<DeliveryOutcome>;
    now?: () => number;
    deadlineMs?: number;
    maxPages?: number;
}
function canonical(v: unknown): CanonicalIdentity {
    if (!plain(v) || v.kind !== 'linkedin_profile' || typeof v.value !== 'string')
        unavailable();
    const u = new URL(v.value);
    if (u.protocol !== 'https:' || !['linkedin.com', 'www.linkedin.com'].includes(u.hostname) || !/^\/in\/[^/]+\/?$/.test(u.pathname) || u.search || u.hash || u.username || u.password || u.port)
        unavailable();
    return { kind: 'linkedin_profile', value: v.value };
}
export interface V1LinkedinRelationships extends LinkedinRelationshipAdapter {
    lookupInvitation(input: {
        binding: ConnectionBinding;
        invitation: ProviderReference;
        recipient: CanonicalIdentity;
    }): Promise<ActionReceipt | null>;
}
export function createUnipileV1LinkedinRelationships(options: V1RelationshipOptions): V1LinkedinRelationships {
    if (!plain(options))
        unavailable();
    const record = parseLifecycleRecord(options.record);
    if (record.binding.channel !== 'linkedin')
        unavailable();
    const getAccount = portMethod<V1RelationshipTransport['getAccount']>(options.transport, 'getAccount'), getProfile = portMethod<V1RelationshipTransport['getProfile']>(options.transport, 'getProfile'), list = portMethod<V1RelationshipTransport['listInvitations']>(options.transport, 'listInvitations'), current = pinned(options.resolveCurrent, options), submit = pinned(options.submitInvitation, options), now = options.now ? pinned(options.now, options) : Date.now, deadline = options.deadlineMs ?? 15000, maxPages = options.maxPages ?? 50;
    if (!Number.isInteger(deadline) || deadline < 1 || deadline > 60000 || !Number.isInteger(maxPages) || maxPages < 1 || maxPages > 1000)
        unavailable();
    async function withProfile<T>(binding: ConnectionBinding, requested: CanonicalIdentity, work: (profile: Record<string, unknown>, signal: AbortSignal, check: () => void) => Promise<T>): Promise<T> {
        assertSameBinding(record.binding, binding);
        const identity = canonical(requested);
        return boundedRead(deadline, undefined, async (signal, check) => {
            const authority = async () => {
                check();
                const value = await current(structuredClone(record.binding), signal);
                check();
                if (!value)
                    unavailable();
                const found = parseLifecycleRecord(value);
                assertSameBinding(record.binding, found.binding);
                if (found.providerAccountId !== record.providerAccountId || found.sourceId !== record.sourceId || found.ownerIdentity.namespace !== record.ownerIdentity.namespace || found.ownerIdentity.value !== record.ownerIdentity.value)
                    unavailable();
            };
            await authority();
            const result = await getAccount(record.providerAccountId, { signal });
            check();
            if (result.kind !== 'success' || result.status !== 200)
                unavailable();
            const observation = projectV1Account(result.data, record);
            if (observation.status !== 'observed' || observation.observation.status !== 'connected')
                unavailable();
            const response = structuredClone(await getProfile(record.providerAccountId, new URL(identity.value).pathname.split('/')[2], { signal }));
            check();
            if (response.kind !== 'success' || response.status !== 200 || !plain(response.data))
                unavailable();
            const p = response.data;
            if (p.object !== 'UserProfile' || p.provider !== 'LINKEDIN' || !opaque(p.provider_id) || p.public_identifier !== new URL(identity.value).pathname.split('/')[2] || p.public_profile_url !== undefined && (typeof p.public_profile_url !== 'string' || new URL(p.public_profile_url).protocol !== 'https:' || !['linkedin.com', 'www.linkedin.com'].includes(new URL(p.public_profile_url).hostname) || new URL(p.public_profile_url).pathname.replace(/\/$/, '') !== new URL(identity.value).pathname.replace(/\/$/, '') || new URL(p.public_profile_url).search || new URL(p.public_profile_url).hash || new URL(p.public_profile_url).username || new URL(p.public_profile_url).password) || p.is_self !== false)
                unavailable();
            await authority();
            const answer = await work(p, signal, check);
            check();
            await authority();
            return answer;
        });
    }
    async function invitations(signal: AbortSignal, check: () => void): Promise<Record<string, unknown>[]> {
        let cursor: string | null = null;
        const cursors = new Set<string>(), items: Record<string, unknown>[] = [];
        for (let page = 0;; page++) {
            if (page >= maxPages)
                unavailable();
            check();
            const result: UnipileHttpResult = structuredClone(await list(record.providerAccountId, cursor, { signal }));
            check();
            if (result.kind !== 'success' || result.status !== 200 || !plain(result.data))
                unavailable();
            const data: Record<string, unknown> = result.data;
            if (data.object !== 'InvitationList' || !Array.isArray(data.items) || data.items.length > 250 || !(data.cursor === null || opaque(data.cursor, 16384)))
                unavailable();
            for (const item of data.items) {
                if (!plain(item) || item.object !== 'InvitationSent' || !opaque(item.id) || !(item.invited_user_id === null || opaque(item.invited_user_id)) || !(item.invited_user_public_id === null || opaque(item.invited_user_public_id)))
                    unavailable();
                items.push(item);
            }
            if (data.cursor === null)
                break;
            if (cursors.has(data.cursor))
                unavailable();
            cursors.add(data.cursor);
            cursor = data.cursor;
        }
        return items;
    }
    return {
        async lookupInvitation(input) {
            if (!plain(input) || !plain(input.invitation) || !opaque(input.invitation.id))
                unavailable();
            const identity = canonical(input.recipient), reference = structuredClone(input.invitation), b = structuredClone(input.binding);
            assertSameBinding(record.binding, reference.binding);
            return withProfile(b, identity, async (p, signal, check) => {
                let found: ActionReceipt | null = null;
                for (const item of await invitations(signal, check)) {
                    if (item.id !== reference.id)
                        continue;
                    if (item.invited_user_id !== p.provider_id && item.invited_user_public_id !== p.public_identifier)
                        unavailable();
                    if (item.invited_user_id !== null && item.invited_user_id !== p.provider_id || item.invited_user_public_id !== null && item.invited_user_public_id !== p.public_identifier)
                        unavailable();
                    if (item.inviter !== undefined && item.inviter !== null && (!plain(item.inviter) || item.inviter.inviter_id !== record.ownerIdentity.value))
                        unavailable();
                    if (item.parsed_datetime === null || item.parsed_datetime === undefined)
                        continue;
                    if (!vendorDate(item.parsed_datetime) || Date.parse(item.parsed_datetime) > now())
                        unavailable();
                    const receipt: ActionReceipt = { operation: { binding: structuredClone(record.binding), id: reference.id }, recipient: structuredClone(identity), submittedAt: new Date(item.parsed_datetime).toISOString() };
                    if (found && found.submittedAt !== receipt.submittedAt)
                        unavailable();
                    found = receipt;
                }
                return found;
            });
        },
        async resolve(input) {
            if (!plain(input))
                unavailable();
            const identity = canonical(input.profile), b = structuredClone(input.binding);
            return withProfile(b, identity, async (p) => ({ identity, aliases: [{ binding: structuredClone(record.binding), identity: structuredClone(identity), namespace: 'unipile.v1.linkedin.profile.provider_id', value: p.provider_id as string, verifiedAt: new Date(now()).toISOString() }] }));
        },
        async inspect(input) {
            if (!plain(input) || typeof input.refresh !== 'boolean')
                unavailable();
            const b = structuredClone(input.binding), identity = canonical(input.profile);
            assertSameBinding(record.binding, b);
            if (!input.refresh)
                return { status: 'unknown', canMessage: null, observedAt: new Date(now()).toISOString() };
            return withProfile(b, identity, async (p, signal, check) => {
                const observedAt = () => new Date(now()).toISOString();
                if (p.is_relationship === true && p.network_distance === 'FIRST')
                    return { status: 'connected' as const, canMessage: true, observedAt: observedAt() };
                if (p.is_relationship !== false || p.network_distance === 'FIRST')
                    return { status: 'unknown' as const, canMessage: null, observedAt: observedAt() };
                if (p.invitation !== undefined) {
                    if (!plain(p.invitation) || !['SENT', 'RECEIVED'].includes(p.invitation.type as string) || !['PENDING', 'IGNORED', 'WITHDRAWN'].includes(p.invitation.status as string))
                        unavailable();
                    if (p.invitation.type === 'SENT' && p.invitation.status === 'PENDING')
                        return { status: 'invitation_pending' as const, canMessage: false, observedAt: observedAt() };
                }
                let pending = false;
                for (const item of await invitations(signal, check)) {
                    if (item.invited_user_id === p.provider_id || item.invited_user_public_id === p.public_identifier) {
                        if (item.invited_user_id !== null && item.invited_user_id !== p.provider_id || item.invited_user_public_id !== null && item.invited_user_public_id !== p.public_identifier)
                            unavailable();
                        pending = true;
                    }
                }
                return { status: pending ? 'invitation_pending' as const : 'not_connected' as const, canMessage: pending ? false : null, observedAt: observedAt() };
            });
        },
        async invite(input) {
            if (!plain(input) || !plain(input.snapshot) || !plain(input.message))
                unavailable();
            const original = structuredClone(input);
            assertSameBinding(record.binding, original.snapshot.binding);
            if (original.snapshot.operation !== 'invitation' || !opaque(original.snapshot.key, 200) || !/^[a-f0-9]{64}$/.test(original.snapshot.payloadDigest) || typeof original.message.text !== 'string' || original.message.text.length > 300)
                unavailable();
            const identity = canonical(original.message.recipient);
            return withProfile(original.snapshot.binding, identity, async (_p, signal, check) => { check(); const result = await submit(structuredClone(original), signal); check(); return result; });
        }
    };
}
