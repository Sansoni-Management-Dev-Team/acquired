import type {ResearchConfig} from './research';
/** Server-selected design is snapshotted on each root; environment rollback affects new runs only. */
export function selectedResearchPipeline(config:ResearchConfig,configured:string|undefined,local:boolean):ResearchConfig['pipelineDesign']{
 if(local&&['balanced-v1','corpus-v1','firmable-v1','web-firmable-v1','hybrid-firmable-v1'].includes(configured||''))return configured as ResearchConfig['pipelineDesign'];
 if(['firmable-v1','web-firmable-v1','hybrid-firmable-v1'].includes(configured||'')&&config.mode==='automatic'&&config.workflow==='business'&&config.discover&&config.strategy!=='investigate'&&!config.purpose)return configured as ResearchConfig['pipelineDesign'];
 return undefined;
}
export function isFirmableCompanyRoot(config:ResearchConfig,id:string){return config.pipelineDesign==='firmable-v1'&&config.researchRunId===id&&config.mode==='automatic'&&config.workflow==='business'&&!config.purpose;}

export function isWebFirmableRoot(config:ResearchConfig,id:string){return config.pipelineDesign==='web-firmable-v1'&&config.researchRunId===id&&config.mode==='automatic'&&config.workflow==='business'&&!config.purpose;}

export function isHybridCompanyRoot(config:ResearchConfig,id:string){return config.pipelineDesign==='hybrid-firmable-v1'&&config.researchRunId===id&&config.mode==='automatic'&&config.workflow==='business'&&!config.purpose;}
