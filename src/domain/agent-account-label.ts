const channelNames:Record<string,string>={email:'Email',whatsapp:'WhatsApp',linkedin:'LinkedIn'};
/** Presentation only: never infer a simulator or change an account binding from an opaque label. */
export function formattedAgentAccountLabel(label:unknown,channel:string):string{
 const fallback=channelNames[channel]?`Recorded ${channelNames[channel]} account`:'Recorded account';
 if(typeof label!=='string'||!label.trim())return fallback;
 const raw=label.trim(),physical=/\bphysical-[a-f0-9]{32,}\b/ig,hasPhysical=/\bphysical-[a-f0-9]{32,}\b/i.test(raw);
 const generic=new Set([channel,channelNames[channel]?.toLowerCase(),'recorded account',...(channel==='email'?['gmail','outlook','imap']:[])]);
 const aliases=raw.split('·').map(part=>part.replace(physical,'').trim()).filter(part=>part&&!generic.has(part.toLowerCase()));
 if(!aliases.length)return fallback;
 return hasPhysical?aliases.join(' · '):raw;
}
