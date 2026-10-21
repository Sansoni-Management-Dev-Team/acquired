import {z} from 'zod';
import {companyDiscoveryPolicySchema} from './research-discovery-policy';
import {firmableDomain} from './firmable-company-pipeline';
import type {HybridCompany} from './hybrid-company-pipeline';

const key=z.string().max(300).regex(/^(?:firmable:f\d+|domain:[a-z0-9.-]+)$/);
const keys=z.array(key).min(1).max(800).refine(values=>new Set(values).size===values.length,'Unique saved candidate identities required');
/** Review metadata only. Provider source rows are loaded and checked server-side. */
export const hybridCompanyContinuationSchema=z.object({version:z.literal(1),sourceRootId:z.string().uuid(),sourceDigest:z.string().regex(/^[a-f0-9]{64}$/),candidateKeys:keys}).strict();
export type HybridCompanyContinuationReview=z.infer<typeof hybridCompanyContinuationSchema>;
export type HybridCompanyContinuation={version:1;sourceRootId:string;sourceDigest:string;candidates:HybridCompany[]};
export type HybridCompanyContinuationSource=HybridCompanyContinuation;

const domain=z.string().max(253).refine(value=>value===''||value===firmableDomain(value)&&/^[a-z0-9.-]+$/.test(value)&&value.includes('.'));
const sources=z.array(z.enum(['firmable','web'])).min(1).max(2).refine(values=>new Set(values).size===values.length);
const row=z.record(z.string(),z.unknown());
const webRow=z.object({domain:domain.refine(Boolean),name:z.string().min(1).max(300),website:z.string().max(2048),discovery:z.object({url:z.string().max(2048),title:z.string().max(300),snippet:z.string().max(1200)}).strict()}).strict().superRefine((value,ctx)=>{
 if(value.website!==`https://${value.domain}`||firmableDomain(value.discovery.url)!==value.domain)ctx.addIssue({code:'custom',message:'Original web identity required'});
});
const selection=z.array(z.object({candidateKey:key,domain,firmableId:z.string().max(64).regex(/^f\d+$/).nullable(),sources,outcome:z.enum(['saved','review','skipped','known_failed','interrupted','not_started'])}).strict()).max(800);
const sourceSchema=z.object({sourceRootId:z.string().uuid(),status:z.literal('partial'),config:z.object({
 pipelineDesign:z.literal('hybrid-firmable-v1'),researchRunId:z.string().uuid(),companyIdentityPolicyVersion:z.literal(1),companyDiscoveryPolicy:companyDiscoveryPolicySchema,
 companyOnly:z.literal(true),includeCompanyPeople:z.literal(false),includePhones:z.literal(false),findPeople:z.literal(false),
 firmableSearchPages:z.record(z.string().regex(/^(?:0|100)$/),z.object({records:z.array(row).max(100)}).passthrough()).optional(),
 webSearchPages:z.record(z.string().regex(/^[0-5]$/),z.object({rows:z.array(webRow).max(100),ok:z.boolean()}).passthrough()).optional(),
 hybridResult:z.object({discoveryPolicy:companyDiscoveryPolicySchema,selection}).passthrough(),
}).passthrough()}).strict();

/** Stable bounded JSON, independent of database/JavaScript object key order.
 * Reject unsupported/cyclic or oversized evidence rather than hashing a prefix. */
function canonicalSnapshot(value:unknown):string{
 const chunks:string[]=[],active=new Set<object>();let bytes=0,nodes=0;
 const append=(text:string)=>{bytes+=new TextEncoder().encode(text).byteLength;if(bytes>4*1024*1024)throw Error('Saved continuation evidence exceeds its bounded snapshot');chunks.push(text);};
 const visit=(item:unknown,depth:number)=>{
  if(depth>32||++nodes>100000)throw Error('Saved continuation evidence exceeds its bounded snapshot');
  if(item===null||typeof item==='boolean'||typeof item==='string'||typeof item==='number'&&Number.isFinite(item)){append(JSON.stringify(item));return;}
  if(typeof item!=='object'||active.has(item))throw Error('Saved continuation evidence is not JSON');active.add(item);
  if(Array.isArray(item)){append('[');item.forEach((entry,i)=>{if(i)append(',');visit(entry,depth+1);});append(']');}
  else{if(Object.getPrototypeOf(item)!==Object.prototype&&Object.getPrototypeOf(item)!==null)throw Error('Saved continuation evidence is not JSON');append('{');Object.keys(item).sort().forEach((name,i)=>{if(i)append(',');append(JSON.stringify(name));append(':');visit((item as Record<string,unknown>)[name],depth+1);});append('}');}
  active.delete(item);
 };visit(value,0);return chunks.join('');
}
function candidateIdentity(company:HybridCompany){
 if(!company.candidateKey)throw Error('Original saved candidate identity required');
 if(company.firmableRow){if(company.candidateKey!==`firmable:${company.firmableRow.id}`||!/^f\d+$/.test(String(company.firmableRow.id))||!company.sources.includes('firmable')||firmableDomain(company.firmableRow.website||company.firmableRow.fqdn)!==company.domain)throw Error('Original saved Firmable identity required');}
 else if(company.candidateKey!==`domain:${company.domain}`||!company.domain||company.sources.includes('firmable')||!company.sources.includes('web'))throw Error('Original saved web identity required');
 if(company.sources.includes('web')?(!company.webRow||company.webRow.domain!==company.domain):Boolean(company.webRow))throw Error('Original saved web observation required');
}
/** Validation of server-materialized execution values is separate from client
 * review metadata. This does not replace current source/receipt authority checks. */
export function validateHybridCompanyContinuation(raw:unknown):HybridCompanyContinuation{
 const input=z.object({version:z.literal(1),sourceRootId:z.string().uuid(),sourceDigest:z.string().regex(/^[a-f0-9]{64}$/),candidates:z.array(z.object({candidateKey:key,domain,sources,firmableRow:row.optional(),webRow:webRow.optional()}).strict()).min(1).max(800)}).strict().parse(raw);
 const seen=new Set<string>();for(const company of input.candidates){candidateIdentity(company);if(seen.has(company.candidateKey))throw Error('Duplicate saved candidate identity');seen.add(company.candidateKey);}
 canonicalSnapshot(input);return input;
}
/** Pure source selection: absence of a child/receipt is never eligibility. Only
 * explicit not_started entries in the saved manifest may become fresh work. */
export async function buildHybridCompanyContinuationSource(raw:unknown):Promise<HybridCompanyContinuationSource>{
 const source=sourceSchema.parse(raw),config=source.config;
 if(Object.hasOwn(config,'companyContinuation'))throw Error('Continuation of a continuation is not supported; review a fresh research scope instead');
 if(config.researchRunId!==source.sourceRootId||config.companyDiscoveryPolicy.version!==4||config.hybridResult.discoveryPolicy.version!==4||canonicalSnapshot(config.companyDiscoveryPolicy)!==canonicalSnapshot(config.hybridResult.discoveryPolicy))throw Error('Original V4 company-only source required');
 const firmablePages=config.firmableSearchPages??{},webPages=config.webSearchPages??{},manifest=config.hybridResult.selection;
 const seen=new Set<string>();for(const item of manifest){if(seen.has(item.candidateKey))throw Error('Duplicate saved candidate identity');seen.add(item.candidateKey);}
 const firms=new Map<string,Record<string,unknown>>();for(const page of Object.values(firmablePages))for(const company of page.records){const id=String(company.id??'');if(!/^f\d+$/.test(id))continue;const prior=firms.get(id);if(prior&&canonicalSnapshot(prior)!==canonicalSnapshot(company))throw Error('Conflicting saved Firmable source rows');if(!prior)firms.set(id,company);}
 // Reproduce the original producer's round-robin observation order.
 const pages=Object.entries(webPages).sort(([a],[b])=>Number(a)-Number(b)).map(([,page])=>page.rows),web=new Map<string,z.infer<typeof webRow>>();
 for(let round=0;round<Math.max(0,...pages.map(page=>page.length));round++)for(const page of pages){const company=page[round];if(company&&!web.has(company.domain))web.set(company.domain,company);}
 const candidates:HybridCompany[]=manifest.filter(item=>item.outcome==='not_started').map(item=>{
  const company:HybridCompany={candidateKey:item.candidateKey,domain:item.domain,sources:[...item.sources].sort(),...(item.firmableId?{firmableRow:firms.get(item.firmableId)}:{}),...(item.sources.includes('web')?{webRow:web.get(item.domain)}:{})};
  if(item.firmableId&&item.candidateKey!==`firmable:${item.firmableId}`||!item.firmableId&&!item.candidateKey.startsWith('domain:'))throw Error('Saved candidate key differs from original identity');candidateIdentity(company);return company;
 });
 if(!candidates.length)throw Error('No explicit never-started company candidates remain');
 const snapshot={version:1,sourceRootId:source.sourceRootId,status:source.status,companyDiscoveryPolicy:config.companyDiscoveryPolicy,companyIdentityPolicyVersion:config.companyIdentityPolicyVersion,companyOnly:config.companyOnly,includeCompanyPeople:config.includeCompanyPeople,includePhones:config.includePhones,findPeople:config.findPeople,selection:manifest,firmableSearchPages:firmablePages,webSearchPages:webPages};
 const serialized=canonicalSnapshot(snapshot),hash=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(serialized)),sourceDigest=Array.from(new Uint8Array(hash),byte=>byte.toString(16).padStart(2,'0')).join('');
 return validateHybridCompanyContinuation({version:1,sourceRootId:source.sourceRootId,sourceDigest,candidates});
}
export function selectHybridCompanyContinuation(source:HybridCompanyContinuationSource,raw:unknown):HybridCompanyContinuation{
 const review=hybridCompanyContinuationSchema.parse(raw);if(review.sourceRootId!==source.sourceRootId||review.sourceDigest!==source.sourceDigest)throw Error('Saved company continuation source changed; review again');
 const selected=new Set(review.candidateKeys),candidates=source.candidates.filter(company=>selected.has(company.candidateKey!));if(candidates.length!==selected.size)throw Error('Only explicit never-started saved candidates can continue');
 return validateHybridCompanyContinuation({...source,candidates});
}
