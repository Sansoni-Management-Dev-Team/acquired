import {selectedResearchPipeline} from '@/domain/research-pipeline-design';
import type {ResearchConfig} from '@/domain/research';
export type NativeResearchEngineCapability={kind:'supported';productionPipeline:'firmable-v1'|'hybrid-firmable-v1';nativePipeline:'firmable-company-v1'|'hybrid-company-v1';missing:string[]}|{kind:'blocked';productionPipeline:string;missing:string[];message:string};
/** Use the same server selector as normal production research. This is a
 * capability report, not permission to run any additional provider path. */
export function nativeResearchEngineCapability(env:Record<string,string|undefined>=process.env):NativeResearchEngineCapability{
 const config={mode:'automatic',workflow:'business',discover:true,strategy:'discover'} as ResearchConfig;
 const productionPipeline=selectedResearchPipeline(config,env.RESEARCH_PIPELINE_DESIGN,env.LOCAL_DEVELOPMENT==='true')??'legacy-default';
 if(productionPipeline==='hybrid-firmable-v1')return {kind:'supported' as const,productionPipeline,nativePipeline:'hybrid-company-v1' as const,missing:[] as string[]};
 if(productionPipeline==='firmable-v1')return {kind:'supported' as const,productionPipeline,nativePipeline:'firmable-company-v1' as const,missing:[] as string[]};
 const missing=productionPipeline==='web-firmable-v1'?['native_web_search_physical_accounting','native_website_read_physical_accounting','native_background_model_accounting']:['native_selected_engine_physical_accounting'];
 return {kind:'blocked' as const,productionPipeline,missing,message:'The configured company research workflow is not ready in agent mode. You can run research from the main workspace. No new research was started.'};
}
export function requireNativeResearchEngine(env:Record<string,string|undefined>=process.env){
 const capability=nativeResearchEngineCapability(env);
 if(capability.kind!=='supported')throw new Error(capability.message);
 return capability;
}
