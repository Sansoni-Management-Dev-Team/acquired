import {expect,it} from 'vitest';
import {manualFeedbackInputSchema} from './agent-manual-feedback';
import {guidanceSourceEntitySchema} from './agent-guidance';
const id='00000000-0000-4000-8000-000000000001',base={reason:'Installation-heavy work dominates.',preference:'Prefer recurring maintenance.',category:'qualification'};
it('requires exact saved manual entity revisions and rejects supplied authority or snapshots',()=>{
 expect(manualFeedbackInputSchema.parse({...base,source:{kind:'target_review',targetId:id,revision:2}}).source.revision).toBe(2);
 expect(manualFeedbackInputSchema.parse({...base,source:{kind:'sequence_draft',sequenceId:id,revision:'4294967295'}}).source.revision).toBe('4294967295');
 for(const source of [{kind:'target_review',targetId:id,revision:'2'},{kind:'sequence_draft',sequenceId:id,revision:2},{kind:'target_review',targetId:id,revision:2,snapshot:{}}])expect(manualFeedbackInputSchema.safeParse({...base,source}).success).toBe(false);
 expect(manualFeedbackInputSchema.safeParse({...base,source:{kind:'target_review',targetId:id,revision:2},approved:true}).success).toBe(false);
});
it('keeps manual source provenance types exact while preserving existing entity provenance',()=>{
 const digest='a'.repeat(64);
 for(const source of [{kind:'target_review',revision:2},{kind:'sequence_draft',revision:'25'},{kind:'operation',revision:2},{kind:'handoff',revision:2}])expect(guidanceSourceEntitySchema.safeParse({...source,id,digest}).success).toBe(true);
 expect(guidanceSourceEntitySchema.safeParse({kind:'sequence_draft',revision:25,id,digest}).success).toBe(false);
});
