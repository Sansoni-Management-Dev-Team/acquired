import {expect,it,vi} from 'vitest';
import {acquisitionWorkflowContext} from './acquisition-workflow-context';
const m=vi.hoisted(()=>({db:{} as unknown}));
vi.mock('@/db/client',()=>({requireDb:()=>m.db}));
import {recoverAutomaticCompanyPeople} from './company-people-research';
it.each(['00000000-0000-4000-8000-000000000001',null])('restores original execution %s before automatic people recovery',async(workflowExecutionId)=>{
 const root={id:'root',organizationId:'org',createdBy:'owner',workflowExecutionId,config:{}};
 const stop=Error('transaction observed');let observed:unknown;
 m.db={select:()=>({from:()=>({where:async()=>[root]})}),transaction:async()=>{observed=acquisitionWorkflowContext();throw stop;}};
 await expect(recoverAutomaticCompanyPeople('org','mandate')).rejects.toBe(stop);
 expect(observed).toMatchObject({id:workflowExecutionId,organizationId:'org',ownerUserId:'owner'});
});
