import { replyIdentity,type ReplyChannel } from './campaign-replies';
/** New service canonical identities do not change the legacy provider-URN reader contract.
 * Call only after exact service binding/authenticated sender and recorded person mapping. */
export function communicationReplyIdentity(channel:ReplyChannel,raw:string):string|null {
 const legacy=replyIdentity(channel,raw);if(legacy)return legacy;
 if(channel!=='linkedin'||raw.length>500||raw!==raw.trim())return null;
 try{const u=new URL(raw);return u.protocol==='https:'&&u.hostname==='www.linkedin.com'&&/^\/in\/[A-Za-z0-9_%.-]+\/?$/.test(u.pathname)&&!u.username&&!u.password&&!u.port&&!u.search&&!u.hash?raw:null;}catch{return null;}
}
