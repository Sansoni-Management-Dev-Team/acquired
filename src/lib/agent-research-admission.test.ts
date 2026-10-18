import {it,expect} from 'vitest';
import {nativeResearchProviderAdmissionRequired} from './agent-research-admission';
it('blocks native roots and descendants even if provenance is malformed or omitted from child config',()=>{
 for(const nativeAgent of [null,false,{}, {version:1,providerAdmission:'required'}, {version:1,providerAdmission:'allow'}]){
  expect(nativeResearchProviderAdmissionRequired({nativeAgent})).toBe(true);
  expect(nativeResearchProviderAdmissionRequired({researchRunId:'parent'},{nativeAgent})).toBe(true);
 }
});
it('does not change original UI research admission',()=>{
 for(const config of [undefined,{}, {mode:'automatic'}, {researchRunId:'old-root'}])expect(nativeResearchProviderAdmissionRequired(config,{})).toBe(false);
});
