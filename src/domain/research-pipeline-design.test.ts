import {expect,it} from 'vitest';
import type {ResearchConfig} from './research';
import {selectedResearchPipeline,isFirmableCompanyRoot} from './research-pipeline-design';
const config={workflow:'business',mode:'automatic',discover:true,strategy:'discover',pipelineDesign:'firmable-v1',researchRunId:'root'} as ResearchConfig;
it('enables production D for automatic company discovery',()=>expect(selectedResearchPipeline(config,'firmable-v1',false)).toBe('firmable-v1'));
it('retains the original production pipeline when unset or rolled back',()=>{expect(selectedResearchPipeline(config,undefined,false)).toBeUndefined();expect(selectedResearchPipeline(config,'legacy',false)).toBeUndefined();});
it('does not enable experimental B or C in production',()=>{for(const d of ['balanced-v1','corpus-v1'])expect(selectedResearchPipeline(config,d,false)).toBeUndefined();});
it('preserves local B/C/D switches',()=>{for(const d of ['balanced-v1','corpus-v1','firmable-v1'])expect(selectedResearchPipeline(config,d,true)).toBe(d);});
it('keeps manual, people and explicit source research on the original production path',()=>{for(const change of [{mode:'manual'},{workflow:'people'},{discover:false},{strategy:'investigate'}])expect(selectedResearchPipeline({...config,...change} as ResearchConfig,'firmable-v1',false)).toBeUndefined();});
it('routes only the snapshotted company root through D',()=>{expect(isFirmableCompanyRoot(config,'root')).toBe(true);expect(isFirmableCompanyRoot(config,'child')).toBe(false);expect(isFirmableCompanyRoot({...config,purpose:'people'},'root')).toBe(false);expect(isFirmableCompanyRoot({...config,pipelineDesign:undefined},'root')).toBe(false);});

it('enables E and F in production for automatic business discovery and retains local switches',()=>{for(const d of ['web-firmable-v1','hybrid-firmable-v1']){expect(selectedResearchPipeline(config,d,true)).toBe(d);expect(selectedResearchPipeline(config,d,false)).toBe(d);for(const change of [{mode:'manual'},{workflow:'people'},{discover:false},{strategy:'investigate'},{purpose:'people'}])expect(selectedResearchPipeline({...config,...change} as ResearchConfig,d,false)).toBeUndefined();}});
