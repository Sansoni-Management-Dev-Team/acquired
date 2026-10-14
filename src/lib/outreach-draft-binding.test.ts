import {expect,it,vi,afterEach} from 'vitest';vi.mock('server-only',()=>({}));
import {snapshotApprovedDraftBinding} from './outreach-draft-binding';
afterEach(()=>vi.unstubAllEnvs());
it('freezes the selected email binding once in the approval transaction without transferring historical Gmail drafts',async()=>{
 vi.stubEnv('COMMUNICATIONS_RUNTIME_ENABLED','true');const execute=vi.fn().mockResolvedValueOnce({rows:[]}).mockResolvedValueOnce({rows:[{binding_id:'bid'}]}).mockResolvedValueOnce({rows:[{message_id:'draft'}]});
 await snapshotApprovedDraftBinding({execute} as never,{organizationId:'org',userId:'owner'},{id:'draft',providerMessageId:null});expect(execute).toHaveBeenCalledTimes(3);
 execute.mockClear();await expect(snapshotApprovedDraftBinding({execute} as never,{organizationId:'org',userId:'owner'},{id:'old',providerMessageId:'gmail-draft'})).rejects.toThrow('Historical provider draft requires review');expect(execute).not.toHaveBeenCalled();
});
it('keeps the original binding on reapproval and rejects a different recorded owner',async()=>{vi.stubEnv('COMMUNICATIONS_RUNTIME_ENABLED','true');const execute=vi.fn().mockResolvedValue({rows:[{owner_user_id:'owner',backend:'unipile',authority:'service',recovery_only:false}]});await snapshotApprovedDraftBinding({execute} as never,{organizationId:'org',userId:'owner'},{id:'draft',providerMessageId:null});expect(execute).toHaveBeenCalledOnce();execute.mockResolvedValue({rows:[{owner_user_id:'other',backend:'unipile',authority:'service',recovery_only:false}]});await expect(snapshotApprovedDraftBinding({execute} as never,{organizationId:'org',userId:'owner'},{id:'draft',providerMessageId:null})).rejects.toThrow('Original draft binding unavailable');});
