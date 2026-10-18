import {expect,it,vi} from 'vitest';
import {agentDriverAllowed} from './agent-driver-admission';
const actor={organizationId:'org',userId:'user'},source={contactId:'contact',address:'person@example.invalid',kind:'campaign' as const,sourceRef:'enrolment'};
it('preserves old sequence execution when the optional native schema is absent',async()=>{
 const query=vi.fn().mockResolvedValue({rows:[{installed:false}]});expect(await agentDriverAllowed({query},actor,source)).toBe(true);expect(query).toHaveBeenCalledTimes(1);
});
it('requires the native schema for agent effects',async()=>{
 const query=vi.fn().mockResolvedValue({rows:[{installed:false}]});expect(await agentDriverAllowed({query},actor,{...source,kind:'agent',epoch:1})).toBe(false);
});
it('checks the actual recorded driver under current server scope',async()=>{
 const query=vi.fn().mockResolvedValueOnce({rows:[{installed:true}]}).mockResolvedValueOnce({rows:[{allowed:false}]});
 expect(await agentDriverAllowed({query},actor,source)).toBe(false);expect(query.mock.calls[1][1]).toEqual(['org','user','contact','person@example.invalid','campaign','enrolment',null]);
});
it.each([[],[{allowed:null}],[{allowed:'true'}],[{allowed:true},{allowed:true}]].map(rows=>({rows})))('does not treat a malformed driver proof as permission %#',async({rows})=>{
 const query=vi.fn().mockResolvedValueOnce({rows:[{installed:true}]}).mockResolvedValueOnce({rows});expect(await agentDriverAllowed({query},actor,source)).toBe(false);
});
