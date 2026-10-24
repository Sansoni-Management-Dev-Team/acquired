import {businessSql,type BusinessClock} from '../../communications/packages/core/src/business-clock';
import {mandateExecutionContextSchema,type MandateExecutionContext} from '../domain/mandate-execution-context';
import{assertNewEffectPermitted}from'./mandate-execution-policy';
import {agentTransactionRuntimeContext} from './agent-runtime-context';
import {reportAdmissionPreparationFailure,reportDispatchDiagnostic,type DispatchDiagnosticPort,type DispatchDiagnosticStage} from '../../communications/packages/core/src/dispatch-diagnostic';
import { createHash, randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { isDeepStrictEqual, types } from 'node:util';
import { messageDigest } from '../../communications/packages/core/src/message-digest';
import { assertOperationMatches, assertSameBinding } from '../../communications/packages/contracts/src';
import { campaignDefinition, campaignStepEntries, renderCampaignTemplate, campaignSendWindowOpen, nextAllowedCampaignSend } from '../domain/campaign';
import { campaignChannels, contactLinkedin, contactPhone } from '../domain/contact-record';
import { outreachEmail } from '../domain/outreach-contact';
import {readAgentCommunicationsSource,readAgentCommunicationsSourceKind,readAgentChannelCommunicationsSource,type AgentCommunicationsIntentSource} from './agent-communications-source';
import {agentDriverAllowed} from './agent-driver-admission';
import { lockAcquireSendGate } from './campaign-send-gate';
import type { SqlClient, SqlResult } from '../../communications/packages/storage-postgres/src/webhook-repository';
import type { ConnectionBinding, MessageSubmission } from '../../communications/packages/contracts/src';
import type { JournalCodec } from '../../communications/packages/core/src/journal-codec';
import type { HeldApplicationAdmission, ServiceAdmissionReceipt } from '../../communications/packages/core/src/send-admission';
import type { SqlPool } from '../../communications/packages/storage-postgres/src/webhook-repository';
export type CampaignIntentSource = {
    kind: 'campaign';
    attemptId: string;
    enrolmentId: string;
    versionId: string;
    stepId: string;
    stepIndex: number;
    runtime: 'legacy' | 'n8n';
};
export type DraftIntentSource = {
    kind: 'draft';
    messageId: string;
    revision: string;
};
export type AcquireIntentSource = CampaignIntentSource | DraftIntentSource | AgentCommunicationsIntentSource;
export interface AcquireCoverageScope {
    bindingId: string;
    scopeDigest: string;
}
export interface AcquireSendAdmissionOptions {
    businessClock?:BusinessClock;
    loadExecutionContext?(tx:Pick<SqlClient,'query'>,source:AcquireIntentSource):Promise<MandateExecutionContext>;
    diagnostic?:DispatchDiagnosticPort;
    pool: SqlPool;
    binding: ConnectionBinding;
    bindingId: string;
    codec: Pick<JournalCodec, 'keyVersion' | 'encode' | 'decode' | 'digest'>;
    verifyServiceAdmission(receipt: ServiceAdmissionReceipt, signal: AbortSignal): Promise<boolean>;
    proveNoSubmission?(snapshot: MessageSubmission['snapshot'], signal: AbortSignal): Promise<{
        snapshot: MessageSubmission['snapshot'];
        journalId: string;
        outcome: unknown;
        evidenceDigest: string;
        keyVersion: string;
    } | null>;
    timeoutMs?: number;
    coverageMaxAgeSeconds?: number;
}
export interface PreparedAcquireIntent {
    intentId: string;
    epoch: number;
    submission: MessageSubmission;
}
export interface AcquireNoSubmissionResolution {intentId:string;operationKey:string;proofDigest:string}
export interface AcquireSendAdmission extends HeldApplicationAdmission {
    /** Lookup-only proof: never prepares a new epoch or grants delivery. */
    resolveNoSubmission?(snapshot:MessageSubmission['snapshot']):Promise<AcquireNoSubmissionResolution|null>;
    /** Authenticated original metadata for bounded preload; grants no send permission. */
    getPreparedCoverage(snapshot: MessageSubmission['snapshot']): Promise<Array<{
        binding: ConnectionBinding;
        scopeDigest: string;
    }>>;
    getPreparedIntent(input: {
        sourceKind: 'campaign' | 'draft' | 'agent';
        sourceId: string;
    }): Promise<PreparedAcquireIntent | null>;
    prepare(input: {
        source: AcquireIntentSource;
        message: MessageSubmission['message'];
        coverageScopes: AcquireCoverageScope[];
    }): Promise<PreparedAcquireIntent>;
}
/** Diagnostic data is computed in the same read as the authoritative count.
 * Allowlist scalar metadata only; logging can never alter admission or retries. */
function logCoverageBlocked(raw: unknown, intentId: unknown, expectedScopes: number, requiredServiceRevision: string, maxAgeSeconds: number) {
    if (!(process.env.AGENT_VERBOSE_LOGGING === 'true' || process.env.AGENT_VERBOSE_LOGGING !== 'false' && process.env.NODE_ENV === 'development')) return;
    try {
        const own = (value: unknown, key: string): unknown => {
            if (!value || typeof value !== 'object' || types.isProxy(value)) return undefined;
            const descriptor = Object.getOwnPropertyDescriptor(value, key);
            return descriptor && 'value' in descriptor ? descriptor.value : undefined;
        };
        const data = own(raw, 'coverage_diagnostics'), predicates: Record<string, boolean | number | string | null> = {};
        for (const key of ['allComplete', 'allInitialSync', 'anyInvalidated', 'allCoverRequiredSince', 'allCoverageFresh', 'allObservedFresh', 'allTimestampsOrdered', 'allRevisionsCurrent']) {
            const value = own(data, key); predicates[key] = typeof value === 'boolean' ? value : null;
        }
        for (const key of ['scopeRows', 'monitorRows', 'checkpointRows', 'oldestCoverageAgeSeconds', 'oldestObservedAgeSeconds']) {
            const value = own(data, key); predicates[key] = typeof value === 'number' && Number.isFinite(value) ? Math.max(-31536000, Math.min(31536000, value)) : null;
        }
        for (const key of ['minCheckpointRevision', 'maxCheckpointRevision']) {
            const value = own(data, key); predicates[key] = typeof value === 'string' && /^(0|[1-9]\d{0,18})$/.test(value) ? value : null;
        }
        const matched = own(raw, 'matched_scope_rows');
        console.info('communications-admission', JSON.stringify({
            event: 'coverage_blocked', module: 'communications.application_admission',
            ...(typeof intentId === 'string' && /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(intentId) ? { intentId } : {}),
            expectedScopes, matchedScopeRows: typeof matched === 'number' && Number.isSafeInteger(matched) && matched >= 0 && matched <= 10000 ? matched : null,
            requiredServiceRevision: /^(0|[1-9]\d{0,18})$/.test(requiredServiceRevision) ? requiredServiceRevision : null,
            maxAgeSeconds, predicates,
        }));
    } catch { /* Diagnostic sinks and malformed metadata never change the outcome. */ }
}
function fail(): never { throw Error('Send authority unavailable'); }
const id = (v: unknown, max = 200): v is string => typeof v === 'string' && v.length > 0 && v.length <= max && v === v.trim() && !/[\u0000-\u001f\u007f]/.test(v);
const hex = (v: unknown): v is string => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v);
function plain(v: unknown): Record<string, unknown> {
    if (types.isPromise(v)) {
        void Promise.prototype.then.call(v, () => undefined, () => undefined);
        fail();
    }
    if (!v || typeof v !== 'object' || Array.isArray(v) || types.isProxy(v) || Object.getPrototypeOf(v) !== Object.prototype)
        fail();
    const d = Object.getOwnPropertyDescriptors(v);
    if (Reflect.ownKeys(d).some(k => typeof k !== 'string' || !('value' in d[k])))
        fail();
    return v as Record<string, unknown>;
}
/** Inspect data without invoking accessors; rejected accidental async fields are observed. */
function capture<T>(value: T): T {
    const pending: unknown[] = [value], seen = new Set<object>();
    let valid = true, visited = 0;
    while (pending.length && visited++ < 10000) {
        const current = pending.pop();
        if (types.isPromise(current)) {
            void Promise.prototype.then.call(current, () => undefined, () => undefined);
            valid = false;
            continue;
        }
        if (current === null || current === undefined || ['string', 'number', 'boolean'].includes(typeof current))
            continue;
        if (typeof current !== 'object' || types.isProxy(current)) {
            valid = false;
            continue;
        }
        if (seen.has(current))
            continue;
        seen.add(current);
        if (!Array.isArray(current) && Object.getPrototypeOf(current) !== Object.prototype) {
            valid = false;
            continue;
        }
        const fields = Object.getOwnPropertyDescriptors(current);
        for (const key of Reflect.ownKeys(fields)) {
            if (typeof key !== 'string' || !('value' in fields[key])) {
                valid = false;
                continue;
            }
            pending.push(fields[key].value);
        }
    }
    if (pending.length || !valid)
        fail();
    return structuredClone(value);
}
function canonical(v: unknown): unknown {
    if (Array.isArray(v))
        return v.map(canonical);
    if (v && typeof v === 'object') {
        const r = plain(v);
        return Object.fromEntries(Object.keys(r).sort().map(k => [k, canonical(r[k])]));
    }
    if (v === null || ['string', 'number', 'boolean'].includes(typeof v))
        return v;
    fail();
}
export const acquireSourceDigest = (v: unknown) => createHash('sha256').update(JSON.stringify(canonical(v))).digest('hex');
const timestamp = (v: unknown) => v instanceof Date ? Date.prototype.toISOString.call(v) : typeof v === 'string' && Number.isFinite(Date.parse(v)) ? new Date(v).toISOString() : fail();
export function createAcquireSendAdmission(inputOptions: AcquireSendAdmissionOptions): AcquireSendAdmission {
    let diagnostic:DispatchDiagnosticPort|undefined;
    let binding: ConnectionBinding, bindingId: string, connect: SqlPool['connect'], encode: AcquireSendAdmissionOptions['codec']['encode'], decode: AcquireSendAdmissionOptions['codec']['decode'], digest: AcquireSendAdmissionOptions['codec']['digest'], verify: AcquireSendAdmissionOptions['verifyServiceAdmission'], keyVersion: string, timeout: number, maxAge: number, prove: AcquireSendAdmissionOptions['proveNoSubmission'],loadContext:AcquireSendAdmissionOptions['loadExecutionContext'];
    try {
        const o = plain(inputOptions);
        if(o.diagnostic!==undefined&&(typeof o.diagnostic!=='function'||types.isProxy(o.diagnostic)))fail();
        diagnostic=o.diagnostic as DispatchDiagnosticPort|undefined;
        binding = capture(o.binding) as ConnectionBinding;
        assertSameBinding(binding, binding);
        bindingId = o.bindingId as string;
        const pool = o.pool as SqlPool, codec = o.codec as AcquireSendAdmissionOptions['codec'];
        if (types.isProxy(pool) || types.isProxy(codec))
            fail();
        const c = pool.connect, e = codec.encode, d = codec.decode, h = codec.digest, v = o.verifyServiceAdmission;
        keyVersion = codec.keyVersion;
        timeout = Number(o.timeoutMs ?? 20000);
        maxAge = Number(o.coverageMaxAgeSeconds ?? 300);
        if (binding.applicationId !== 'acquire' || binding.backend !== 'unipile' || !id(bindingId) || !id(keyVersion, 64) || [c, e, d, h, v].some(fn => typeof fn !== 'function') || !Number.isSafeInteger(timeout) || timeout < 1 || timeout > 25000 || !Number.isSafeInteger(maxAge) || maxAge < 1 || maxAge > 300)
            fail();
        connect = Function.prototype.bind.call(c, pool);
        encode = Function.prototype.bind.call(e, codec);
        decode = Function.prototype.bind.call(d, codec);
        digest = Function.prototype.bind.call(h, codec);
        verify = Function.prototype.bind.call(v as AcquireSendAdmissionOptions['verifyServiceAdmission'], inputOptions);
        const loader=o.loadExecutionContext;if(loader!==undefined&&(typeof loader!=='function'||types.isProxy(loader)))fail();
        loadContext=loader===undefined?undefined:Function.prototype.bind.call(loader as NonNullable<AcquireSendAdmissionOptions['loadExecutionContext']>,inputOptions);
        const retry = o.proveNoSubmission;
        if (retry !== undefined && typeof retry !== 'function')
            fail();
        prove = retry === undefined ? undefined : Function.prototype.bind.call(retry as NonNullable<AcquireSendAdmissionOptions['proveNoSubmission']>, inputOptions);
    }
    catch {
        throw Error('Invalid send authority configuration');
    }
    const scope = [binding.tenantId, binding.ownerId];
    function seal(s: MessageSubmission['snapshot'], v: unknown) {
        const e = encode(structuredClone(s), 'context', structuredClone(v));
        if (e.keyVersion !== keyVersion)
            fail();
        return { json: JSON.stringify(e), version: e.keyVersion, digest: digest(structuredClone(s), 'context', structuredClone(v), e.keyVersion) };
    }
    async function session(signal?:AbortSignal,operationDeadline?:number){
        const deadline=Math.min(performance.now()+timeout,operationDeadline??Number.POSITIVE_INFINITY);
        for(let attempt=0;attempt<10;attempt++){
            let serialization=false;
            try{return await sessionOnce(signal,deadline,()=>{serialization=true;});}
            catch(error){
                if(!serialization||attempt===9||signal?.aborted||performance.now()>=deadline)throw error;
                // A retired, rolled-back bootstrap has no intent or external effect.
                // Yield to normal tenant writers without restarting the absolute deadline.
                const delay=Math.min(125,25*(attempt+1))+Math.floor(Math.random()*26);
                await new Promise<void>((resolve,reject)=>{
                    let done=false;
                    const finish=(failed:boolean)=>{if(done)return;done=true;clearTimeout(timer);if(signal)EventTarget.prototype.removeEventListener.call(signal,'abort',cancel);if(failed)reject(error);else resolve();};
                    const cancel=()=>finish(true);
                    const timer=setTimeout(()=>finish(Boolean(signal?.aborted)||performance.now()>=deadline),Math.max(1,Math.min(delay,deadline-performance.now())));
                    if(signal)EventTarget.prototype.addEventListener.call(signal,'abort',cancel,{once:true});
                    if(signal?.aborted)cancel();
                });
            }
        }
        return fail();
    }
    async function sessionOnce(signal?: AbortSignal, operationDeadline?: number,onSerialization?:()=>void) {
        let bootstrapComplete=false,bootstrapSerialization=false;
        let client: SqlClient | undefined, closed = false, committing = false, committed = false, inFlight = 0;
        const deadline = Math.min(performance.now() + timeout, operationDeadline ?? Number.POSITIVE_INFINITY);
        let stoppedReject!: (e: Error) => void;
        const stopped = new Promise<never>((_, reject) => { stoppedReject = reject; });
        void stopped.catch(() => { });
        const dispose = (error?: Error) => {
            if (closed)
                return;
            closed = true;
            clearTimeout(timer);
            if (signal)
                EventTarget.prototype.removeEventListener.call(signal, 'abort', cancel);
            try {
                client?.release(error);
            }
            catch { /*private*/ }
        };
        const cancel = () => { dispose(Error('Send authority session retired')); stoppedReject(Error('Send authority unavailable')); };
        const live = () => {
            if (closed || performance.now() >= deadline || signal?.aborted) {
                cancel();
                fail();
            }
        };
        const call = async <T>(work: () => Promise<T>): Promise<T> => { live(); const p = Promise.resolve().then(work).then(v => { live(); return v; }); void p.catch(() => { }); return Promise.race([p, stopped]); };
        const timer = setTimeout(cancel, Math.max(1, Math.ceil(deadline - performance.now())));
        if (signal) {
            if (types.isProxy(signal))
                fail();
            EventTarget.prototype.addEventListener.call(signal, 'abort', cancel, { once: true });
        }
        try {
            client = await call(async () => {
                const c = await connect();
                if (closed || performance.now() >= deadline) {
                    c.release(Error('Send authority session retired'));
                    fail();
                }
                return c;
            });
            const q = Function.prototype.bind.call(client.query, client) as SqlClient['query'];
            const tx = { query: async <Row = Record<string, unknown>>(sql: string, values?: unknown[]): Promise<SqlResult<Row>> => call(async () => {
                    if (inFlight)
                        fail();
                    inFlight++;
                    try {
                        try{return await q<Row>(sql, values);}catch(error){if(!bootstrapComplete&&error&&typeof error==='object'&&!types.isProxy(error)&&['40001','55P03'].includes(Object.getOwnPropertyDescriptor(error,'code')?.value)){bootstrapSerialization=true;}const stage:DispatchDiagnosticStage=sql==='COMMIT'?'application.commit':sql.includes('agent_communications_source')?'application.source':sql.includes('communication_dispatch_permits')?'application.permit':sql.includes('communication_reply_monitors')?'application.coverage':sql.includes('communication_dispatch_intents')?'application.intent':sql.includes('communication_bindings')?'application.binding':'application.session';reportDispatchDiagnostic(diagnostic,stage,'error',error);if(sql.startsWith('INSERT INTO public.communication_dispatch_intents'))reportAdmissionPreparationFailure('application.intent',error);throw error;}
                    }
                    finally {
                        inFlight--;
                    }
                }) };
            await tx.query('BEGIN ISOLATION LEVEL SERIALIZABLE');
            await tx.query('SET LOCAL ROLE acquire_campaign_user');
            const roles = await tx.query('SELECT current_user AS role_name,rolsuper,rolbypassrls FROM pg_roles WHERE rolname=current_user');
            if (roles.rows.length !== 1 || roles.rows[0].role_name !== 'acquire_campaign_user' || roles.rows[0].rolsuper !== false || roles.rows[0].rolbypassrls !== false)
                fail();
            const runtime=agentTransactionRuntimeContext();
            // These independent transaction-local settings must all precede the
            // authority gate. One round trip retains the same role and lock fences.
            await tx.query("SELECT set_config('statement_timeout',$1,true),set_config('lock_timeout',$2,true),set_config('app.acquire_org',$3,true),set_config('app.acquire_user',$4,true)"+(runtime.runtimeId?",set_config('app.acquire_runtime_id',$5,true),set_config('app.acquire_channel_simulation',$6,true)":""), [`${Math.min(timeout, 5000)}ms`, `${Math.min(timeout, 1000)}ms`, ...scope,...(runtime.runtimeId?[runtime.runtimeId,runtime.channelSimulation?'true':'false']:[])]);
            const revision = await lockAcquireSendGate(tx, binding.tenantId, { required: true });
            const member = async () => {
                const r = await tx.query('SELECT public.communications_lock_send_member($1,$2) AS allowed', scope);
                if (r.rows.length !== 1 || r.rows[0].allowed !== true)
                    fail();
            };
            await member();
            // The immutable owned account is the last read-only bootstrap fence.
            // A 40001 or55P03 here is retryable only after confirmed rollback, before any
            // intent/source/context read or externally observable effect.
            await recordedBinding(tx);
            bootstrapComplete=true;
            return { tx, revision, member, call, async commit() {
                    committing = true;
                    try {
                        await tx.query('COMMIT');
                        committed = true;
                        dispose();
                    }
                    catch {
                        dispose(Error('Send authority session retired'));
                        fail();
                    }
                }, async abort() {
                    if (closed)
                        return;
                    if (committing || inFlight || performance.now() >= deadline) {
                        cancel();
                        return;
                    }
                    try {
                        await tx.query('ROLLBACK');
                    }
                    catch {
                        dispose(Error('Send authority session retired'));
                    }
                    finally {
                        dispose(committed ? undefined : undefined);
                    }
                } };
        }
        catch {
            if (client && !closed) {
                if (inFlight || committing || performance.now() >= deadline)
                    cancel();
                else {
                    try {
                        await client.query('ROLLBACK');
                        if(bootstrapSerialization&&!closed&&!signal?.aborted&&performance.now()<deadline)onSerialization?.();
                    }
                    catch {
                        dispose(Error('Send authority session retired'));
                    }
                    dispose(bootstrapSerialization?Error('Send authority serialization session retired'):undefined);
                }
            }
            else
                dispose();
            fail();
        }
    }
    type Session = Awaited<ReturnType<typeof session>>;
    async function recordedBinding(tx: Session['tx'], wanted = bindingId, enrolmentId?: string) {
        const r = await tx.query('SELECT * FROM public.communication_bindings WHERE id=$1 AND organization_id=$2 AND owner_user_id=$3', [wanted, ...scope]);
        const b = r.rows[0];
        if (enrolmentId) {
            const recorded = await tx.query('SELECT binding_id FROM public.campaign_channel_bindings WHERE enrolment_id=$1 AND organization_id=$2 AND owner_user_id=$3 AND channel=$4 AND binding_id=$5', [enrolmentId, ...scope, b?.channel, wanted]);
            if (recorded.rows.length !== 1 || recorded.rows[0].binding_id !== wanted)
                fail();
        }
        if (r.rows.length !== 1 || b.id !== wanted || b.backend !== 'unipile' || b.authority !== 'service' || b.application_id !== 'acquire')
            fail();
        const value = { applicationId: b.application_id, tenantId: b.organization_id, ownerId: b.owner_user_id, connectionId: b.service_connection_id, accountId: b.service_account_id, generation: b.generation, channel: b.channel, platform: b.platform, backend: b.backend } as ConnectionBinding;
        assertSameBinding(value, value);
        if (wanted === bindingId)
            assertSameBinding(binding, value);
        return value;
    }
    async function sourceStateWithoutExecutionContext(tx: Session['tx'], source: AcquireIntentSource, message: MessageSubmission['message'], render: boolean) {
        let r: Record<string, unknown>, sourceValue: unknown, requiredSince: string, channels: string[];
        if(source.kind==='agent'){
            const kind=await readAgentCommunicationsSourceKind(tx,source,bindingId);
            if(kind==='recorded_channel'){
                const proof=await readAgentChannelCommunicationsSource(tx,source,bindingId);
                if(proof.channel!==binding.channel||!isDeepStrictEqual(message.recipient,proof.recipient)||message.text!==proof.body)fail();
                if(message.rfcMessageId!==undefined||message.replyTo!==undefined)fail();
                if(binding.channel==='email'){
                    if(message.subject!==proof.subject||message.conversation!==undefined)fail();
                    if(proof.replyParent){if(!message.replyParent||message.replyParent.message.id!==proof.replyParent.id||message.replyParent.contentDigest!==proof.replyParent.contentDigest)fail();assertSameBinding(binding,message.replyParent.message.binding);}else if(message.replyParent!==undefined)fail();
                }else{
                    if(message.subject!==undefined||message.replyParent!==undefined)fail();
                    if(proof.conversation){if(!message.conversation||message.conversation.id!==proof.conversation.id)fail();assertSameBinding(binding,message.conversation.binding);}else if(message.conversation!==undefined)fail();
                }
                const recipients={email:{kind:'email' as const,value:null as string|null},whatsapp:{kind:'phone' as const,value:null as string|null},linkedin:{kind:'linkedin_profile' as const,value:null as string|null}};
                for(const route of proof.coverageRoutes)recipients[route.channel].value=route.recipient.value;
                return {recipients,contactId:proof.contactId,requiredSince:proof.requiredSince,sourceDigest:acquireSourceDigest({source,proof}),channels:proof.coverageRoutes.map(r=>r.channel),coverageBindingIds:proof.coverageRoutes.map(r=>r.bindingId),operation:proof.effect==='invitation'?'invitation' as const:'message' as const,address:recipients.email.value??'',driverAllowed:true};
            }
            if(binding.channel!=='email')fail();
            let proof:Awaited<ReturnType<typeof readAgentCommunicationsSource>>;try{proof=await readAgentCommunicationsSource(tx,source,bindingId);}catch(error){reportDispatchDiagnostic(diagnostic,'application.source','error',error);throw error;}
            if(message.recipient.kind!=='email'||message.recipient.value!==proof.recipient||message.subject!==proof.subject||message.text!==proof.body)fail();
            if(message.conversation!==undefined||message.rfcMessageId!==undefined||message.replyTo!==undefined)fail();
            if(proof.replyParent){
                if(!message.replyParent||message.replyParent.message.id!==proof.replyParent.id||message.replyParent.contentDigest!==proof.replyParent.contentDigest)fail();
                assertSameBinding(binding,message.replyParent.message.binding);
            }else if(message.replyParent!==undefined)fail();
            // Native authorization already checks non-reply holds, opt-outs and
            // verified history. Cold-sequence reply holds stay unchanged below.
            return {recipients:{email:{kind:'email' as const,value:proof.recipient},whatsapp:{kind:'phone' as const,value:null},linkedin:{kind:'linkedin_profile' as const,value:null}},contactId:proof.contactId,requiredSince:proof.requiredSince,sourceDigest:acquireSourceDigest({source,proof}),channels:['email'],coverageBindingIds:[bindingId],address:proof.recipient,driverAllowed:true};
        }
        if (source.kind === 'campaign') {
            const selected = await tx.query(`SELECT a.id AS attempt_id,a.state AS attempt_state,e.id AS enrolment_id,e.version_id,e.mandate_id,e.contact_id,e.step_index,e.runtime,e.state,(e.next_step_at<=${businessSql(inputOptions.businessClock)}) AS due,e.started_at,e.initial_conversation_reviewed,e.communication_initial_reviewed_at,(e.communication_initial_reviewed_at>=e.started_at AND e.communication_initial_reviewed_at<=${businessSql(inputOptions.businessClock)}) AS review_time_valid,v.definition,c.display_name,COALESCE(t.company_name,c.personal_data->>'companyName','') AS company_name,c.fictionalised,c.personal_data,e.recipient_email,e.recipient_phone,e.recipient_linkedin,EXISTS(SELECT 1 FROM public.campaign_channel_bindings cb WHERE cb.enrolment_id=e.id AND cb.organization_id=e.organization_id AND cb.owner_user_id=e.owner_user_id AND cb.channel=$6 AND cb.binding_id=$5) AS bound,EXISTS(SELECT 1 FROM public.campaign_contact_assignments ca WHERE ca.organization_id=e.organization_id AND ca.contact_id=e.contact_id AND ca.owner_user_id=e.owner_user_id) AS assigned FROM public.campaign_send_attempts a JOIN public.campaign_enrolments e ON e.id=a.enrolment_id JOIN public.campaign_sequence_versions v ON v.id=e.version_id JOIN public.contacts c ON c.id=e.contact_id LEFT JOIN public.targets t ON t.id=c.target_id WHERE a.id=$1 AND e.id=$2 AND e.organization_id=$3 AND e.owner_user_id=$4 FOR UPDATE OF a,e`, [source.attemptId, source.enrolmentId, ...scope, bindingId, binding.channel]);
            if (selected.rows.length !== 1)
                fail();
            r = selected.rows[0];
            if (r.attempt_id !== source.attemptId || r.attempt_state !== 'claimed' || r.enrolment_id !== source.enrolmentId || r.version_id !== source.versionId || r.step_index !== source.stepIndex || r.runtime !== source.runtime || r.state !== 'active' || r.bound !== true || r.due !== true || r.assigned !== true || r.initial_conversation_reviewed !== true || r.review_time_valid !== true)
                fail();
            const definition = campaignDefinition.parse(r.definition), step = campaignStepEntries(definition)[source.stepIndex]?.step;
            if (!step || step.kind === 'wait' || step.id !== source.stepId || step.kind !== binding.channel)
                fail();
            channels = campaignChannels(definition);
            sourceValue = { source, definition };
            requiredSince = timestamp(r.communication_initial_reviewed_at);
            if (render) {
                const vars = { displayName: r.display_name as string, companyName: r.company_name as string };
                if (message.text !== renderCampaignTemplate(step.body, vars) || step.kind === 'email' && message.subject !== renderCampaignTemplate(step.subject, vars))
                    fail();
            }
        }
        else {
            const selected = await tx.query(`SELECT m.id,m.state,m.subject,m.body,m.updated_at,m.approved_by,m.approved_at,e.mandate_id,e.contact_id,e.state AS enrolment_state,c.personal_data,c.fictionalised,c.display_name FROM public.messages m JOIN public.sequence_enrolments e ON e.id=m.enrolment_id JOIN public.contacts c ON c.id=e.contact_id JOIN public.outreach_draft_bindings b ON b.message_id=m.id WHERE m.id=$1 AND m.organization_id=$2 AND b.owner_user_id=$3 AND b.binding_id=$4 FOR UPDATE OF m`, [source.messageId, ...scope, bindingId]);
            if (selected.rows.length !== 1)
                fail();
            r = selected.rows[0];
            if (binding.channel !== 'email' || r.id !== source.messageId || r.state !== 'approved' || !r.approved_by || !r.approved_at || timestamp(r.updated_at) !== source.revision || ['paused', 'stopped', 'completed', 'rejected'].includes(r.enrolment_state as string) || r.subject !== message.subject || r.body !== message.text)
                fail();
            sourceValue = { source, subject: r.subject, body: r.body, approvedBy: r.approved_by, approvedAt: timestamp(r.approved_at) };
            requiredSince = timestamp(r.approved_at);
            channels = ['email'];
        }
        // Explicit immutable enrolment origin, never the shared contact's
        // original mandate. This fences both preparation and final admission,
        // while getPreparedIntent/receipt reconciliation keep original lookup.
        await tx.query('SELECT public.agent_assert_manual_mandate_outreach_mode($1)', [r.mandate_id ?? null]);
        if (r.fictionalised !== false || !id(r.contact_id))
            fail();
        const data = plain(r.personal_data);
        if (data.doNotContact === true)
            fail();
        const target = binding.channel === 'email' ? outreachEmail(data.email) : binding.channel === 'whatsapp' ? contactPhone(data.phone) : contactLinkedin(data.linkedinUrl || data.linkedin || data.linkedin_url);
        if (target !== message.recipient.value || message.recipient.kind !== (binding.channel === 'email' ? 'email' : binding.channel === 'whatsapp' ? 'phone' : 'linkedin_profile'))
            fail();
        const recipients = { email: { kind: 'email' as const, value: outreachEmail(data.email) }, whatsapp: { kind: 'phone' as const, value: contactPhone(data.phone) }, linkedin: { kind: 'linkedin_profile' as const, value: contactLinkedin(data.linkedinUrl || data.linkedin || data.linkedin_url) } };
        const driverAllowed=await agentDriverAllowed(tx,{organizationId:binding.tenantId,userId:binding.ownerId},{contactId:r.contact_id as string,address:outreachEmail(data.email),kind:source.kind,sourceRef:source.kind==='campaign'?source.enrolmentId:source.messageId});
        return { recipients, contactId: r.contact_id, requiredSince, sourceDigest: acquireSourceDigest(sourceValue), legacyNullOrigin:r.mandate_id===null, channels, address: outreachEmail(data.email),driverAllowed };
    }
    // The held organization gate serializes policy/intent writers; append-only intent rows
    // need SELECT only, without a FOR SHARE lock that would require UPDATE privilege.
    async function sourceState(tx:Session['tx'],source:AcquireIntentSource,message:MessageSubmission['message'],render:boolean){
        const state=await sourceStateWithoutExecutionContext(tx,source,message,render);
        if(!loadContext||'legacyNullOrigin'in state&&state.legacyNullOrigin)return {...state,executionContext:null};
        const context=mandateExecutionContextSchema.parse(await loadContext(tx,source));
        const {manifestDigest,...preimage}=context;if(acquireSourceDigest(preimage)!==manifestDigest)fail();
        const sourceId=source.kind==='agent'?source.operationId:source.kind==='campaign'?source.attemptId:source.messageId;
        if(context.origin.kind!==source.kind||context.origin.sourceId!==sourceId||context.contact.sourceId!==state.contactId||source.kind!=='agent'&&context.mode==='demo')fail();
        assertNewEffectPermitted(context,{bindingId,bindingDigest:acquireSourceDigest(binding),generation:binding.generation,channel:binding.channel,recipient:message.recipient.value});
        return {...state,executionContext:context};
    }
    async function stored(tx: Session['tx'], key: string) {
        const r = await tx.query('SELECT * FROM public.communication_dispatch_intents WHERE organization_id=$1 AND owner_user_id=$2 AND operation_key=$3', [...scope, key]);
        if (r.rows.length > 1)
            fail();
        return r.rows[0];
    }
    function opened(row: Record<string, unknown>) {
        if (row.organization_id !== binding.tenantId || row.owner_user_id !== binding.ownerId || row.binding_id !== bindingId || !id(row.operation_key) || !hex(row.payload_digest) || !id(row.intent_key_version, 64) || typeof row.encrypted_intent !== 'string' || !hex(row.intent_digest))
            fail();
        const snapshot = { binding: structuredClone(binding), key: row.operation_key, operation: row.operation as MessageSubmission['snapshot']['operation'], payloadDigest: row.payload_digest };
        const envelope = JSON.parse(row.encrypted_intent);
        if (envelope.keyVersion !== row.intent_key_version)
            fail();
        const value = plain(decode(snapshot, 'context', envelope));
        if (!['acquire.dispatch-intent.v1','acquire.dispatch-intent.v2'].includes(value.domain as string) || Object.keys(value).some(k => !['domain', 'submission', 'source', 'coverageScopes', 'contactId', 'requiredSince', 'sourceDigest','executionContext'].includes(k)) || value.domain==='acquire.dispatch-intent.v1'&&value.executionContext!==undefined || value.domain==='acquire.dispatch-intent.v2'&&value.executionContext===undefined)
            fail();
        if (digest(snapshot, 'context', value, row.intent_key_version) !== row.intent_digest)
            fail();
        const originalSource = value.source as AcquireIntentSource, sourceId = originalSource.kind === 'campaign' ? originalSource.attemptId : originalSource.kind==='agent'?originalSource.operationId:originalSource.messageId, scopes = typeof row.coverage_scopes === 'string' ? JSON.parse(row.coverage_scopes) : row.coverage_scopes;
        if (row.source_kind !== originalSource.kind || row.source_id !== sourceId || !Number.isSafeInteger(row.epoch) || Number(row.epoch) < 1 || row.operation_key !== `acquire:${originalSource.kind}:${sourceId}:${row.epoch}` || row.contact_id !== value.contactId || timestamp(row.required_since) !== value.requiredSince || row.source_digest !== value.sourceDigest || !isDeepStrictEqual(scopes, value.coverageScopes))
            fail();
        const submission = value.submission as MessageSubmission;
        assertOperationMatches(snapshot, submission.snapshot);
        if (messageDigest(snapshot.operation, submission.message) !== snapshot.payloadDigest)
            fail();
        const executionContext=value.domain==='acquire.dispatch-intent.v2'?mandateExecutionContextSchema.parse(value.executionContext):null;
        if(executionContext?(row.execution_mandate_id!==executionContext.origin.mandateId||row.execution_context_digest!==executionContext.manifestDigest||row.execution_mode!==executionContext.mode):(row.execution_mandate_id!=null||row.execution_context_digest!=null||row.execution_mode!=null))fail();
        return { executionContext,snapshot, source: value.source as AcquireIntentSource, submission: structuredClone(submission), coverageScopes: value.coverageScopes as AcquireCoverageScope[], contactId: value.contactId as string, requiredSince: value.requiredSince as string, sourceDigest: value.sourceDigest as string };
    }
    async function policy(s: Session, row: Record<string, unknown>, value: ReturnType<typeof opened>, serviceRevision: string) {
        if (process.env.COMMUNICATIONS_RUNTIME_ENABLED === 'true' && process.env.CAMPAIGN_REPLY_MONITOR_MODE !== 'enforce')
            return { status: 'review', code: 'forbidden' } as const;
        if (value.source.kind === 'campaign') {
            const time = await s.tx.query(`SELECT ${businessSql(inputOptions.businessClock)} AS admission_now`);
            if (time.rows.length !== 1)
                fail();
            const observed = new Date(timestamp(time.rows[0].admission_now));
            if (!campaignSendWindowOpen(observed))
                return { status: 'waiting', code: 'busy', retryAt: nextAllowedCampaignSend(observed).toISOString() } as const;
        }
        const state = await sourceState(s.tx, value.source, value.submission.message, false);
        if (state.sourceDigest !== value.sourceDigest || state.contactId !== value.contactId || value.executionContext&&!isDeepStrictEqual(value.executionContext,state.executionContext)){reportDispatchDiagnostic(diagnostic,'application.source','blocked');
            fail();}
        if(!state.driverAllowed)return {status:'review',code:'forbidden'} as const;
        const clear = value.source.kind==='agent'?{rows:[{clear:true}]}:await s.tx.query('SELECT public.communications_admission_person_clear($1,$2,$3,$4) AS clear', [...scope, state.contactId, state.address]);
        if (clear.rows.length !== 1 || clear.rows[0].clear !== true)
            return { status: 'review', code: 'forbidden' } as const;
        const covered = await s.tx.query(`SELECT count(*)::integer=$5::integer AS ready, count(*)::integer AS matched_scope_rows,
        (SELECT jsonb_build_object(
            'scopeRows', count(*)::integer, 'monitorRows', count(dm.binding_id)::integer, 'checkpointRows', count(dp.binding_id)::integer,
            'allComplete', bool_and(dm.complete IS TRUE), 'allInitialSync', bool_and(dm.initial_sync_complete IS TRUE),
            'anyInvalidated', bool_or(dm.invalidated IS TRUE),
            'allCoverRequiredSince', bool_and(coalesce(dm.coverage_from<=$4::timestamptz AND dm.coverage_through>=$4::timestamptz,false)),
            'allCoverageFresh', bool_and(coalesce(dm.coverage_through>=${businessSql(inputOptions.businessClock)}-($6::double precision*interval '1 second'),false)),
            'allObservedFresh', bool_and(coalesce(dm.observed_at>=${businessSql(inputOptions.businessClock)}-($6::double precision*interval '1 second'),false)),
            'allTimestampsOrdered', bool_and(coalesce(dm.coverage_through<=dm.observed_at AND dm.observed_at<=${businessSql(inputOptions.businessClock)},false)),
            'allRevisionsCurrent', bool_and(coalesce(dp.observed_service_revision>=$7::bigint,false)),
            'minCheckpointRevision', min(dp.observed_service_revision)::text, 'maxCheckpointRevision', max(dp.observed_service_revision)::text,
            'oldestCoverageAgeSeconds', max(extract(epoch FROM (${businessSql(inputOptions.businessClock)}-dm.coverage_through)))::double precision,
            'oldestObservedAgeSeconds', max(extract(epoch FROM (${businessSql(inputOptions.businessClock)}-dm.observed_at)))::double precision
        ) FROM jsonb_array_elements($3::jsonb) requested(scope)
          LEFT JOIN public.communication_reply_monitors dm ON dm.organization_id=$1 AND dm.owner_user_id=$2 AND dm.binding_id::text=requested.scope->>'bindingId' AND dm.scope_digest=requested.scope->>'scopeDigest'
          LEFT JOIN public.communication_consumer_checkpoints dp ON dp.binding_id=dm.binding_id AND dp.scope_digest=dm.scope_digest) AS coverage_diagnostics
        FROM public.communication_reply_monitors m JOIN public.communication_consumer_checkpoints p ON p.binding_id=m.binding_id AND p.scope_digest=m.scope_digest WHERE m.organization_id=$1 AND m.owner_user_id=$2 AND (m.binding_id::text,m.scope_digest) IN(SELECT x->>'bindingId',x->>'scopeDigest' FROM jsonb_array_elements($3::jsonb)x) AND m.complete AND m.initial_sync_complete AND NOT m.invalidated AND m.coverage_from<=$4::timestamptz AND m.coverage_through>=$4::timestamptz AND m.coverage_through>=${businessSql(inputOptions.businessClock)}-($6::double precision*interval '1 second') AND m.coverage_through<=m.observed_at AND m.observed_at<=${businessSql(inputOptions.businessClock)} AND m.observed_at>=${businessSql(inputOptions.businessClock)}-($6::double precision*interval '1 second') AND p.observed_service_revision>=$7::bigint`, [...scope, JSON.stringify(value.coverageScopes), value.requiredSince, value.coverageScopes.length, maxAge, serviceRevision]);
        if (covered.rows.length !== 1 || covered.rows[0].ready !== true){reportDispatchDiagnostic(diagnostic,'application.coverage','blocked');
            logCoverageBlocked(covered.rows.length === 1 ? covered.rows[0] : undefined, row.id, value.coverageScopes.length, serviceRevision, maxAge);
            return { status: 'waiting', code: 'incomplete' } as const;}
        const used = await s.tx.query('SELECT id FROM public.communication_dispatch_permits WHERE intent_id=$1', [row.id]);
        if (used.rows.length)
            return { status: 'review', code: 'unresolved_send' } as const;
        return null;
    }
    return { async getPreparedCoverage(input) { let s: Session | undefined; try {
            const snapshot = capture(input);
            assertSameBinding(binding, snapshot.binding);
            s = await session();

            const row = await stored(s.tx, snapshot.key);
            if (!row)
                fail();
            const value = opened(row);
            assertOperationMatches(value.snapshot, snapshot);
            if (!Array.isArray(value.coverageScopes) || value.coverageScopes.length < 1 || value.coverageScopes.length > 3)
                fail();
            const result = [];
            for (const scope of value.coverageScopes) {
                if (!id(scope.bindingId) || !hex(scope.scopeDigest))
                    fail();
                const original = await recordedBinding(s.tx, scope.bindingId, value.source.kind === 'campaign' ? value.source.enrolmentId : undefined);
                if (value.source.kind === 'draft' && scope.bindingId !== bindingId)
                    fail();
                result.push({ binding: original, scopeDigest: scope.scopeDigest });
            }
            await s.member();
            await s.commit();
            return result;
        }
        catch {
            fail();
        }
        finally {
            await s?.abort();
        } }, async getPreparedIntent(input) {
            let s: Session | undefined;
            try {
                const captured = capture(input);
                if (!['campaign', 'draft', 'agent'].includes(captured.sourceKind) || !id(captured.sourceId))
                    fail();
                s = await session();

                const rows = await s.tx.query('SELECT * FROM public.communication_dispatch_intents WHERE organization_id=$1 AND owner_user_id=$2 AND source_kind=$3 AND source_id=$4 ORDER BY epoch DESC LIMIT 1', [...scope, captured.sourceKind, captured.sourceId]);
                if (rows.rows.length > 1)
                    fail();
                const row = rows.rows[0];
                if (!row) {
                    await s.commit();
                    return null;
                }
                if (row.source_kind !== captured.sourceKind || row.source_id !== captured.sourceId)
                    fail();
                const value = opened(row);
                await s.member();
                await s.commit();
                return { intentId: row.id as string, epoch: row.epoch as number, submission: value.submission };
            }
            catch {
                fail();
            }
            finally {
                await s?.abort();
            }
        }, async resolveNoSubmission(input) {
            const controller=new AbortController(),deadline=performance.now()+timeout;let s:Session|undefined;
            let rejectStopped!:(error:Error)=>void;const stopped=new Promise<never>((_,reject)=>{rejectStopped=reject;});void stopped.catch(()=>{});
            const timer=setTimeout(()=>{controller.abort();rejectStopped(Error('Send authority unavailable'));},timeout);
            try{
                const snapshot=capture(input);assertSameBinding(binding,snapshot.binding);
                s=await session(controller.signal,deadline);const original=await stored(s.tx,snapshot.key),value=opened(original);assertOperationMatches(snapshot,value.snapshot);
                const validateProof=(raw:unknown)=>{const proof=plain(raw);assertOperationMatches(snapshot,proof.snapshot as MessageSubmission['snapshot']);const outcome=plain(proof.outcome);if(!['waiting','review','rejected','skipped'].includes(outcome.status as string)||!id(proof.journalId)||!hex(proof.evidenceDigest)||!id(proof.keyVersion,64))fail();return proof;};
                const readResolution=async()=>{const rows=await s!.tx.query('SELECT * FROM public.communication_intent_resolutions WHERE intent_id=$1',[original.id]);if(rows.rows.length>1)fail();const row=rows.rows[0];if(!row)return null;if(typeof row.encrypted_proof!=='string'||!id(row.proof_key_version,64)||!hex(row.proof_digest))fail();const envelope=JSON.parse(row.encrypted_proof);if(envelope.keyVersion!==row.proof_key_version)fail();const disposition=plain(decode(snapshot,'context',envelope));if(disposition.domain!=='acquire.no-submission.v1'||Object.keys(disposition).some(k=>!['domain','proof'].includes(k))||digest(snapshot,'context',disposition,row.proof_key_version)!==row.proof_digest)fail();validateProof(disposition.proof);return {intentId:original.id as string,operationKey:snapshot.key,proofDigest:row.proof_digest as string};};
                let existing=await readResolution();if(existing){await s.member();await s.commit();return existing;}
                await s.commit();s=undefined;if(!prove)return null;
                const pending=Promise.resolve().then(()=>prove!(structuredClone(snapshot),controller.signal));void pending.catch(()=>{});const proof=await Promise.race([pending,stopped]);if(!proof)return null;validateProof(proof);
                s=await session(controller.signal,deadline);const latest=await stored(s.tx,snapshot.key);if(latest.id!==original.id)fail();opened(latest);existing=await readResolution();if(existing){await s.member();await s.commit();return existing;}
                const disposition=seal(snapshot,{domain:'acquire.no-submission.v1',proof:capture(proof)});await s.tx.query('INSERT INTO public.communication_intent_resolutions(intent_id,encrypted_proof,proof_key_version,proof_digest) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING',[original.id,disposition.json,disposition.version,disposition.digest]);
                // Read back and authenticate the immutable winning proof, including
                // a concurrent resolution. Never invent a second operation key.
                const result=await readResolution();if(!result)fail();await s.member();await s.commit();return result;
            }catch{fail();}finally{clearTimeout(timer);controller.abort();await s?.abort();}
        }, async prepare(input) {
            let s: Session | undefined;
            const controller = new AbortController(), deadline = performance.now() + timeout;
            let rejectStopped!: (e: Error) => void;
            const stop = new Promise<never>((_, reject) => { rejectStopped = reject; });
            void stop.catch(() => { });
            const timer = setTimeout(() => { controller.abort(); rejectStopped(Error('Send authority unavailable')); }, timeout);
            const run = async () => {
                const captured = capture(input);
                if (!['campaign', 'draft', 'agent'].includes(captured.source.kind) || !Array.isArray(captured.coverageScopes) || captured.coverageScopes.length < 1 || captured.coverageScopes.length > 3 || captured.coverageScopes.some(x => !id(x.bindingId) || !hex(x.scopeDigest)))
                    fail();
                const source = captured.source, sourceId = source.kind === 'campaign' ? source.attemptId : source.kind==='agent'?source.operationId:source.messageId;
                s = await session(controller.signal, deadline);

                const observedRows = await s.tx.query('SELECT * FROM public.communication_dispatch_intents WHERE organization_id=$1 AND owner_user_id=$2 AND source_kind=$3 AND source_id=$4 ORDER BY epoch DESC LIMIT 1', [...scope, source.kind, sourceId]);
                const observed = observedRows.rows[0], observedValue = observed ? opened(observed) : null;
                await s.commit();
                s = undefined;
                let proof: Awaited<ReturnType<NonNullable<AcquireSendAdmissionOptions['proveNoSubmission']>>> = null;
                if (observedValue && prove) {
                    if (controller.signal.aborted || performance.now() >= deadline)
                        fail();
                    const pending = Promise.resolve().then(() => prove!(structuredClone(observedValue.snapshot), controller.signal));
                    void pending.catch(() => { });
                    proof = await Promise.race([pending, stop]);
                    if (proof) {
                        assertOperationMatches(observedValue.snapshot, proof.snapshot);
                        const result = plain(proof.outcome);
                        if (!['waiting', 'review', 'rejected', 'skipped'].includes(result.status as string) || !id(proof.journalId) || !hex(proof.evidenceDigest) || !id(proof.keyVersion, 64))
                            fail();
                    }
                }
                s = await session(controller.signal, deadline);

                const latestRows = await s.tx.query('SELECT * FROM public.communication_dispatch_intents WHERE organization_id=$1 AND owner_user_id=$2 AND source_kind=$3 AND source_id=$4 ORDER BY epoch DESC LIMIT 1', [...scope, source.kind, sourceId]), existing = latestRows.rows[0];
                if (existing && (!proof || existing.id !== observed?.id)) {
                    const value = opened(existing);
                    const current = await sourceState(s.tx, value.source, value.submission.message, false);
                    if (!current.driverAllowed || value.executionContext&&!isDeepStrictEqual(value.executionContext,current.executionContext) || current.sourceDigest !== value.sourceDigest || !isDeepStrictEqual(captured.message.recipient, value.submission.message.recipient))
                        fail();
                    await s.member();
                    await s.commit();
                    return { intentId: existing.id as string, epoch: existing.epoch as number, submission: value.submission };
                }
                const state = await sourceState(s.tx, source, captured.message, true), epoch = existing ? Number(existing.epoch) + 1 : 1;
                if(!state.driverAllowed)fail();
                if (!Number.isSafeInteger(epoch) || epoch < 1 || epoch > 2147483647)
                    fail();
                const coveredBindings: ConnectionBinding[] = [];
                for (const coverage of captured.coverageScopes) {
                    if (source.kind === 'draft' && coverage.bindingId !== bindingId)
                        fail();
                    coveredBindings.push(await recordedBinding(s.tx, coverage.bindingId, source.kind === 'campaign' ? source.enrolmentId : undefined));
                }
                if (new Set(coveredBindings.map(b => b.channel)).size !== state.channels.length || state.channels.some(c => !coveredBindings.some(b => b.channel === c)))
                    fail();
                if(source.kind==='agent'&&('coverageBindingIds'in state)&&(!state.coverageBindingIds||state.coverageBindingIds.length!==captured.coverageScopes.length||state.coverageBindingIds.some(expected=>!captured.coverageScopes.some(actual=>actual.bindingId===expected))))fail();
                const operation = source.kind==='agent'&&'operation'in state&&state.operation!==undefined?state.operation:source.kind === 'campaign' && binding.channel === 'linkedin' && (campaignStepEntries(campaignDefinition.parse((await s.tx.query('SELECT definition FROM public.campaign_sequence_versions WHERE id=$1', [source.versionId])).rows[0]?.definition))[source.stepIndex].step as {
                    action?: string;
                }).action === 'connect' ? 'invitation' : 'message';
                const key = `acquire:${source.kind}:${sourceId}:${epoch}`, submission = { snapshot: { binding: structuredClone(binding), key, operation, payloadDigest: messageDigest(operation, captured.message) }, message: captured.message } as MessageSubmission;
                if (existing) {
                    if (!proof || !observedValue)
                        fail();
                    const disposition = seal(observedValue.snapshot, { domain: 'acquire.no-submission.v1', proof });
                    await s.tx.query('INSERT INTO public.communication_intent_resolutions(intent_id,encrypted_proof,proof_key_version,proof_digest) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING', [existing.id, disposition.json, disposition.version, disposition.digest]);
                }
                const value = { domain: state.executionContext?'acquire.dispatch-intent.v2':'acquire.dispatch-intent.v1', submission, source, coverageScopes: captured.coverageScopes, contactId: state.contactId, requiredSince: state.requiredSince, sourceDigest: state.sourceDigest,...(state.executionContext?{executionContext:state.executionContext}:{}) }, encrypted = seal(submission.snapshot, value), intentId = randomUUID();
                const inserted = await s.tx.query('INSERT INTO public.communication_dispatch_intents(id,organization_id,owner_user_id,binding_id,source_kind,source_id,epoch,contact_id,operation_key,operation,payload_digest,intent_digest,encrypted_intent,intent_key_version,source_digest,required_since,coverage_scopes,predecessor_id'+(state.executionContext?',execution_mandate_id,execution_context_digest,execution_mode':'')+') VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17::jsonb,$18'+(state.executionContext?',$19,$20,$21':'')+') RETURNING *', [intentId, ...scope, bindingId, source.kind, sourceId, epoch, state.contactId, key, operation, submission.snapshot.payloadDigest, encrypted.digest, encrypted.json, encrypted.version, state.sourceDigest, state.requiredSince, JSON.stringify(captured.coverageScopes), existing?.id ?? null,...(state.executionContext?[state.executionContext.origin.mandateId,state.executionContext.manifestDigest,state.executionContext.mode]:[])]);
                if (inserted.rows.length !== 1)
                    fail();
                opened(inserted.rows[0]);
                await s.member();
                await s.commit();
                return { intentId, epoch, submission: structuredClone(submission) };
            };
            try {
                const work = Promise.resolve().then(run);
                void work.catch(() => { });
                return await Promise.race([work, stop]);
            }
            catch (error) {
                reportAdmissionPreparationFailure('application.prepare',error);
                fail();
            }
            finally {
                clearTimeout(timer);
                controller.abort();
                await s?.abort();
            }
        },
        async open(challenge, signal) {
            let s: Session | undefined;
            try {
                const captured = capture(challenge);
                assertSameBinding(binding, captured.record.snapshot.binding);
                if (captured.record.state !== 'claimed' || !id(captured.claimToken) || !/^\d+$/.test(captured.serviceRevision))
                    fail();
                s = await session(signal);

                const row = await stored(s.tx, captured.record.snapshot.key);
                if (!row)
                    fail();
                const value = opened(row);
                assertOperationMatches(value.snapshot, captured.record.snapshot);
                if (!isDeepStrictEqual(captured.record.recipient, value.submission.message.recipient))
                    fail();
                const blocked = await policy(s, row, value, captured.serviceRevision);
                if (blocked) {
                    await s.abort();
                    return { kind: 'blocked', outcome: blocked };
                }
                const held = s;
                const permitId = randomUUID();
                const coverageScopes = [];
                const state = await sourceState(held.tx, value.source, value.submission.message, false);
                for (const scope of value.coverageScopes) {
                    const original = await recordedBinding(held.tx, scope.bindingId, value.source.kind === 'campaign' ? value.source.enrolmentId : undefined), recipient = state.recipients[original.channel];
                    if (!recipient.value)
                        fail();
                    coverageScopes.push({ binding: original, recipient: { kind: recipient.kind, value: recipient.value }, scopeDigest: scope.scopeDigest, requiredSince: value.requiredSince });
                }
                s = undefined;
                return { kind: 'held', permit: { permitId, intentDigest: row.intent_digest as string, coverageScopes, async commit(receipt, commitSignal) {
                            try {
                                if (commitSignal.aborted || receipt.permitId !== permitId || receipt.intentDigest !== row.intent_digest || receipt.serviceRevision !== captured.serviceRevision || !id(receipt.admissionId) || !id(receipt.journalId))
                                    fail();
                                assertOperationMatches(value.snapshot, receipt.snapshot);
                                if (await held.call(() => verify(structuredClone(receipt), commitSignal)) !== true)
                                    fail();
                                if (await policy(held, row, value, captured.serviceRevision))
                                    fail();
                                const sealed = seal(value.snapshot, { domain: 'acquire.service-admission.v1', receipt });
                                await held.tx.query('INSERT INTO public.communication_dispatch_permits(id,intent_id,service_admission_id,service_journal_id,encrypted_receipt,receipt_key_version,receipt_digest) VALUES($1,$2,$3,$4,$5,$6,$7)', [permitId, row.id, receipt.admissionId, receipt.journalId, sealed.json, sealed.version, sealed.digest]);
                                await held.member();
                                await held.commit();
                                return 'committed';
                            }
                            catch(error) {
                                reportDispatchDiagnostic(diagnostic,'application.permit','error',error);
                                await held.abort();
                                fail();
                            }
                        }, abort: () => held.abort() } };
            }
            catch(error) {
                reportDispatchDiagnostic(diagnostic,'application.policy','error',error);
                await s?.abort();
                return { kind: 'blocked', outcome: { status: 'review', code: 'forbidden' } };
            }
        }
    };
}
