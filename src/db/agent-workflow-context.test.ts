import {expect,it,vi} from 'vitest';
import {bindAgentWorkflowContext,resolveAgentWorkflowContext} from './agent-workflow-context';
const actor={organizationId:'org',userId:'owner'},id='00000000-0000-4000-8000-000000000001',mandate='00000000-0000-4000-8000-000000000002';
it('binds the exact persisted execution with actor and mandate validation',async()=>{
 const query=vi.fn().mockResolvedValueOnce({rows:[{id,organization_id:'org',owner_user_id:'owner',mandate_id:mandate,preset:'demo'}]}).mockResolvedValue({rows:[]});
 await bindAgentWorkflowContext({query},actor,id,mandate);
 expect(query.mock.calls[0][1]).toEqual([id,'org','owner',mandate]);
 expect(query.mock.calls[1][1]).toEqual([id]);
});
it('does not substitute a later execution when the original is missing',async()=>{
 const query=vi.fn().mockResolvedValue({rows:[]});
 await expect(bindAgentWorkflowContext({query},actor,id,mandate)).rejects.toThrow('Original workflow execution unavailable');expect(query).toHaveBeenCalledTimes(1);
});
it('explicit legacy context clears execution rather than selecting current workflow',async()=>{
 const query=vi.fn().mockResolvedValue({rows:[]});await bindAgentWorkflowContext({query},actor,null,mandate);
 expect(query).toHaveBeenCalledTimes(1);expect(query.mock.calls[0][1]).toEqual(['']);
});
it('new mandate commands can discover an owned workflow without changing stored identities',async()=>{
 const query=vi.fn().mockResolvedValueOnce({rows:[{installed:true}]}).mockResolvedValueOnce({rows:[{id}]}).mockResolvedValueOnce({rows:[{id,organization_id:'org',owner_user_id:'owner',mandate_id:mandate}]}).mockResolvedValue({rows:[]});
 expect(await resolveAgentWorkflowContext({query},actor,mandate)).toBe(id);
 expect(query.mock.calls.every(([sql])=>!/^\s*(INSERT|UPDATE|DELETE)/.test(sql))).toBe(true);
});
it('legacy schema has no new relation lookup',async()=>{
 const query=vi.fn().mockResolvedValue({rows:[{installed:false}]});expect(await resolveAgentWorkflowContext({query},actor,mandate)).toBeNull();expect(query).toHaveBeenCalledTimes(1);
});
