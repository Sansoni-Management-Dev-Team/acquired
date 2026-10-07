import { visibleHtml } from '@/domain/abn-resolution.mjs';
export type PublishedTeamMember={name:string;role:string|null;email?:string;phone?:string;sourceUrl:string;quote:string;capturedAt:string;reader:string;employmentStatus:'published_team_member'};
const named=(value:string)=>/^[\p{Lu}][\p{L}'’-]+(?: [\p{Lu}][\p{L}'’.-]+){1,4}$/u.test(value)&&! /\b(?:company|team|staff|contact|water|testing|laboratory|services|director|manager|support|our|about|ltd|pty)\b/i.test(value);
const roleLike=(value:string)=>/\b(?:scientist|chemist|technician|engineer|manager|director|coordinator|officer|administrator|founder|owner|analyst|microbiologist|geologist|researcher|principal|professor|partner|leader|operations|sales|quality|specialist|accounts|development|ceo|cfo|coo)\b/i.test(value)&&value.length<=100;
/** Named staff are accepted only inside a published team/leadership section. */
export function publishedTeamMembers(html:string,markdown:string,sourceUrl:string,capturedAt:string,reader:string):PublishedTeamMember[]{
 const cleaned=html.replace(/<!--[\s\S]*?-->/g,'').replace(/<(script|style|noscript)\b[^>]*>[\s\S]*?<\/\1>/gi,'');
 const structural=cleaned.replace(/<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>/gi,(_all,level,body)=>`\n${'#'.repeat(Number(level))} ${visibleHtml(body)}\n`).replace(/<\/(?:p|div|li|article|section)>/gi,'\n');
 const text=(cleaned?structural:markdown).split(/\n/).map(line=>visibleHtml(line).trim()).filter(Boolean);const out:PublishedTeamMember[]=[];
 let inTeam=false;
 for(let i=0;i<text.length;i++){
  const line=text[i];if(/^#{1,3} /.test(line)&&!named(line.replace(/^#+\s+/,''))){inTeam=/\b(?:team|our people|leadership|management|meet (?:our|the)|staff|board)\b/i.test(line);continue;}
  if(!inTeam)continue;
  const name=line.replace(/^#{1,6}\s+/,'').replace(/^(?:Dr|Mr|Ms|Mrs|Prof)\.?\s+/,'');if(!named(name))continue;
  const following:string[]=[];for(const next of text.slice(i+1,i+5)){if(named(next.replace(/^#+\s+/,''))&&!roleLike(next)||/^#{1,2} /.test(next))break;following.push(next);}const role=following.find(roleLike)||null;
  if(!role)continue;
  const block=[name,...following].join(' '),email=block.match(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i)?.[0],phone=block.match(/\b(?:P|Phone|Telephone|Call)\s*[:.]?\s*(\+?\d[\d() -]{7,24})/i)?.[1]?.trim();
  out.push({name,role,...(email?{email}:{}),...(phone?{phone}:{}),sourceUrl,quote:block.slice(0,500),capturedAt,reader,employmentStatus:'published_team_member'});
 }
 return [...new Map(out.map(member=>[`${member.name}:${member.role}`,member])).values()];
}
