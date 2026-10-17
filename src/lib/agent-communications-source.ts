import {z} from 'zod';
import {agentPersonChannelRecipientSchema} from '../domain/agent-person-channel';
import type {SqlClient} from '../../communications/packages/storage-postgres/src/webhook-repository';
/** Server-owned source metadata; model tool arguments cannot manufacture a send. */
export const agentCommunicationsSourceSchema=z.object({kind:z.literal('agent'),effect:z.literal('invitation').optional(),operationId:z.string().uuid(),conversationId:z.string().uuid(),epoch:z.number().int().positive().safe(),fence:z.string().regex(/^[1-9]\d{0,18}$/)}).strict();
export type AgentCommunicationsIntentSource=z.infer<typeof agentCommunicationsSourceSchema>;
const sourceState=z.object({contactId:z.string().uuid(),recipient:z.string().email(),subject:z.string().min(1),body:z.string().min(1),contextDigest:z.string().regex(/^[a-f0-9]{64}$/),requiredSince:z.iso.datetime(),replyParent:z.object({id:z.string().min(1).max(300),contentDigest:z.string().regex(/^[a-f0-9]{64}$/)}).strict().nullable().optional()}).strict();
/** Runs inside the existing communications admission transaction and org gate.
 * The bounded definer checks current native authority, original account, fences,
 * exact review/grant, three budgets, history, sending policy and all holds. */
export async function readAgentCommunicationsSource(client:Pick<SqlClient,'query'>,raw:unknown,bindingId:string){
 const source=agentCommunicationsSourceSchema.parse(raw);if(source.effect)throw Error('An invitation requires its exact recorded channel');
 const result=await client.query('SELECT public.agent_communications_source($1::uuid,$2::uuid,$3::bigint,$4::bigint,$5::uuid) AS source',[source.operationId,source.conversationId,source.epoch,source.fence,bindingId]);
 if(result.rows.length!==1)throw Error('Send authority unavailable');
 const proof=sourceState.parse(result.rows[0].source);
 // PostgreSQL JSON emits microseconds; the pg timestamptz row decoder and
 // immutable intent reader use millisecond ISO. Seal the same representation
 // that is later read back, retaining the original coverage instant.
 return {...proof,requiredSince:new Date(proof.requiredSince).toISOString()};
}
const coverageRoute=z.object({bindingId:z.string().uuid(),channel:z.enum(['email','whatsapp','linkedin']),recipient:z.object({kind:z.enum(['email','phone','linkedin_profile']),value:z.string()}).strict()}).strict();
const channelSourceState=z.object({effect:z.literal('invitation').optional(),contactId:z.string().uuid(),routeId:z.string().uuid(),channel:z.enum(['email','whatsapp','linkedin']),recipient:z.object({kind:z.enum(['email','phone','linkedin_profile']),value:z.string()}).strict(),subject:z.string().max(300),body:z.string().min(1).max(6000),contextDigest:z.string().regex(/^[a-f0-9]{64}$/),requiredSince:z.iso.datetime(),replyParent:z.object({id:z.string().min(1).max(2048),contentDigest:z.string().regex(/^[a-f0-9]{64}$/)}).strict().nullable(),conversation:z.object({id:z.string().min(1).max(2048)}).strict().nullable().optional(),coverageRoutes:z.array(coverageRoute).min(1).max(3)}).strict().superRefine((v,c)=>{
 if(v.effect==='invitation'&&(v.channel!=='linkedin'||v.subject!==''||v.body.length>300||v.replyParent!==null||v.conversation!=null))c.addIssue({code:'custom',message:'Invitation requires an exact LinkedIn profile, bounded note and no message thread'});
 if(!agentPersonChannelRecipientSchema.safeParse({channel:v.channel,recipient:v.recipient}).success)c.addIssue({code:'custom',path:['recipient'],message:'Exact recorded channel recipient required'});
 if(v.channel!=='email'&&v.subject!=='')c.addIssue({code:'custom',path:['subject'],message:'Social messages have no subject'});
 if(v.channel==='email'&&!v.subject.trim())c.addIssue({code:'custom',path:['subject'],message:'Email subject required'});
 if(v.channel!=='email'&&v.replyParent!==null)c.addIssue({code:'custom',path:['replyParent'],message:'Social messages use their verified provider conversation'});
 if(new Set(v.coverageRoutes.map(r=>r.channel)).size!==v.coverageRoutes.length||new Set(v.coverageRoutes.map(r=>r.bindingId)).size!==v.coverageRoutes.length||v.coverageRoutes.some(r=>!agentPersonChannelRecipientSchema.safeParse({channel:r.channel,recipient:r.recipient}).success))c.addIssue({code:'custom',path:['coverageRoutes'],message:'Exact unique verified account coverage required'});
 if(v.channel==='email'&&v.conversation!=null)c.addIssue({code:'custom',path:['conversation'],message:'Email uses its verified provider message parent'});
});
/** The SQL operation selects its immutable route. No failure is interpreted as
 * permission to fall back to the legacy email account or another channel. */
export async function readAgentCommunicationsSourceKind(client:Pick<SqlClient,'query'>,raw:unknown,bindingId:string){
 const s=agentCommunicationsSourceSchema.parse(raw);z.string().uuid().parse(bindingId);
 const result=await client.query('SELECT public.agent_communications_source_kind($1::uuid,$2::uuid,$3::bigint,$4::bigint,$5::uuid) AS kind',[s.operationId,s.conversationId,s.epoch,s.fence,bindingId]);
 return z.enum(['legacy_email','recorded_channel']).parse(result.rows.length===1?result.rows[0].kind:undefined);
}
export async function readAgentChannelCommunicationsSource(client:Pick<SqlClient,'query'>,raw:unknown,bindingId:string){
 const s=agentCommunicationsSourceSchema.parse(raw);z.string().uuid().parse(bindingId);
 const result=await client.query('SELECT public.agent_channel_communications_source($1::uuid,$2::uuid,$3::bigint,$4::bigint,$5::uuid) AS source',[s.operationId,s.conversationId,s.epoch,s.fence,bindingId]);
 const proof=channelSourceState.parse(result.rows.length===1?result.rows[0].source:undefined);
 if(s.effect!==proof.effect)throw Error('Original operation effect differs from its trusted source');
 if(!proof.coverageRoutes.some(r=>r.bindingId===bindingId&&r.channel===proof.channel&&r.recipient.kind===proof.recipient.kind&&r.recipient.value===proof.recipient.value))throw Error('Selected original account differs from recorded coverage');
 return {...proof,requiredSince:new Date(proof.requiredSince).toISOString()};
}
