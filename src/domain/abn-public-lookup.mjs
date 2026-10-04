// Public ABN Lookup HTML, not the GUID-authenticated JSON API.
export function abnChecksum(value){const digits=String(value).replace(/\D/g,'');if(!/^\d{11}$/.test(digits))return false;const weights=[10,1,3,5,7,9,11,13,15,17,19];return [...digits].reduce((sum,digit,i)=>sum+(Number(digit)-(i===0?1:0))*weights[i],0)%89===0;}
function text(html){return html.replace(/<[^>]*>/g,' ').replace(/&amp;/g,'&').replace(/&#39;|&apos;/g,"'").replace(/&quot;/g,'"').replace(/&nbsp;|&#160;/g,' ').replace(/\s+/g,' ').trim();}
export function normaliseAbnName(name){return String(name).toUpperCase().replace(/&/g,' AND ').replace(/[^A-Z0-9 ]/g,' ').replace(/\s+(?:(?:PTY|PROPRIETARY)\s+(?:LTD|LIMITED)|PTY|PROPRIETARY|LTD|LIMITED)\s*$/,' ').replace(/\s+/g,' ').trim();}
export function parseAbnSearch(html){
 if(!/Search results[^<]*ABN Lookup/i.test(html)||!/Matching names|No matching|No records|no active ABNs/i.test(html))throw Error('Unexpected ABN search response');
 const table=html.match(/<table\b[^>]*>[\s\S]*?Matching names[\s\S]*?<\/table>/i)?.[0];
 if(!table){if(/no (?:matching|records|active ABNs)/i.test(text(html)))return[];throw Error('ABN result table missing');}
 return [...table.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)].flatMap(([,row])=>{const cells=[...row.matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)].map(m=>m[1]);const abn=cells[0]?.match(/\/ABN\/View\?abn=(\d{11})/i)?.[1];if(!abn||!abnChecksum(abn)||cells.length<4)return[];return[{abn,name:text(cells[1]),nameType:text(cells[2]),location:text(cells[3]),active:/\bActive\b/.test(text(cells[0])),sourceUrl:`https://abr.business.gov.au/ABN/View?abn=${abn}`}];});
}
export function classifyAbnMatches(query,candidates){const exact=candidates.filter(c=>c.active&&normaliseAbnName(c.name)===normaliseAbnName(query));const abns=new Set(exact.map(c=>c.abn));return{status:abns.size===1?'exact_name_match':abns.size>1?'ambiguous_exact_matches':candidates.length?'candidates_only':'no_results',match:abns.size===1?exact[0]:null};}
