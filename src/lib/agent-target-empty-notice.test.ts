import {expect,it} from 'vitest';
import {emptyAgentTargetNotice,emptyAgentTargetText} from './agent-target-empty-notice';
const notice=(reasons:string[][])=>({role:'assistant',request_key:'target-empty:'+'a'.repeat(64),content:{text:emptyAgentTargetText,details:{counts:{contacts:reasons.length,companies:2,reviewed:reasons.length,selected:0,excluded:reasons.length},excluded:reasons.map((reasons,i)=>({contactId:`00000000-0000-4000-8000-${String(i+1).padStart(12,'0')}`,reasons}))}}});
it('explains a shared unreviewed brief before suggesting that every person has bad company fit or contact details',()=>{
 const result=emptyAgentTargetNotice(notice([['company_criteria_review_required','missing_or_invalid_reviewed_channels'],['company_criteria_review_required','company_excluded','excluded_by_mandate_review']]));
 expect(result?.text).toContain('Review the saved mandate brief');expect(result?.text).toContain('geography and business type');expect(result?.text).toContain('testing assumptions');expect(result?.text).toContain('Other company-fit or contact checks may still need review');
});
it('does not attribute unrelated or mixed blocking reasons to an unreviewed brief',()=>{
 for(const reasons of [[['suppressed']],[['company_criteria_review_required'],['conversation_already_owned']]])expect(emptyAgentTargetNotice(notice(reasons))?.text).not.toContain('Review the saved mandate brief');
});
it('retains genuine all-fit exclusions and rejects malformed notices',()=>{
 expect(emptyAgentTargetNotice(notice([['excluded_by_mandate_review']]))?.text).toContain('match this mandate');
 const value=notice([['company_criteria_review_required']]);value.content.details.counts.excluded=2;expect(emptyAgentTargetNotice(value)).toBeUndefined();
});
