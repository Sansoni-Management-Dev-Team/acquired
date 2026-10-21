import {expect,it} from 'vitest';
import {contactChannelReviewedNotice,groupAgentChatNotices} from './agent-chat-notices';
const notice=(id:string)=>({id,role:'assistant',content:contactChannelReviewedNotice,noticeKind:'contact_channel_reviewed'});
it('collapses consecutive controlled channel notices while preserving every original record and ID in order',()=>{
 const messages=Array.from({length:15},(_,i)=>Object.freeze(notice(String(i))));const groups=groupAgentChatNotices(Object.freeze(messages));
 expect(groups).toEqual([{kind:'channel_notices',messages}]);expect(groups[0].kind==='channel_notices'&&groups[0].messages.map(message=>message.id)).toEqual(messages.map(message=>message.id));expect(messages).toHaveLength(15);
});
it('never groups user messages, arbitrary model text, model quotes of a controlled notice, or a similar changed notice',()=>{
 const messages=[{...notice('user-1'),role:'user'},{...notice('user-2'),role:'user'},{id:'model-1',role:'assistant',content:contactChannelReviewedNotice},{id:'model-2',role:'assistant',content:contactChannelReviewedNotice},{...notice('changed-1'),content:contactChannelReviewedNotice+' Extra text.'},{...notice('changed-2'),content:contactChannelReviewedNotice+' Extra text.'}];
 expect(groupAgentChatNotices(messages)).toEqual(messages.map(message=>({kind:'message',message})));
});
it('does not collapse isolated notices or group across intervening user or agent messages',()=>{
 const messages=[notice('first'),{id:'question',role:'user',content:'Continue'},notice('second'),notice('third'),{id:'answer',role:'assistant',content:'Preparing drafts'},notice('fourth')];
 expect(groupAgentChatNotices(messages)).toEqual([{kind:'message',message:messages[0]},{kind:'message',message:messages[1]},{kind:'channel_notices',messages:messages.slice(2,4)},{kind:'message',message:messages[4]},{kind:'message',message:messages[5]}]);
});
it('keeps inline action boundaries by grouping only within the supplied timeline slice',()=>{
 const messages=[notice('first'),notice('second'),notice('third'),notice('fourth')];
 expect(groupAgentChatNotices(messages.slice(0,2))).toEqual([{kind:'channel_notices',messages:messages.slice(0,2)}]);expect(groupAgentChatNotices(messages.slice(2))).toEqual([{kind:'channel_notices',messages:messages.slice(2)}]);expect(groupAgentChatNotices([])).toEqual([]);
});
it('groups named display notices only with the trusted marker and exact controlled display template',()=>{
 const named=(id:string,name:string)=>({...notice(id),content:`Contact channel selected for ${name}. I’ll check their identity and conversation before sending.`}),first=named('first','Saishabi Sharma'),second=named('second','Akilas Fernandez');
 expect(groupAgentChatNotices([first,second])).toEqual([{kind:'channel_notices',messages:[first,second]}]);const untrusted=[{...first,noticeKind:undefined},{...second,content:second.content+' Extra prose.'}];expect(groupAgentChatNotices(untrusted)).toEqual(untrusted.map(message=>({kind:'message',message})));
});

it('groups trusted lead activity by person in latest-update order, preserving every original record',()=>{
 const lead=(id:string,person:string)=>({id,role:'assistant',content:id,noticeKind:'lead_update',lead:{id:person,name:person,kind:'status'}}),messages=[lead('checking','zoe'),lead('sending','meg'),lead('replied','zoe')];
 const groups=groupAgentChatNotices(messages);expect(groups).toEqual([{kind:'lead_updates',messages}]);expect(groupAgentChatNotices([...messages,{id:'human',role:'user',content:'What next?'},lead('draft','zoe')])).toHaveLength(3);
});
it('keeps setup and saved approval acknowledgements with lead activity while real user questions stay separate',()=>{
 const lead=(id:string)=>({id,role:'assistant',content:id,noticeKind:'lead_update',lead:{id:'zoe',name:'Zoe',kind:'status'}}),messages=[lead('draft'),{id:'approved',role:'user',content:'You approved these items.',noticeKind:'review_decision'},lead('reply')];
 expect(groupAgentChatNotices(messages)).toEqual([{kind:'lead_updates',messages}]);
 expect(groupAgentChatNotices([...messages,{id:'question',role:'user',content:'What happened?'}])).toHaveLength(2);
});
