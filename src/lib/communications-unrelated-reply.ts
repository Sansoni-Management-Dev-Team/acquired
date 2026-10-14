import 'server-only';
import { types } from 'node:util';
import { assertSameBinding, type ConnectionBinding, type CanonicalIdentity } from '../../communications/packages/contracts/src';
import { outreachEmail } from '../domain/outreach-contact';
import { contactPhone, contactLinkedin } from '../domain/contact-record';
import type { CommunicationReplyConsumerOptions } from './communications-reply-consumer';
const fields = ['applicationId', 'tenantId', 'ownerId', 'connectionId', 'accountId', 'generation', 'channel', 'platform', 'backend'] as const;
function plain(v: unknown) { return !!v && typeof v === 'object' && !types.isProxy(v) && !Array.isArray(v) && [Object.prototype, null].includes(Object.getPrototypeOf(v)) && Reflect.ownKeys(Object.getOwnPropertyDescriptors(v)).every(k => typeof k === 'string' && 'value' in Object.getOwnPropertyDescriptor(v, k)!); }
function canonical(b: ConnectionBinding, s: CanonicalIdentity) { return plain(s) && Object.keys(s).sort().join(',') === 'kind,value' && typeof s.value === 'string' && (b.channel === 'email' ? s.kind === 'email' && outreachEmail(s.value) === s.value : b.channel === 'whatsapp' ? s.kind === 'phone' && contactPhone(s.value) === s.value : s.kind === 'linkedin_profile' && contactLinkedin(s.value) === s.value.replace(/\/$/, '')); }
/** Only called by the engine's role-bound clients inside the held app gate/member transaction.
 * Catalog attestation requires the reviewed complete-contact-read policy and all-owner alias-read
 * policy; unknown or restrictive RLS cannot prove absence. EXISTS scans are exhaustive for the
 * canonical contact model and registered aliases, never provider names or partial lists. */
export function createRecordedUnrelatedReplyResolver(options: Pick<CommunicationReplyConsumerOptions, 'actor' | 'binding' | 'bindingId'>): NonNullable<CommunicationReplyConsumerOptions['resolveUnrelated']> {
    let b: ConnectionBinding, actor: CommunicationReplyConsumerOptions['actor'], bindingId: string;
    try {
        if (!plain(options.binding) || !plain(options.actor) || Object.keys(options.actor).sort().join(',') !== 'organizationId,userId')
            throw Error();
        b = structuredClone(options.binding);
        actor = structuredClone(options.actor);
        bindingId = options.bindingId;
        assertSameBinding(b, b);
        if (b.applicationId !== 'acquire' || b.backend !== 'unipile' || b.tenantId !== actor.organizationId || b.ownerId !== actor.userId || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(bindingId))
            throw Error();
    }
    catch {
        throw Error('Invalid unrelated reply resolver configuration');
    }
    return async (clients, input) => {
        try {
            if (!plain(input) || Object.keys(input).sort().join(',') !== 'actor,binding,sender' || !plain(input.actor) || !plain(input.binding) || input.actor.organizationId !== actor.organizationId || input.actor.userId !== actor.userId || Object.keys(input.actor).sort().join(',') !== 'organizationId,userId' || !canonical(b, input.sender))
                return null;
            assertSameBinding(b, input.binding);
            const member = await clients.owner.query('SELECT public.communications_lock_send_member($1,$2) AS allowed', [actor.organizationId, actor.userId]);
            if (member.rows.length !== 1 || member.rows[0].allowed !== true)
                return null;
            const original = await clients.owner.query(`SELECT EXISTS(SELECT 1 FROM public.communication_bindings WHERE id=$1 AND application_id=$2 AND organization_id=$3 AND owner_user_id=$4 AND service_connection_id=$5 AND service_account_id=$6 AND generation=$7 AND channel=$8 AND platform=$9 AND backend=$10 AND authority='service') AS original_verified`, [bindingId, ...fields.map(k => b[k])]);
            // Explicit parameters below use the original nine-field binding; do not accept defaults.
            if (original.rows.length !== 1 || original.rows[0].original_verified !== true)
                return null;
            const visible = await clients.owner.query(`SELECT current_user AS role_name,has_table_privilege(current_user,'public.contacts','SELECT') AS readable,
 EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='contacts' AND policyname='communications_admission_source_read' AND permissive='PERMISSIVE' AND cmd='SELECT' AND 'acquire_campaign_user'=ANY(roles) AND regexp_replace(replace(qual,'public.',''),'[[:space:]()]','','g')=$1) AS complete_visibility,
 EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='contacts' AND permissive='RESTRICTIVE') AS restrictive`, ["organization_id=current_setting'app.acquire_org'::text,trueANDEXISTSSELECT1FROMmemberWHEREmember.organization_id=current_setting'app.acquire_org'::text,trueANDmember.user_id=current_setting'app.acquire_user'::text,true"]);
            if (visible.rows.length !== 1 || visible.rows[0].role_name !== 'acquire_campaign_user' || visible.rows[0].readable !== true || visible.rows[0].complete_visibility !== true || visible.rows[0].restrictive !== false)
                return null;
            const sender = structuredClone(input.sender), slug = b.channel === 'linkedin' ? new URL(sender.value).pathname.split('/')[2].toLowerCase() : '';
            const contact = await clients.owner.query(`SELECT EXISTS(SELECT 1 FROM public.contacts c WHERE c.organization_id=$1 AND CASE $2
 WHEN 'email' THEN lower(btrim(c.personal_data->>'email'))=$3
 WHEN 'whatsapp' THEN regexp_replace(btrim(c.personal_data->>'phone'),'[[:space:]().-]','','g')=$3 OR btrim(c.personal_data->>'phone')=$4
 ELSE EXISTS(SELECT 1 FROM unnest(ARRAY[c.personal_data->>'linkedinUrl',c.personal_data->>'linkedin',c.personal_data->>'linkedin_url']) AS profile(value) WHERE regexp_replace(substring(lower(btrim(profile.value)) FROM '^https://(?:[a-z0-9-]+\\.)*linkedin\\.com/in/[^/?#]+'),'^https://[^/]+','')='/in/'||$5) END) AS matched,
 EXISTS(SELECT 1 FROM public.contacts c WHERE c.organization_id=$1 AND (jsonb_typeof(c.personal_data) IS DISTINCT FROM 'object' OR (CASE $2 WHEN 'email' THEN jsonb_typeof(c.personal_data->'email') WHEN 'whatsapp' THEN jsonb_typeof(c.personal_data->'phone') ELSE NULL END) NOT IN('string','null') OR ($2='linkedin' AND EXISTS(SELECT 1 FROM unnest(ARRAY['linkedinUrl','linkedin','linkedin_url']) AS field(name) WHERE jsonb_typeof(c.personal_data->field.name) NOT IN('string','null') OR position('%' IN c.personal_data->>field.name)>0)) OR ($2='email' AND coalesce(c.personal_data->>'email','')<>'' AND c.personal_data->>'email' !~ '^[^[:space:]@]+@[^[:space:]@]+$') OR ($2='whatsapp' AND coalesce(c.personal_data->>'phone','')<>'' AND regexp_replace(btrim(c.personal_data->>'phone'),'[[:space:]().-]','','g') !~ '^\\+[1-9][0-9]{6,14}$' AND c.personal_data->>'phone' !~ '^[1-9][0-9]{6,14}@s\\.whatsapp\\.net$') OR ($2='linkedin' AND EXISTS(SELECT 1 FROM unnest(ARRAY[c.personal_data->>'linkedinUrl',c.personal_data->>'linkedin',c.personal_data->>'linkedin_url']) AS profile(value) WHERE coalesce(profile.value,'')<>'' AND (profile.value ~ '[[:space:]]' OR lower(profile.value) !~ '^https://(?:[a-z0-9-]+\\.)*linkedin\\.com/in/[^/?#]+/?(?:[?#].*)?$'))) OR c.personal_data ?| ARRAY['aliases','emailAliases','phoneAliases','linkedinAliases','emails','phones'])) AS ambiguous`, [b.tenantId, b.channel, sender.value, b.channel === 'whatsapp' ? `${sender.value.slice(1)}@s.whatsapp.net` : '', slug]);
            if (contact.rows.length !== 1 || contact.rows[0].matched !== false || contact.rows[0].ambiguous !== false)
                return null;
            const registry = await clients.registry.query(`SELECT current_user AS role_name,has_table_privilege(current_user,'public.campaign_reply_identities','SELECT') AS readable,
 EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='campaign_reply_identities' AND policyname='campaign_reply_identities_worker' AND permissive='PERMISSIVE' AND cmd='ALL' AND 'acquire_campaign_worker'=ANY(roles) AND qual='true') AS complete_visibility,
 EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='campaign_reply_identities' AND permissive='RESTRICTIVE') AS restrictive`);
            if (registry.rows.length !== 1 || registry.rows[0].role_name !== 'acquire_campaign_worker' || registry.rows[0].readable !== true || registry.rows[0].complete_visibility !== true || registry.rows[0].restrictive !== false)
                return null;
            const aliases = await clients.registry.query(`SELECT EXISTS(SELECT 1 FROM public.campaign_reply_identities i WHERE i.organization_id=$1 AND i.channel=$2 AND (i.identity=$3 OR i.source_identity=$3 OR i.identity=$4 OR i.source_identity=$4 OR ($2='linkedin' AND (lower(regexp_replace(substring(lower(btrim(i.source_identity)) FROM '^https://(?:[a-z0-9-]+\\.)*linkedin\\.com/in/[^/?#]+'),'^https://[^/]+',''))='/in/'||$5 OR lower(regexp_replace(substring(lower(btrim(i.identity)) FROM '^https://(?:[a-z0-9-]+\\.)*linkedin\\.com/in/[^/?#]+'),'^https://[^/]+',''))='/in/'||$5)))) AS matched,
 EXISTS(SELECT 1 FROM public.campaign_reply_identities i WHERE i.organization_id=$1 AND i.channel=$2 AND (i.identity IS NULL OR i.source_identity IS NULL OR ($2='linkedin' AND (position('%' IN i.identity)>0 OR position('%' IN i.source_identity)>0)))) AS ambiguous`, [b.tenantId, b.channel, sender.value, b.channel === 'whatsapp' ? `${sender.value.slice(1)}@s.whatsapp.net` : '', slug]);
            if (aliases.rows.length !== 1 || aliases.rows[0].matched !== false || aliases.rows[0].ambiguous !== false)
                return null;
            return { kind: 'unrelated', proofVersion: 'acquire.reply.unrelated.v1', actor: { ...actor }, binding: structuredClone(b), sender };
        }
        catch {
            return null;
        }
    };
}
