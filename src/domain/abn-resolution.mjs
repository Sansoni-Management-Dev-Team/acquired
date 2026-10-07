import {abnChecksum,normaliseAbnName} from './abn-public-lookup.mjs';
export function visibleHtml(html){return String(html).replace(/<!--[\s\S]*?-->/g,' ').replace(/<(script|style|noscript)\b[^>]*>[\s\S]*?<\/\1>/gi,' ').replace(/<[^>]*>/g,' ').replace(/&amp;/g,'&').replace(/&nbsp;|&#160;/g,' ').replace(/&#39;|&apos;/g,"'").replace(/&quot;/g,'"').replace(/\s+/g,' ').trim();}
const compact=name=>normaliseAbnName(name).replaceAll(' ','');
export function abnAliases(name){const brand=String(name).replace(/\s*[-–—(]\s*(?:a\s+)?(?:part of|owned by|a division of)[\s\S]*$/i,'').trim();const displayBrand=String(brand).split(/\s[|–—]\s|\s-\s|:\s/)[0].trim();const names=[name,brand,displayBrand];if(/brands$/i.test(brand)&&!/ brands$/i.test(brand))names.push(brand.replace(/brands$/i,' brands'));return [...new Set(names.filter(Boolean))].slice(0,3);}
const genericName = name => /^(?:services|recycling|industrial cleaning(?: services)?|waste management(?: solutions| services)?|home)$/i.test(String(name).trim());
export function abnSearchAliases(name,website,extra=[]){
 const stem=new URL(website).hostname.replace(/^www\./,'').split('.')[0];
 const brand=String(name).split(/\s[|–—]\s|\s-\s/)[0].replace(/\s*\([^)]*\)\s*$/,'');
 const seen=new Set();return [...abnAliases(name),brand,stem,...extra].filter(n=>{const key=compact(n);if(!n||n.length<3||n.length>160||genericName(n)||seen.has(key))return false;seen.add(key);return true;}).slice(0,5);
}
const legalKey=value=>String(value).toUpperCase().replace(/[^A-Z0-9]+/g,' ').replace(/\bLIMITED\b/g,'LTD').replace(/\bPROPRIETARY\b/g,'PTY').trim();
function legalMention(text,record,records=[]){
 const entity=legalKey(record.entityName);let context=` ${legalKey(text)} `;
 // Remove only longer entity spans, so a separate occurrence of the shorter
 // registered name remains independent evidence rather than disappearing.
 for(const other of records){const longer=legalKey(other.entityName);if(other!==record&&other.active&&longer!==entity&&(` ${longer} `).includes(` ${entity} `))context=context.replaceAll(` ${longer} `,' ');}
 return normaliseAbnName(record.entityName).length>=8&&!genericName(normaliseAbnName(record.entityName))&&/\b(?:PTY|LIMITED|LTD|TRUST|COUNCIL|INCORPORATED)\b/i.test(record.entityName)&&context.includes(` ${entity} `);
}
function legalIdentity(text,record,name,website,records){
 if(!legalMention(text,record,records))return false;
 const aliases=abnSearchAliases(name,website).map(compact);
 const branded=[record.entityName,...record.names].some(n=>aliases.some(a=>a.length>=4&&compact(n).includes(a)));
 const context=legalKey(text),entity=legalKey(record.entityName),offset=context.indexOf(entity);
 return branded||/(?:OWNED AND OPERATED BY|OPERATED BY|WE US OR OUR|WE US AND OUR)/.test(context.slice(Math.max(0,offset-60),offset+entity.length+60));
}
export function parseAbnRecord(html,abn){const plain=visibleHtml(html);const shown=plain.match(/Current details for ABN\s+([\d ]{11,20})/i)?.[1]?.replace(/\D/g,'');if(shown!==abn||!abnChecksum(abn))throw Error('Unexpected ABN detail record');const fields={};for(const [,row]of html.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)){const key=row.match(/<th\b[^>]*>([\s\S]*?)<\/th>/i)?.[1],value=row.match(/<td\b[^>]*>([\s\S]*?)<\/td>/i)?.[1];if(key&&value)fields[visibleHtml(key).replace(/:$/,'')]=visibleHtml(value);}const entityName=fields['Entity name'];if(!entityName||!fields['ABN status'])throw Error('Incomplete ABN detail record');const names=[];for(const [table]of html.matchAll(/<table\b[^>]*>[\s\S]*?<\/table>/gi)){if(!/<caption[^>]*>[\s\S]*?(?:Business names|Trading names)/i.test(table))continue;for(const[,row]of table.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)){const cells=[...row.matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)];const cell=cells.length>=2?cells[0][1]:undefined;if(cell)names.push(visibleHtml(cell).replace(/View record.*|External site/gi,'').trim());}}return{abn,entityName,active:/^Active\b/i.test(fields['ABN status']),names,quote:plain.slice(plain.indexOf('Entity name:'),plain.indexOf('Entity name:')+500),location:fields['Main business location']||'',sourceUrl:`https://abr.business.gov.au/ABN/View?abn=${abn}`};}
export function websiteIdentity(pages){const abns=[],legalNames=[],ownerNames=[];for(const page of pages){for(const m of page.text.matchAll(/\b(?:ABN|A\.B\.N\.)\s*[:#]?\s*([\d \u00a0]{11,20})/gi)){const value=m[1].replace(/\D/g,'');if(abnChecksum(value))abns.push(value);}for(const m of page.text.matchAll(/\b(?:[A-Z(][a-zA-Z0-9&'().-]*\s+){1,7}(?:(?:Pty|PTY)\.?\s+(?:Ltd|LTD|Limited|LIMITED)\.?|Proprietary\s+Limited)\b/g))legalNames.push(m[0].trim());for(const m of page.text.matchAll(/(?:owned and operated by|©\s*\d{4})\s+([A-Z][A-Za-z0-9&() '-]{3,70})/g))ownerNames.push(m[1].replace(/\s+(?:No material|Terms|All rights|Our Policies|Privacy)[\s\S]*$/i,'').trim());}return{abns:[...new Set(abns)],legalNames:[...new Set(legalNames)],ownerNames:[...new Set(ownerNames)]};}
function sameSite(a,b){try{return new URL(a).hostname.toLowerCase().replace(/^www\./,'')===new URL(b).hostname.toLowerCase().replace(/^www\./,'');}catch{return false;}}
export function resolveAbnIdentity({name,website,pages,records}){
 const own=pages.filter(p=>sameSite(p.url,website)),identity=websiteIdentity(own),evaluated=[];
 for(const record of records){if(!record.active)continue;const evidence=[];let score=0;
  for(const page of own){const disclosed=identity.abns.length===1&&websiteIdentity([page]).abns.includes(record.abn),legal=legalIdentity(page.text,record,name,website,records);
   if(disclosed||legal){const tokens=record.entityName.match(/[a-z0-9]+/gi)||[];const pattern=tokens.map(w=>/^(limited|ltd)$/i.test(w)?'(?:limited|ltd)':w).join('[^a-z0-9]+');const abnIndex=new RegExp(record.abn.split('').join('[\\s\\u00a0]*')).exec(page.text)?.index;const legalIndex=pattern?new RegExp(pattern,'i').exec(page.text)?.index:undefined;const start=Math.max(0,(abnIndex??legalIndex??0)-60);score=Math.max(score,disclosed?100:90);evidence.push({sourceUrl:page.url,kind:disclosed?(legal?'website_abn_and_legal_entity':'website_disclosed_abn'):'website_legal_entity',quote:page.text.slice(start,start+500)});}
  }
  if(score)evaluated.push({record,score,evidence});
 }
 const unique=[...new Map(evaluated.sort((a,b)=>b.score-a.score).map(r=>[r.record.abn,r])).values()],top=unique.filter(r=>r.score===unique[0]?.score);
 const multipleLegal=identity.abns.length===0&&records.filter(r=>r.active&&own.some(p=>legalMention(p.text,r,records))).length>1;
 const ambiguous=identity.abns.length>1||multipleLegal||top.length>1;
 const matched=!ambiguous&&top.length===1;
 const status=ambiguous?'ambiguous':matched?'matched':records.length?'candidates_only':'not_found';return{status,abn:matched?top[0].record.abn:null,record:matched?top[0].record:null,evidence:matched?top[0].evidence:[],candidates:unique,scope:matched&&top[0].score===100?'website_disclosed_entity':'website_legal_entity',queryName:name};
}
