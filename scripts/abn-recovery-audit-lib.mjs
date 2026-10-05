import {normaliseAbnName} from '../src/domain/abn-public-lookup.mjs';
import {websiteIdentity} from '../src/domain/abn-resolution.mjs';
export const nameKey = name => normaliseAbnName(name).replace(/\b(?:AUSTRALIA|AUSTRALIAN|AU|NSW|VIC|QLD|SA|WA|TAS|NT|ACT)\b/g,' ').replace(/\s+/g,' ').trim();
const quoteFor = (text,record) => { const abn = new RegExp(record.abn.split('').join('[\\s\\u00a0]*')).exec(text); const pattern = record.entityName.match(/[a-z0-9]+/gi)?.map(word=>/^(?:limited|ltd)$/i.test(word)?'(?:limited|ltd)':word).join('[^a-z0-9]+'); const legal = pattern ? new RegExp(pattern,'i').exec(text)?.index ?? -1 : -1; const start = Math.max(0,(abn?.index ?? (legal >= 0 ? legal : 0))-100); return text.slice(start,start+600); };
const legalKey = value => String(value).toUpperCase().replace(/[^A-Z0-9]+/g,' ').replace(/\bLIMITED\b/g,'LTD').replace(/\bPROPRIETARY\b/g,'PTY').trim();
const mentionsEntity = (text, record, company) => {
 const entity=legalKey(record.entityName), words=normaliseAbnName(record.entityName);
 const aliases=auditAliases(company).map(n=>normaliseAbnName(n).replace(/[^A-Z0-9]/g,''));
 const branded=[record.entityName,...record.names].some(n=>aliases.some(a=>a.length>=4&&normaliseAbnName(n).replace(/[^A-Z0-9]/g,'').includes(a)));
 const context=legalKey(text);const offset=context.indexOf(entity);
 const operator=offset>=0&&/(?:OWNED AND OPERATED BY|OPERATED BY|WE US OR OUR|WE US AND OUR)/.test(context.slice(Math.max(0,offset-60),offset+entity.length+60));
 return (branded||operator) && words.length>=8 && !generic(words) && /\b(?:PTY|LIMITED|LTD|TRUST|COUNCIL|INCORPORATED)\b/i.test(record.entityName) && (` ${legalKey(text)} `).includes(` ${entity} `);
};
const generic = name => /^(?:services|recycling|industrial cleaning(?: services)?|waste management(?: solutions| services)?|home)$/i.test(name.trim());
export function auditAliases(company, extra=[]) {
 const stem = new URL(`https://${company.domain}`).hostname.replace(/^www\./,'').split('.')[0];
 const names=[company.name,...(company.aliases||[]),...extra,stem,company.name.split(/\s[|–—]\s|\s-\s/)[0],company.name.replace(/\s*\([^)]*\)\s*$/,'')];
 return [...new Set(names.map(n=>String(n||'').trim()).filter(n=>n.length>=3&&n.length<=160&&!generic(n)))].slice(0,8);
}
export function assessAbnCandidates(company,records,pages,providerAbns=[]) {
 const own=pages.filter(p=>p.kind!=='search_snippet').filter(p=>{try{return new URL(p.url).hostname.replace(/^www\./,'')===company.domain.replace(/^www\./,'');}catch{return false;}});
 const explicit=new Set(websiteIdentity(own).abns);
 const names=auditAliases(company).map(nameKey);
 const evidence=[];
 for(const record of records){
  if(!record.active)continue;
  let reason,level;
  if(explicit.has(record.abn)&&explicit.size===1){reason='website_disclosed_abn';level='corroborated';}
  else {
   const legal=own.find(p=>mentionsEntity(p.text,record,company));
   if(legal){reason='website_registered_entity';level='corroborated';}
   else if(providerAbns.includes(record.abn)&&[record.entityName,...record.names].some(n=>names.includes(nameKey(n)))){reason='provider_name_after_alias_normalization';level='proposed';}
   else if(providerAbns.includes(record.abn)&&names.some(n=>/^[A-Z]{3,6}$/.test(n)&&normaliseAbnName(record.entityName).split(' ').map(w=>w[0]).join('')===n)){reason='provider_acronym';level='proposed';}
   if(!reason&&company.indexedAbns?.includes(record.abn)){reason='indexed_website_abn';level='proposed';}
   if(!reason&&[record.entityName,...record.names].some(n=>auditAliases(company).some(alias=>normaliseAbnName(alias)===normaliseAbnName(n)))){reason='unique_exact_registry_name';level='proposed';}
  }
  if(reason)evidence.push({abn:record.abn,entityName:record.entityName,reason,level,sourceUrl:record.sourceUrl,websiteEvidence:own.filter(p=>explicit.has(record.abn)?websiteIdentity([p]).abns.includes(record.abn):mentionsEntity(p.text,record,company)).map(p=>({url:p.url,quote:quoteFor(p.text,record)}))});
 }
 const distinct=[...new Map(evidence.map(e=>[e.abn,e])).values()];
 const corroborated=distinct.filter(e=>e.level==='corroborated');
 if(explicit.size<=1&&corroborated.length===1)return {status:'corroborated',match:corroborated[0],candidates:distinct};
 // Never choose between multiple supported entities or multiple disclosed ABNs.
 return {status:explicit.size>1||distinct.length>1?'ambiguous':distinct.length?distinct[0].level:'unresolved',match:explicit.size<=1&&distinct.length===1?distinct[0]:null,candidates:distinct};
}
