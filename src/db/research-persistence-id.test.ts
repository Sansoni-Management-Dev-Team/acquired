import {expect,it} from 'vitest';
import {researchTargetId,researchContactId} from './research-persistence-id';
it('uses stable company IDs across callback retries and isolates organizations',()=>{
 expect(researchTargetId('org','www.Example.com')).toBe(researchTargetId('org','example.com'));
 expect(researchTargetId('org','example.com')).not.toBe(researchTargetId('other','example.com'));
});
it('normalizes contact names while retaining target and organization boundaries',()=>{
 expect(researchContactId('org','target',' Alex  Owner ')).toBe(researchContactId('org','target','alex owner'));
 expect(researchContactId('org','target','alex owner')).not.toBe(researchContactId('org','other','alex owner'));
});
