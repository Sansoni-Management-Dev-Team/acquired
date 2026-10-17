import { beforeEach, expect, it, vi } from 'vitest';
import { emptyBrief } from './acquisition';
import { createAcquireCommands, acquireCommandCatalog } from './acquire-commands';
const actor={organizationId:'org-a',userId:'user-a'};
const id='00000000-0000-4000-8000-000000000001';
const deps={assertMember:vi.fn(),getMandate:vi.fn(),listResearch:vi.fn(),updateMandate:vi.fn()};
beforeEach(()=>{vi.clearAllMocks();deps.assertMember.mockResolvedValue(undefined);deps.getMandate.mockResolvedValue({id,brief:emptyBrief(),revision:'123',createdAt:'2026-10-17T00:00:00Z'});deps.listResearch.mockResolvedValue([]);});
it('uses the same validated read command for manual and agent callers',async()=>{
 const commands=createAcquireCommands(deps);
 const request={name:'mandate.read',input:{mandateId:id}};
 expect(await commands.execute(actor,request)).toEqual(await commands.execute(actor,request));
 expect(deps.getMandate).toHaveBeenCalledWith(actor,id);
 expect(acquireCommandCatalog['mandate.read'].effect).toBe('read');
});
it('rejects forged scope and unknown tools before any repository access',async()=>{
 const commands=createAcquireCommands(deps);
 for(const request of [{name:'mandate.read',input:{mandateId:id,organizationId:'foreign'}},{name:'email.send',input:{mandateId:id}},{name:'mandate.read',input:{mandateId:id},actor:{userId:'foreign'}}])await expect(commands.execute(actor,request)).rejects.toThrow();
 expect(deps.getMandate).not.toHaveBeenCalled();
});
it('rechecks membership and mandate access before research reads',async()=>{
 const commands=createAcquireCommands(deps);deps.assertMember.mockRejectedValueOnce(new Error('not a member'));
 await expect(commands.execute(actor,{name:'research.status',input:{mandateId:id}})).rejects.toThrow('member');expect(deps.listResearch).not.toHaveBeenCalled();
 deps.getMandate.mockResolvedValueOnce(undefined);
 await expect(commands.execute(actor,{name:'research.status',input:{mandateId:id}})).rejects.toThrow('Mandate not found');expect(deps.listResearch).not.toHaveBeenCalled();
});
it('returns observed saved state without invoking recovery or misreporting queued work',async()=>{
 deps.listResearch.mockResolvedValue([{status:'queued',message:'awaiting worker'}]);
 const result=await createAcquireCommands(deps).execute(actor,{name:'research.status',input:{mandateId:id}});
 expect(result).toMatchObject({name:'research.status',status:'observed',value:{research:{queued:1,active:0,complete:0}}});
});
it('validates malformed repository output instead of presenting it as saved state',async()=>{
 deps.getMandate.mockResolvedValueOnce({id:'invalid',brief:emptyBrief(),createdAt:'today'});
 await expect(createAcquireCommands(deps).execute(actor,{name:'mandate.read',input:{mandateId:id}})).rejects.toThrow();
});
it('rejects a valid but mismatched mandate returned by a repository',async()=>{
 deps.getMandate.mockResolvedValueOnce({id:'00000000-0000-4000-8000-000000000002',brief:emptyBrief(),createdAt:'2026-10-17T00:00:00Z'});
 await expect(createAcquireCommands(deps).execute(actor,{name:'mandate.read',input:{mandateId:id}})).rejects.toThrow('Mandate identity');
});
it('updates a reviewed brief with the caller’s base revision and returns the saved revision',async()=>{
 const brief={...emptyBrief(),name:'Reviewed goal'};
 deps.updateMandate.mockResolvedValue({id,brief,revision:'124',createdAt:'2026-10-17T00:00:00Z'});
 const result=await createAcquireCommands(deps).execute(actor,{name:'mandate.update',input:{mandateId:id,brief,expectedRevision:'123'}});
 expect(result).toMatchObject({name:'mandate.update',status:'completed',value:{revision:'124',brief}});
 expect(deps.updateMandate).toHaveBeenCalledWith(actor,id,brief,'123');
});
it('refuses mutation without a base revision or with caller-supplied authority',async()=>{
 for(const input of [{mandateId:id,brief:emptyBrief()},{mandateId:id,brief:emptyBrief(),expectedRevision:'123',approved:true}])await expect(createAcquireCommands(deps).execute(actor,{name:'mandate.update',input})).rejects.toThrow();
 expect(deps.updateMandate).not.toHaveBeenCalled();
});
it('rejects an obsolete proposal before attempting its mutation',async()=>{
 await expect(createAcquireCommands(deps).execute(actor,{name:'mandate.update',input:{mandateId:id,brief:emptyBrief(),expectedRevision:'122'}})).rejects.toThrow('changed');
 expect(deps.updateMandate).not.toHaveBeenCalled();
});
