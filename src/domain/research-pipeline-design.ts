import type {ResearchConfig} from './research';
/** Server-selected design is snapshotted on each root; environment rollback affects new runs only. */
export function selectedResearchPipeline(config:ResearchConfig,configured:string|undefined,local:boolean):ResearchConfig['pipelineDesign']{
 if(local&&['balanced-v1','corpus-v1','firmable-v1'].includes(configured||''))return configured as ResearchConfig['pipelineDesign'];
 if(configured==='firmable-v1'&&config.mode==='automatic'&&config.workflow==='business'&&config.discover&&config.strategy!=='investigate')return 'firmable-v1';
 return undefined;
}
export function isFirmableCompanyRoot(config:ResearchConfig,id:string){return config.pipelineDesign==='firmable-v1'&&config.researchRunId===id&&config.mode==='automatic'&&config.workflow==='business'&&!config.purpose;}
