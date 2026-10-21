import {beforeEach,expect,it,vi} from 'vitest';
import {emptyBrief} from './acquisition';
import {createAcquireCommands} from './acquire-commands';

const actor={organizationId:'org-a',userId:'user-a'},mandateId='00000000-0000-4000-8000-000000000001',reviewId='00000000-0000-4000-8000-000000000002',targetId='00000000-0000-4000-8000-000000000003';
const decision={requestKey:'00000000-0000-4000-8000-000000000004',reviewId,expectedRevision:1,previewDigest:'a'.repeat(64),decision:'adopt' as const,selectedTargetId:targetId};
const preview={reviewId,revision:1,previewDigest:'a'.repeat(64),source:{observationId:'00000000-0000-4000-8000-000000000005',jobId:'00000000-0000-4000-8000-000000000006',mandateId,companyName:'Reviewed operator',firmableId:'f123',domain:'operator.example',observedAt:'2026-10-18T00:00:00.000Z',sourceUrl:'https://app.firmable.com/dashboard/company/f123'},candidates:[{targetId,sourceRevision:'100',companyName:'Reviewed operator',domain:'operator.example',firmableId:'f123',savedPeopleCount:3,mandateCount:1}],reason:'consistent_existing_duplicates'};
const deps={assertMember:vi.fn(),getMandate:vi.fn(),listResearch:vi.fn(),updateMandate:vi.fn(),listCompanyIdentityReviews:vi.fn(),decideCompanyIdentity:vi.fn()};
beforeEach(()=>{vi.resetAllMocks();deps.getMandate.mockResolvedValue({id:mandateId,brief:emptyBrief(),revision:'101',createdAt:'2026-10-18T00:00:00.000Z'});deps.listCompanyIdentityReviews.mockResolvedValue([preview]);deps.decideCompanyIdentity.mockResolvedValue({reviewId,status:'adopted',targetId});});

it('uses one actor-scoped command for manual Companies and agent human identity review',async()=>{
 const commands=createAcquireCommands(deps);
 const read=await commands.execute(actor,{name:'company.identity.list',input:{mandateId}});
 expect(read).toMatchObject({name:'company.identity.list',status:'observed',value:{reviews:[preview]}});
 expect(deps.listCompanyIdentityReviews).toHaveBeenCalledWith(actor,mandateId);
 for(let caller=0;caller<2;caller++)expect(await commands.execute(actor,{name:'company.identity.decide',input:{mandateId,decision}})).toMatchObject({name:'company.identity.decide',status:'completed',value:{reviewId,status:'adopted',targetId}});
 expect(deps.decideCompanyIdentity.mock.calls).toEqual([[actor,mandateId,decision],[actor,mandateId,decision]]);
 expect(deps.listResearch).not.toHaveBeenCalled();expect(deps.updateMandate).not.toHaveBeenCalled();
});

it('requires current membership and mandate access before reading or adopting an identity',async()=>{
 const commands=createAcquireCommands(deps);deps.assertMember.mockRejectedValueOnce(Error('membership changed'));
 await expect(commands.execute(actor,{name:'company.identity.list',input:{mandateId}})).rejects.toThrow('membership');
 deps.getMandate.mockResolvedValueOnce(undefined);
 await expect(commands.execute(actor,{name:'company.identity.decide',input:{mandateId,decision}})).rejects.toThrow('Mandate not found');
 expect(deps.listCompanyIdentityReviews).not.toHaveBeenCalled();expect(deps.decideCompanyIdentity).not.toHaveBeenCalled();
});

it('never accepts browser source facts, contacts, permissions or an implicit adoption choice',async()=>{
 const commands=createAcquireCommands(deps);
 for(const extra of [{organizationId:'foreign'},{source:preview.source},{approved:true},{contacts:[]},{mode:'demo'},{send:true}])await expect(commands.execute(actor,{name:'company.identity.decide',input:{mandateId,decision:{...decision,...extra}}})).rejects.toThrow();
 const {selectedTargetId:omitted,...noChoice}=decision;void omitted;
 await expect(commands.execute(actor,{name:'company.identity.decide',input:{mandateId,decision:noChoice}})).rejects.toThrow();
 expect(deps.decideCompanyIdentity).not.toHaveBeenCalled();
});

it('refuses another mandate’s preview or an acknowledgement for a different choice',async()=>{
 deps.listCompanyIdentityReviews.mockResolvedValueOnce([{...preview,source:{...preview.source,mandateId:targetId}}]);
 await expect(createAcquireCommands(deps).execute(actor,{name:'company.identity.list',input:{mandateId}})).rejects.toThrow('scope');
 deps.decideCompanyIdentity.mockResolvedValueOnce({reviewId,status:'adopted',targetId:reviewId});
 await expect(createAcquireCommands(deps).execute(actor,{name:'company.identity.decide',input:{mandateId,decision}})).rejects.toThrow('identity');
});

it('allows an explicit skip without selecting a company or granting any other authority',async()=>{
 const {selectedTargetId:omitted,...skip}=decision;void omitted;deps.decideCompanyIdentity.mockResolvedValueOnce({reviewId,status:'skipped'});
 const result=await createAcquireCommands(deps).execute(actor,{name:'company.identity.decide',input:{mandateId,decision:{...skip,decision:'skip'}}});
 expect(result).toMatchObject({value:{reviewId,status:'skipped'}});expect(deps.updateMandate).not.toHaveBeenCalled();expect(deps.listResearch).not.toHaveBeenCalled();
});
