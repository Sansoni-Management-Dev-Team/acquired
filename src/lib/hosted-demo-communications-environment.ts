import{z}from'zod';
import{isIP}from'node:net';
const identity=z.string().min(1).max(200).refine(v=>v===v.trim()&&!/[\u0000-\u001f\u007f]/.test(v));
const origin=z.string().max(2048).refine(value=>{try{const u=new URL(value),hostname=u.hostname.toLowerCase();return u.protocol==='https:'&&u.origin===value&&!u.username&&!u.password&&!u.port&&!u.search&&!u.hash&&!isIP(hostname)&&!hostname.startsWith('[')&&hostname.includes('.')&&!['localhost','local','internal','test'].some(s=>hostname===s||hostname.endsWith('.'+s))&&!hostname.endsWith('.');}catch{return false;}},'Explicit public HTTPS origin required');
const binding=z.object({applicationId:z.literal('acquire'),tenantId:identity,ownerId:identity,connectionId:identity,accountId:identity,generation:z.number().int().positive().safe(),channel:z.enum(['email','whatsapp','linkedin']),platform:z.enum(['gmail','outlook','imap','whatsapp','linkedin']),backend:z.literal('unipile')}).strict().refine(v=>v.channel==='email'?['gmail','outlook','imap'].includes(v.platform):v.channel===v.platform);
const schema=z.object({version:z.literal(1),mode:z.literal('hosted-demo'),phase:z.enum(['provisioning','active']).default('active'),runId:z.string().regex(/^hosted-demo-[a-z0-9][a-z0-9-]{0,35}$/),integrationId:identity,configurationReference:identity,applicationOrigin:origin,serviceOrigin:origin,setupOrigin:origin,actor:z.object({applicationId:z.literal('acquire'),tenantId:identity,ownerId:identity}).strict(),capabilities:z.object({dynamicRecipients:z.boolean(),recipientContextLookup:z.literal(true),remoteApplicationAuthority:z.literal(true),durableEvents:z.literal(true)}).strict(),bindings:z.array(binding).max(1000)}).strict().superRefine((v,c)=>{
 if(v.phase==='active'&&v.bindings.length===0)c.addIssue({code:'custom',message:'Active hosted run requires exact original bindings'});
 if(v.integrationId!=='sim-'+v.runId||v.configurationReference!==v.integrationId+'-v1')c.addIssue({code:'custom',message:'Exact hosted run configuration required'});
 if(v.bindings.some(b=>b.tenantId!==v.actor.tenantId||b.ownerId!==v.actor.ownerId)||new Set(v.bindings.map(b=>JSON.stringify([b.connectionId,b.generation]))).size!==v.bindings.length)c.addIssue({code:'custom',message:'Unique original owned binding generations required'});
});
export type HostedDemoCommunicationsDescriptor=z.infer<typeof schema>;
/** Private server configuration; no provider credential, database URL, local
 * simulator override or browser-selected endpoint is accepted here. DNS/network
 * ownership is an operational attestation, not established by parsing a URL. */
export function readHostedDemoCommunicationsDescriptor(env:Record<string,string|undefined>,actor?:{organizationId:string;userId:string}){
 try{
  if(env.NODE_ENV!=='production'||env.AGENT_HOSTED_DEMO_COMMUNICATIONS_ENABLED!=='true')throw Error();
  const descriptor=schema.parse(JSON.parse(env.AGENT_HOSTED_DEMO_COMMUNICATIONS_DESCRIPTOR_JSON??'null'));
  if(descriptor.applicationOrigin!==env.APP_URL||actor&&(actor.organizationId!==descriptor.actor.tenantId||actor.userId!==descriptor.actor.ownerId))throw Error();
  return descriptor;
 }catch{throw Error('Hosted demo communications unavailable');}
}
