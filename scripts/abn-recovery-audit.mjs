/** Read-only local ABN recovery audit. Run: node scripts/abn-recovery-audit.mjs --run <research-root-id>
 * No database updates, migrations, paid model calls or personal/contact lookups.
 * All newly recovered matches require review; proposed matches are not verified facts. */
import pg from 'pg';
import {mkdirSync,writeFileSync,existsSync,readFileSync} from 'node:fs';
import {lookup} from 'node:dns/promises';
import {isIP} from 'node:net';
import {LOCAL_DATABASE_URL} from './dev-config.mjs';
import {abnChecksum,parseAbnSearch,normaliseAbnName} from '../src/domain/abn-public-lookup.mjs';
import {parseAbnRecord,visibleHtml,websiteIdentity} from '../src/domain/abn-resolution.mjs';
import {auditAliases,assessAbnCandidates} from './abn-recovery-audit-lib.mjs';
const args=process.argv.slice(2),option=(key, fallback)=>{const i=args.indexOf(key);return i<0?fallback:args[i+1];};
const run=option('--run',null),concurrency=Number(option('--concurrency','4'));
if(!run||!Number.isInteger(concurrency)||concurrency<1||concurrency>8)throw Error('Use --run ROOT_UUID [--concurrency 1..8]');
const webSearch=args.includes('--web-search'),legalSearch=args.includes('--legal-search');
const searchEngine=option('--search-engine','duckduckgo');if(!['duckduckgo','google'].includes(searchEngine))throw Error('Unsupported search engine');
const output=option('--out',`.local-data/abn-recovery-${run}`);mkdirSync(output,{recursive:true,mode:0o700});
const db=new pg.Client({connectionString:LOCAL_DATABASE_URL});await db.connect();await db.query('SET default_transaction_read_only=on');
const root=(await db.query('select mandate_id,created_at from research_jobs where id=$1',[run])).rows[0];if(!root)throw Error('Local research root not found');
const rows=(await db.query(`select id,config->>'companyName' name,config->>'companyDomain' domain,config->>'firmableMatch' provider_match,config->'abnLookup' original,config->>'targetId' target_id from research_jobs where config->>'parentJobId'=$1 and config ? 'abnLookup' order by created_at`,[run])).rows;await db.end();
writeFileSync(`${output}/input.json`,JSON.stringify({run,root,rows},null,2),{mode:0o600});
let nextRegistry=0,requests=0;const registryCache=new Map();const sleep=ms=>new Promise(r=>setTimeout(r,ms));
function limiter(max){let active=0;const waiting=[];return async fn=>{if(active>=max)await new Promise(r=>waiting.push(r));else active++;try{return await fn();}finally{const next=waiting.shift();if(next)next();else active--;}};}
const registryLimit=limiter(2),websiteLimit=limiter(4);
async function registry(url){if(registryCache.has(url))return registryCache.get(url);const promise=registryLimit(async()=>{const start=Math.max(nextRegistry,Date.now());nextRegistry=start+500;await sleep(Math.max(0,start-Date.now()));requests++;const r=await fetch(url,{signal:AbortSignal.timeout(12000),redirect:'error'});if(r.status===429){nextRegistry=Math.max(nextRegistry,Date.now()+Math.max(30000,Number(r.headers.get('retry-after')||0)*1000));throw Error('ABR HTTP 429; cooldown applied');}if(!r.ok)throw Error(`ABR HTTP ${r.status}`);return await r.text();});registryCache.set(url,promise);return promise;}
async function record(abn){return parseAbnRecord(await registry(`https://abr.business.gov.au/ABN/View?abn=${abn}`),abn);}
const publicIp=ip=>{if(isIP(ip)===6)return /^[23]/.test(ip);const[a,b]=ip.split('.').map(Number);return isIP(ip)===4&&!(a===0||a===10||a===127||a>=224||a===169&&b===254||a===172&&b>=16&&b<=31||a===192&&b===168||a===100&&b>=64&&b<=127);};
const website=(url,domain)=>websiteLimit(()=>readWebsite(url,domain));
async function readWebsite(url,domain){for(let i=0;i<4;i++){const u=new URL(url);if(u.protocol!=='https:'||u.username||u.password||u.hostname.replace(/^www\./,'')!==domain.replace(/^www\./,''))throw Error('Cross-domain or unsupported website URL');const addresses=await lookup(u.hostname,{all:true});if(!addresses.length||addresses.some(a=>!publicIp(a.address)))throw Error('Non-public website');requests++;const r=await fetch(u,{redirect:'manual',signal:AbortSignal.timeout(12000)});if(r.status>=300&&r.status<400){const location=r.headers.get('location');await r.body?.cancel();if(!location)throw Error('Redirect lacks destination');url=new URL(location,u).href.replace(/^http:/,'https:');continue;}if(!r.ok)throw Error(`Website HTTP ${r.status}`);if(!/text\/html/i.test(r.headers.get('content-type')||''))throw Error('Website not HTML');const reader=r.body.getReader();let bytes=0;const chunks=[];for(;;){const {done,value}=await reader.read();if(done)break;bytes+=value.length;if(bytes>3000000){await reader.cancel();throw Error('Website exceeds 3MB');}chunks.push(value);}return {url:u.href,html:Buffer.concat(chunks).toString('utf8')};}throw Error('Too many redirects');}
const results=[];let completed=0;
function report(){const missing=results.filter(r=>!r.baselineAbn),corroborated=missing.filter(r=>r.assessment.status==='corroborated'),proposed=missing.filter(r=>r.assessment.status==='proposed');const summary={run,totalCompanies:rows.length,processed:results.length,baselineVerified:rows.filter(r=>r.original.abn).length,newCorroborated:corroborated.length,newProposed:proposed.length,existingEvidenceMatchingMisses:missing.filter(r=>r.replay.match).length,existingEvidenceCorroboratedMisses:missing.filter(r=>r.replay.status==='corroborated').length,confirmedMatchingMisses:corroborated.filter(r=>r.replay.status==='corroborated'&&r.replay.match?.abn===r.assessment.match?.abn).length,remainingAmbiguous:missing.filter(r=>r.assessment.status==='ambiguous').length,remainingUnresolved:missing.filter(r=>r.assessment.status==='unresolved').length,recoveryReasons:Object.fromEntries([...new Set(corroborated.map(r=>r.assessment.match.reason))].map(reason=>[reason,corroborated.filter(r=>r.assessment.match.reason===reason).length])),rejectedProviderOutcomes:Object.fromEntries(['corroborated','proposed','ambiguous','unresolved'].map(status=>[status,missing.filter(r=>r.providerAbns.length&&r.assessment.status===status).length])),rejectedProviderRestored:corroborated.filter(r=>r.providerAbns.includes(r.assessment.match.abn)).length,rejectedProviderReplaced:corroborated.filter(r=>r.providerAbns.length&&!r.providerAbns.includes(r.assessment.match.abn)).length,corroboratedGovernmentEntities:corroborated.filter(r=>r.company.domain.endsWith('.gov.au')).length,providerCandidatesRejected:rows.filter(r=>!r.original.abn&&r.original.firmableCandidates?.length).length,requestCount:requests,elapsedSeconds:Math.round((Date.now()-started)/1000),databaseModified:false};writeFileSync(`${output}/report.json`,JSON.stringify({summary,results},null,2),{mode:0o600});writeFileSync(`${output}/recovered.json`,JSON.stringify([...corroborated,...proposed].map(r=>({company:r.company.name,domain:r.company.domain,...r.assessment.match,oldStatus:r.originalStatus,existingEvidenceMiss:Boolean(r.replay.match),reviewRequired:true,screeningWarning:r.company.domain.endsWith('.gov.au')?'government_entity':null})),null,2),{mode:0o600});writeFileSync(`${output}/matching-misses.json`,JSON.stringify(missing.filter(r=>r.replay.match).map(r=>({company:r.company.name,domain:r.company.domain,originalStatus:r.originalStatus,confirmed:r.replay.status==='corroborated'&&r.assessment.status==='corroborated'&&r.replay.match.abn===r.assessment.match.abn,existingEvidence:r.replay.match,recovery:r.assessment})),null,2),{mode:0o600});return summary;}
let webActive=0;const webWaiting=[];
async function recoverWeb(result){
 if(webActive>=2)await new Promise(r=>webWaiting.push(r));else webActive++;
 result.webSearch=[];result.webSearchEngine=searchEngine;
 try{
  const query=`site:${result.company.domain} ABN`;requests++;
  const response=await fetch(`http://127.0.0.1:7000/${searchEngine}/search?text=${encodeURIComponent(query)}&limit=10`,{signal:AbortSignal.timeout(45000)});
  if(!response.ok)throw Error(`Local search HTTP ${response.status}`);const payload=await response.json();const rows=Array.isArray(payload)?payload:payload.results||[];
  for(const row of rows.slice(0,10)){try{const u=new URL(row.url);if(u.hostname.replace(/^www\./,'')!==result.company.domain.replace(/^www\./,''))continue;const text=String(row.snippet||row.description||'');result.webSearch.push({url:u.href,title:row.title,text});result.company.indexedAbns=[...new Set([...(result.company.indexedAbns||[]),...websiteIdentity([{text}]).abns])];const brand=String(row.title||'').split(/\s[|–—]\s/).filter(n=>n.length>=3&&n.length<100);result.company.aliases=[...new Set([...(result.company.aliases||[]),...brand])];}catch{}}
  const existing=new Set(result.records.map(r=>r.abn));for(const abn of result.company.indexedAbns||[]){if(existing.has(abn))continue;try{result.records.push(await record(abn));}catch(e){result.errors.push({operation:'web_registry_record',abn,message:e.message});}}
  const urls=[...new Set(result.webSearch.map(r=>r.url))].filter(url=>!result.pages.some(p=>p.url===url)).slice(0,3);await Promise.all(urls.map(async url=>{try{const p=await website(url,result.company.domain);result.pages.push({url:p.url,text:visibleHtml(p.html)});}catch(e){result.errors.push({operation:'web_website',url,message:e.message});}}));
  result.assessment=assessAbnCandidates(result.company,result.records,result.pages,result.providerAbns);
 }catch(e){result.errors.push({operation:'web_search',message:e.message});}
 finally{const next=webWaiting.shift();if(next)next();else webActive--;}
}
async function recoverLegal(result){
 result.legalSearched=true;
 const candidates=websiteIdentity(result.pages).legalNames;
 for(const page of result.pages)for(const m of page.text.matchAll(/\b(?:[A-Z][A-Za-z0-9&'()./-]*\s+){1,6}(?:PTY\.?\s+(?:LTD\.?|LIMITED))\b/g))candidates.push(m[0].trim());
 const queries=[...new Set(candidates)].slice(0,5);
 for(const query of queries){try{
 const url=`https://abr.business.gov.au/Search/ResultsActive?SearchText=${encodeURIComponent(query)}`;
 const hits=parseAbnSearch(await registry(url)).filter(c=>c.active&&normaliseAbnName(query).endsWith(normaliseAbnName(c.name)));
 result.searches.push({query,url,candidates:hits,kind:'legal_name'});
 for(const hit of hits.slice(0,4))if(!result.records.some(r=>r.abn===hit.abn))result.records.push(await record(hit.abn));
 }catch(e){result.errors.push({operation:'legal_registry_search',query,message:e.message});}}
 result.assessment=assessAbnCandidates(result.company,result.records,result.pages,result.providerAbns);
}
async function audit(row){const file=`${output}/${row.id}.json`;if(existsSync(file)){const saved=JSON.parse(readFileSync(file));if(saved.completed){saved.replay=assessAbnCandidates({name:row.name,domain:row.domain},row.original.records||[],row.original.websitePages||[],saved.providerAbns);if(!saved.baselineAbn)saved.assessment=assessAbnCandidates(saved.company,saved.records,saved.pages,saved.providerAbns);if(legalSearch&&!saved.baselineAbn&&saved.assessment.status!=='corroborated'&&!saved.legalSearched)await recoverLegal(saved);if(webSearch&&!saved.baselineAbn&&saved.assessment.status!=='corroborated'&&(!saved.webSearch||saved.webSearchEngine!==searchEngine)){await recoverWeb(saved);writeFileSync(file,JSON.stringify(saved,null,2),{mode:0o600});}writeFileSync(file,JSON.stringify(saved,null,2),{mode:0o600});results.push(saved);console.log(JSON.stringify({processed:++completed,total:rows.length,name:row.name,status:saved.assessment.status,resumed:true}));report();return;}}
 const company={name:row.name,domain:row.domain},original=row.original,providerAbns=(original.firmableCandidates||[]).map(c=>c.abn),oldRecords=original.records||[],pages=[...(original.websitePages||[])],errors=[],searches=[];
 const replay=assessAbnCandidates(company,oldRecords,pages,providerAbns);
 const records=[];const attempted=new Set();async function read(abn){if(attempted.has(abn)||!abnChecksum(abn))return;attempted.add(abn);try{records.push(await record(abn));}catch(e){errors.push({operation:'registry_record',abn,message:e.message});}}
 if(!original.abn){await Promise.all([...new Set([...providerAbns,...oldRecords.map(r=>r.abn),...websiteIdentity(pages).abns])].slice(0,12).map(read));
 let current=assessAbnCandidates(company,records,pages,providerAbns);
 if(current.status!=='corroborated'){
  const aliases=[];try{const home=await website(`https://${row.domain}`,row.domain);pages.push({url:home.url,text:visibleHtml(home.html)});
   for(const m of home.html.matchAll(/<meta\b[^>]*(?:property|name)=["'](?:og:site_name|application-name)["'][^>]*content=["']([^"']+)/gi))aliases.push(visibleHtml(m[1]));
   const links=[...home.html.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>/gi)].map(m=>{try{return new URL(m[1].replaceAll('&amp;','&'),home.url).href;}catch{return null;}}).filter(u=>u&&/(?:privacy|terms|legal|contact|about)/i.test(new URL(u).pathname)&&new URL(u).hostname.replace(/^www\./,'')===row.domain.replace(/^www\./,''));
   const legal=[...new Set([...links,...['/privacy-policy','/terms-and-conditions','/about-us','/contact-us'].map(p=>new URL(p,home.url).href)])].slice(0,6);await Promise.all(legal.map(async url=>{try{const p=await website(url,row.domain);pages.push({url:p.url,text:visibleHtml(p.html)});}catch(e){errors.push({operation:'website',url,message:e.message});}}));
  }catch(e){errors.push({operation:'website',message:e.message});}
  await Promise.all(websiteIdentity(pages).abns.map(read));current=assessAbnCandidates(company,records,pages,providerAbns);
  if(current.status!=='corroborated'){
   const names=auditAliases(company,aliases).slice(0,5);await Promise.all(names.map(async query=>{try{const url=`https://abr.business.gov.au/Search/ResultsActive?SearchText=${encodeURIComponent(query)}`;const candidates=parseAbnSearch(await registry(url));searches.push({query,url,candidates});}catch(e){errors.push({operation:'registry_search',query,message:e.message});}}));
   const candidates=searches.flatMap(s=>s.candidates).filter(c=>c.active&&names.some(n=>{const a=normaliseAbnName(n),b=normaliseAbnName(c.name);return a===b||a.length>=5&&b.includes(a);}));await Promise.all([...new Set(candidates.map(c=>c.abn))].slice(0,12).map(read));
  }
 }
 }
 company.aliases=auditAliases(company,websiteIdentity(pages).ownerNames);
 const assessment=original.abn?{status:'baseline_verified',match:{abn:original.abn},candidates:[]}:assessAbnCandidates(company,records,pages,providerAbns);
 const result={completed:true,company,baselineAbn:original.abn,originalStatus:original.status,providerAbns,replay,assessment,records,pages,searches,errors,reviewRequired:!original.abn};if(legalSearch&&!result.baselineAbn&&result.assessment.status!=='corroborated')await recoverLegal(result);if(webSearch&&!result.baselineAbn&&result.assessment.status!=='corroborated')await recoverWeb(result);writeFileSync(file,JSON.stringify(result,null,2),{mode:0o600});results.push(result);console.log(JSON.stringify({processed:++completed,total:rows.length,name:row.name,status:assessment.status,abn:assessment.match?.abn,existingEvidenceMiss:Boolean(replay.match)}));report();
}
const started=Date.now();let index=0;await Promise.all(Array.from({length:concurrency},async()=>{while(index<rows.length)await audit(rows[index++]);}));console.log(JSON.stringify({final:report(),output}));
