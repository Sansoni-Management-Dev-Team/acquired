import 'server-only';
import { types } from 'node:util';
import { assertSameBinding, type ConnectionBinding } from '../../communications/packages/contracts/src';
import { replyIdentity } from '@/domain/campaign-replies';
import {communicationReplyIdentity} from '../domain/communication-reply-identity';
import type { CommunicationReplyConsumerOptions } from './communications-reply-consumer';
const fields = ['applicationId', 'tenantId', 'ownerId', 'connectionId', 'accountId', 'generation', 'channel', 'platform', 'backend'] as const;
function data(value: unknown, keys: readonly string[]): Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value) || types.isProxy(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value)))
        throw Error('Invalid recorded identity input');
    const d = Object.getOwnPropertyDescriptors(value);
    if (Reflect.ownKeys(d).length !== keys.length || keys.some(k => !Object.hasOwn(d, k)) || Reflect.ownKeys(d).some(k => typeof k !== 'string' || !keys.includes(k) || !('value' in d[k]) || !d[k].enumerable))
        throw Error('Invalid recorded identity input');
    return Object.fromEntries(keys.map(k => [k, d[k].value]));
}
const id = (v: unknown): v is string => typeof v === 'string' && v.length > 0 && v.length <= 255 && v === v.trim() && !/[\u0000-\u001f\u007f]/.test(v);
function bound(value: unknown): ConnectionBinding {
    const b = data(value, fields);
    if (fields.some(k => k !== 'generation' && !id(b[k])))
        throw Error('Invalid recorded identity binding');
    assertSameBinding(b as unknown as ConnectionBinding, b as unknown as ConnectionBinding);
    return b as unknown as ConnectionBinding;
}
function canonical(channel: ConnectionBinding['channel'], kind: unknown, value: unknown): value is string {
    if (typeof value !== 'string' || value.length > 2048)
        return false;
    if (channel === 'email')
        return kind === 'email' && replyIdentity('email', value) === value;
    if (channel === 'whatsapp')
        return kind === 'phone' && /^\+[1-9]\d{6,14}$/.test(value);
    if (kind !== 'linkedin_profile')
        return false;
    try {
        const u = new URL(value);
        return u.protocol === 'https:' && ['linkedin.com', 'www.linkedin.com'].includes(u.hostname) && /^\/in\/[^/]+\/?$/.test(u.pathname) && !u.username && !u.password && !u.port && !u.search && !u.hash;
    }
    catch {
        return false;
    }
}
/** Bridge only existing recorded evidence, under the consumer's current owner transaction.
 * It neither calls a provider nor registers/guesses aliases. Multiple contacts sharing an identical
 * identity are left to the existing person policy; conflicting identities require review. The
 * consumer is responsible for its membership lock and authenticated delivery before calling this. */
export function createRecordedReplyIdentityResolver(options: Pick<CommunicationReplyConsumerOptions, 'actor' | 'binding' | 'bindingId'>): CommunicationReplyConsumerOptions['resolveIdentity'] {
    let fixed: ConnectionBinding, actor: CommunicationReplyConsumerOptions['actor'];
    const bindingId = options.bindingId;
    try {
        fixed = bound(options.binding);
        const a = data(options.actor, ['organizationId', 'userId']);
        if (fixed.applicationId !== 'acquire' || !id(a.organizationId) || !id(a.userId) || a.organizationId !== fixed.tenantId || a.userId !== fixed.ownerId || typeof bindingId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(bindingId))
            throw Error('Invalid configuration');
        actor = { organizationId: a.organizationId, userId: a.userId };
    }
    catch {
        throw Error('Invalid recorded identity resolver configuration');
    }
    return async (client, input) => {
        let sender: {
            kind: unknown;
            value: string;
        };
        try {
            const v = data(input, ['actor', 'binding', 'sender']), a = data(v.actor, ['organizationId', 'userId']), b = bound(v.binding), s = data(v.sender, ['kind', 'value']);
            assertSameBinding(fixed, b);
            if (a.organizationId !== actor.organizationId || a.userId !== actor.userId || !canonical(fixed.channel, s.kind, s.value))
                return null;
            sender = { kind: s.kind, value: s.value };
        }
        catch {
            return null;
        }
        // Optional schema capability preserves installations without the native
        // module. Once a binding is registered in a scoped identity namespace,
        // missing route proof is a review, never a legacy/global alias fallback.
        const catalog=await client.query<{installed:boolean}>("SELECT to_regprocedure('public.agent_recorded_reply_execution_scope(uuid,text,text)') IS NOT NULL AS installed");
        if(catalog.rows.length===1&&catalog.rows[0].installed===true){
            const projected=await client.query<{context:{registered:boolean;scope:unknown}}>('SELECT public.agent_recorded_reply_execution_scope($1::uuid,$2::text,$3::text) AS context',[bindingId,sender.kind,sender.value]);
            const context=projected.rows.length===1?projected.rows[0].context:null;
            if(!context||typeof context.registered!=='boolean')return null;
            if(context.registered){
                let scope:{kind:'demo';id:string};
                try{const row=data(context.scope,['kind','id']);if(row.kind!=='demo'||typeof row.id!=='string'||!/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(row.id))return null;scope={kind:'demo',id:row.id};}catch{return null;}
                const identity=communicationReplyIdentity(fixed.channel,sender.value);if(!identity)return null;
                return{actor:{...actor},binding:{...fixed},sender:{kind:sender.kind,value:sender.value}as Parameters<CommunicationReplyConsumerOptions['resolveIdentity']>[1]['sender'],identity,...(fixed.channel==='linkedin'?{identityAuthority:'canonical_service' as const}:{}),identityScope:scope};
            }
        }
        // Binding history is immutable and the owner role has no UPDATE grant for it. Lock only
        // mutable identity evidence; locking b would demand a broader privilege without adding safety.
        const result = await client.query(`SELECT b.id AS binding_id,b.application_id,b.organization_id,b.owner_user_id,
 b.service_connection_id,b.service_account_id,b.generation,b.channel,b.platform,b.backend,b.authority,i.identity,i.source_identity
 FROM public.campaign_reply_identities i JOIN public.communication_bindings b
 ON i.organization_id=b.organization_id AND i.owner_user_id=b.owner_user_id AND i.channel=b.channel
 WHERE b.id=$1 AND b.application_id=$2 AND b.organization_id=$3 AND b.owner_user_id=$4
 AND b.service_connection_id=$5 AND b.service_account_id=$6 AND b.generation=$7 AND b.channel=$8 AND b.platform=$9 AND b.backend=$10 AND b.authority='service'
 AND i.source_identity=$11 LIMIT 501 FOR SHARE OF i`, [bindingId, fixed.applicationId, actor.organizationId, actor.userId, fixed.connectionId, fixed.accountId, fixed.generation, fixed.channel, fixed.platform, fixed.backend, sender.value]);
        if (result.rows.length === 0 || result.rows.length > 500)
            return null;
        const identities = new Set<string>();
        for (const row of result.rows) {
            if (row.binding_id !== bindingId || row.application_id !== fixed.applicationId || row.organization_id !== actor.organizationId || row.owner_user_id !== actor.userId || row.service_connection_id !== fixed.connectionId || row.service_account_id !== fixed.accountId || row.generation !== fixed.generation || row.channel !== fixed.channel || row.platform !== fixed.platform || row.backend !== fixed.backend || row.authority !== 'service' || row.source_identity !== sender.value || typeof row.identity !== 'string')
                return null;
            const mapped = communicationReplyIdentity(fixed.channel, row.identity);
            if (mapped?.startsWith('https:') && mapped!==sender.value) return null;
            if (mapped !== row.identity || fixed.channel !== 'linkedin' && mapped !== replyIdentity(fixed.channel, sender.value))
                return null;
            identities.add(mapped);
        }
        if (identities.size !== 1)
            return null;
        return { actor: { ...actor }, binding: { ...fixed }, sender: { kind: sender.kind, value: sender.value } as Parameters<CommunicationReplyConsumerOptions['resolveIdentity']>[1]['sender'], identity: [...identities][0],...([...identities][0].startsWith('https:')?{identityAuthority:'canonical_service' as const}:{}) };
    };
}
