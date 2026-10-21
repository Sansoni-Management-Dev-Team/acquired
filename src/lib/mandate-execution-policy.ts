import{createHash}from'node:crypto';
import{mandateExecutionContextSchema,type MandateExecutionContext}from'../domain/mandate-execution-context';
function canonical(value:unknown):unknown{if(Array.isArray(value))return value.map(canonical);if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).sort(([a],[b])=>a<b?-1:a>b?1:0).map(([k,v])=>[k,canonical(v)]));return value;}
export function executionContextDigest(value:unknown){return createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');}
/** NEW effect only. This helper is never used by original lookup/reconciliation. */
export function assertNewEffectPermitted(context:MandateExecutionContext,wanted:{bindingId:string;bindingDigest:string;generation:number;channel:'email'|'whatsapp'|'linkedin';recipient:string}){
 const c=mandateExecutionContextSchema.parse(context),{manifestDigest,...preimage}=c;if(executionContextDigest(preimage)!==manifestDigest)throw Error('Mandate execution context proof differs');const binding=c.allowedBindings.find(b=>b.id===wanted.bindingId&&b.digest===wanted.bindingDigest&&b.generation===wanted.generation&&b.channel===wanted.channel);
 if(!binding||c.contact.effectiveRecipients[wanted.channel]!==wanted.recipient)throw Error('Current mandate recipient and sender proof required');
}
