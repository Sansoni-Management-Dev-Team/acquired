import {expect,it} from 'vitest';
import {selectAgentGuidance,guidanceInputSchema} from './agent-guidance';
const scope={organizationId:'org',mandateId:'mandate',userId:'user'};
const input={text:'Prefer recurring maintenance revenue.',category:'qualification',sourceMessageId:'00000000-0000-4000-8000-000000000001',triggerTerms:['maintenance']};
const item={...scope,id:'00000000-0000-4000-8000-000000000002',revision:2,state:'approved',input};
it('retrieves only current approved guidance in the exact owner/mandate scope',()=>{
 const records=[item,{...item,state:'proposed'},{...item,state:'rejected'},{...item,organizationId:'other'},{...item,mandateId:'other'},{...item,userId:'other'}];
 expect(selectAgentGuidance(records,scope,'Commercial maintenance')).toEqual([item]);
});
it('requires matching topics, with deterministic relevance and id ordering',()=>{
 expect(selectAgentGuidance([item],scope,'Installation contractor')).toEqual([]);
 const tone={...item,id:'00000000-0000-4000-8000-000000000003',input:{...input,category:'tone',triggerTerms:[]}};
 expect(selectAgentGuidance([tone,item],scope,'maintenance').map(i=>i.id)).toEqual([item.id,tone.id]);
});
it('bounds guidance count and context without truncating the meaning of a preference',()=>{
 const records=Array.from({length:20},(_,n)=>({...item,id:`00000000-0000-4000-8000-${String(n+1).padStart(12,'0')}`,input:{...input,text:'a'.repeat(1500),triggerTerms:[]}}));
 const result=selectAgentGuidance(records,scope,'');expect(result.length).toBeLessThanOrEqual(5);expect(result.reduce((n,i)=>n+i.input.text.length,0)).toBeLessThanOrEqual(4000);
});
it('does not accept hidden authority, global scopes or unsupported provenance fields',()=>{
 for(const injected of [{approved:true},{scope:'all_organisations'},{grant:'yolo'},{sourceRole:'system'}])expect(guidanceInputSchema.safeParse({...input,...injected}).success).toBe(false);
});
