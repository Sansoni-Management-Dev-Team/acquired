import {lookup as dnsLookup} from 'node:dns/promises';
import {isIP} from 'node:net';
import {publicResearchUrl} from '@/domain/research';
import {abnChecksum,normaliseAbnName,type AbnCandidate} from '@/domain/abn-public-lookup.mjs';
import {abnAliases,abnSearchAliases,visibleHtml,websiteIdentity,resolveAbnIdentity,type IdentityPage,type AbnRecord} from '@/domain/abn-resolution.mjs';
import {publicAbnLookup,publicAbnRecord,type PublicAbnLookupResult} from './abn-public-lookup';
const compact=(value:string)=>normaliseAbnName(value).replaceAll(' ','');
function publicIp(ip:string){if(isIP(ip)===4){const [a,b]=ip.split('.').map(Number);return !(a===0||a===10||a===127||a>=224||a===169&&b===254||a===172&&b>=16&&b<=31||a===192&&b===168||a===100&&b>=64&&b<=127);}return isIP(ip)===6&&/^[23]/.test(ip);}
let activeWebsiteReads=0;const websiteWaiters:Array<()=>void>=[];
export async function readIdentityWebsite(url:string,deadline=Infinity):Promise<{url:string;html:string}>{
 if(activeWebsiteReads>=4)await new Promise<void>(r=>websiteWaiters.push(r));else activeWebsiteReads++;
 try{const readDeadline=Math.min(deadline,Date.now()+8000);for(let redirects=0;redirects<=3;redirects++){
   if(Date.now()>=readDeadline)throw Error('Identity website deadline reached');const safe=publicResearchUrl(url);if(!safe)throw Error('Unsupported identity website URL');
   const addresses=await dnsLookup(new URL(safe).hostname,{all:true});if(!addresses.length||addresses.some(a=>!publicIp(a.address)))throw Error('Non-public identity website address');
   const r=await fetch(safe,{redirect:'manual',signal:AbortSignal.timeout(Math.max(1,readDeadline-Date.now()))});
   if(r.status>=300&&r.status<400){const next=r.headers.get('location');await r.body?.cancel();if(!next)throw Error('Missing website redirect');const destination=new URL(next,safe);if(destination.hostname.replace(/^www\./,'')!==new URL(safe).hostname.replace(/^www\./,''))throw Error('Identity website redirected to a different domain');if(destination.protocol==='http:')destination.protocol='https:';url=destination.href;continue;}
   if(!r.ok)throw Error(`Identity website HTTP ${r.status}`);if(!/text\/html/i.test(r.headers.get('content-type')||''))throw Error('Identity website is not HTML');
   const reader=r.body?.getReader();if(!reader)throw Error('Empty website body');let bytes=0;const chunks:Uint8Array[]=[];for(;;){const item=await reader.read();if(item.done)break;bytes+=item.value.length;if(bytes>1500000){await reader.cancel();throw Error('Identity website exceeds read limit');}chunks.push(item.value);}return{url:safe,html:Buffer.concat(chunks).toString('utf8')};
  }throw Error('Too many website redirects');
 }finally{const next=websiteWaiters.shift();if(next)next();else activeWebsiteReads--;}
}
export function identityLinks(html:string,base:string){const urls:string[]=[];for(const m of html.matchAll(/<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>[\s\S]*?<\/a>/gi)){try{const u=new URL(m[1].replaceAll('&amp;','&'),base);if(u.hostname.replace(/^www\./,'')!==new URL(base).hostname.replace(/^www\./,'')||!/(?:privacy|terms|polic|legal|contact|about)/i.test(u.pathname))continue;const safe=publicResearchUrl(u.href);if(safe&&!urls.includes(safe))urls.push(safe);}catch{}}
 return urls.sort((a,b)=>Number(/contact/i.test(a))-Number(/contact/i.test(b))).slice(0,3);
}
export function createAbnIdentityResolver(deps:{search:(name:string,deadline?:number)=>Promise<PublicAbnLookupResult>;record:(abn:string,deadline?:number)=>Promise<AbnRecord>;website:(url:string,deadline?:number)=>Promise<{url:string;html:string}>}){
 return async(input:{name:string;website:string;deadline?:number;explicitAbns?:{abn:string;sourcePath:string}[];firmableProfileUrl?:string;prior?:{websitePages:IdentityPage[];records:AbnRecord[]}})=>{
  const started=Date.now(),deadline=Math.min(input.deadline??Infinity,started+45000),errors:Array<{operation:string;message:string}>=[],pages:IdentityPage[]=[...(input.prior?.websitePages||[])],searches:Array<PublicAbnLookupResult & {query:string}>=[],records:AbnRecord[]=[...(input.prior?.records||[])];
  const error=(operation:string,e:unknown)=>errors.push({operation,message:e instanceof Error?e.message:'Request failed'});
  const safeWebsite=publicResearchUrl(input.website.replace(/^http:/,'https:'));if(!safeWebsite)throw Error('Invalid company website');const website:string=safeWebsite;
  const fresh=new Map<string,AbnRecord>(),requested=new Map<string,Promise<AbnRecord>>();
  async function readRecord(abn:string){const pending=requested.get(abn);if(pending)return pending;const promise=deps.record(abn,deadline).then(record=>{fresh.set(abn,record);const index=records.findIndex(r=>r.abn===abn);if(index>=0)records[index]=record;else records.push(record);return record;});requested.set(abn,promise);return promise;}
  const namesForIdentity=[...abnAliases(input.name),input.name.replace(/\s+(?:AU|Australia)$/i,'')].map(compact);
  const explicit=[...new Map((input.explicitAbns||[]).filter(c=>abnChecksum(c.abn)).map(c=>[c.abn,c])).values()].slice(0,3);
  const firmableCandidates=await Promise.all(explicit.map(async c=>{if(Date.now()>=deadline)return{...c,record:null,identityAccepted:false};try{const record=await readRecord(c.abn);return{...c,record,identityAccepted:record.active&&[record.entityName,...record.names].some(n=>namesForIdentity.includes(compact(n)))};}catch(e){error('record',e);return{...c,record:null,identityAccepted:false};}}));
  const supported=firmableCandidates.filter(c=>c.identityAccepted&&c.record),conflicts:Array<{firmableAbns:string[];websiteAbn:string|null;reason:string}>=[];
  const build=(resolved:ReturnType<typeof resolveAbnIdentity>,resolutionSource:string)=>({...resolved,resolutionSource,firmableCandidates,conflicts,aliases:searches.map(s=>s.query),searches,records,websitePages:pages,errors,elapsedMs:Date.now()-started,cache:{websitePagesReused:input.prior?.websitePages?.length||0,recordsReused:records.filter(r=>!fresh.has(r.abn)).length},limits:{maxAliases:5,maxRecords:8,maxWebsitePages:4,deadlineMs:45000}});
  async function websiteResult(){const abns=websiteIdentity(pages).abns;await Promise.all(abns.slice(0,8).map(async abn=>{if(fresh.has(abn)||Date.now()>=deadline)return;try{await readRecord(abn);}catch(e){error('record',e);}}));for(let attempt=0;attempt<8;attempt++){const resolved=resolveAbnIdentity({name:input.name,website,pages,records});if(!resolved.abn)return null;if(fresh.has(resolved.abn))return resolved;try{await readRecord(resolved.abn);}catch(e){error('record',e);return null;}}return null;}
  const cached=pages.length?await websiteResult():null;
  if(cached){if(supported.some(c=>c.abn!==cached.abn)){conflicts.push({firmableAbns:supported.map(c=>c.abn),websiteAbn:cached.abn,reason:'Provider registered identity and website legal entity differ'});return build({...cached,status:'conflict',abn:null,record:null,evidence:[],scope:'multiple_legal_entities'},'conflict');}return build(cached,supported.length?'firmable_registry_and_website':'website_registry');}
  if(supported.length===1&&resolveAbnIdentity({name:input.name,website,pages,records}).status!=='ambiguous'){const c=supported[0];return build({status:'matched',abn:c.abn,record:c.record,evidence:[{sourceUrl:input.firmableProfileUrl||website,kind:'firmable_reported_identifier',quote:`${c.sourcePath}: ${c.abn}`}],candidates:[{record:c.record!,score:80,evidence:[]}],scope:'provider_registered_entity',queryName:input.name},'firmable_registry');}
  if(!pages.length){
  try{if(Date.now()>=deadline)throw Error('Identity resolution deadline reached');const home=await deps.website(website,deadline);pages.push({url:home.url,text:visibleHtml(home.html)});await Promise.all(identityLinks(home.html,home.url).map(async url=>{if(Date.now()>=deadline)return;try{const page=await deps.website(url,deadline);pages.push({url:page.url,text:visibleHtml(page.html)});}catch(e){error('website',e);}}));}catch(e){error('website',e);}}
  const direct=await websiteResult();if(direct){if(supported.some(c=>c.abn!==direct.abn)){conflicts.push({firmableAbns:supported.map(c=>c.abn),websiteAbn:direct.abn,reason:'Provider registered identity and website legal entity differ'});return build({...direct,status:'conflict',abn:null,record:null,evidence:[],scope:'multiple_legal_entities'},'conflict');}return build(direct,'website_registry');}
  const identity=websiteIdentity(pages);
  const aliases=abnSearchAliases(input.name,website,[...identity.ownerNames,...identity.legalNames]);
  await Promise.all(aliases.map(async query=>{if(Date.now()>=deadline)return;try{searches.push({...await deps.search(query,deadline),query});}catch(e){error('search',e);}}));
  const candidates=new Map<string,{abn:string;rank:number;searchCandidate?:AbnCandidate}>();for(const abn of identity.abns)candidates.set(abn,{abn,rank:200});
  for(const search of searches)for(const c of search.candidates){if(!c.active)continue;const key=compact(c.name);const rank=aliases.some(n=>compact(n)===key)?100:aliases.some(n=>key.length>=8&&compact(n).length>=8&&(key.includes(compact(n))||compact(n).includes(key)))?20:0;if(rank>0&&rank>(candidates.get(c.abn)?.rank||0))candidates.set(c.abn,{abn:c.abn,rank,searchCandidate:c});}
  await Promise.all([...candidates.values()].sort((a,b)=>b.rank-a.rank).slice(0,8).map(async c=>{if(Date.now()>=deadline)return;try{await readRecord(c.abn);}catch(e){error('record',e);}}));
  let resolved=resolveAbnIdentity({name:input.name,website,pages,records});
  if(resolved.abn&&!fresh.has(resolved.abn)){try{await readRecord(resolved.abn);resolved=resolveAbnIdentity({name:input.name,website,pages,records});}catch(e){error('record',e);return build({...resolved,status:'request_failed',abn:null,record:null,evidence:[]},'website_registry');}}
  const status=resolved.abn?'matched':Date.now()>=deadline?'deadline':!records.length&&errors.some(e=>e.operation==='search'||e.operation==='record')?'request_failed':resolved.status;
  if(supported.length>1&&!resolved.abn){conflicts.push({firmableAbns:supported.map(c=>c.abn),websiteAbn:null,reason:'Multiple provider identifiers satisfy registered identity'});return build({...resolved,status:'ambiguous'},'conflict');}
  if(resolved.abn&&supported.some(c=>c.abn!==resolved.abn)){conflicts.push({firmableAbns:supported.map(c=>c.abn),websiteAbn:resolved.abn,reason:'Provider registered identity and website legal entity differ'});return build({...resolved,status:'conflict',abn:null,record:null,evidence:[],scope:'multiple_legal_entities'},'conflict');}
  return{...build({...resolved,status},'website_registry'),aliases};
 };
}
export const resolvePublicCompanyAbn=createAbnIdentityResolver({search:publicAbnLookup,record:publicAbnRecord,website:readIdentityWebsite});
