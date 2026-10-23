import {expect,it} from 'vitest';
import {runHybridCompanyPipeline} from './hybrid-company-pipeline';
import {runFirmableCompanyPipeline} from './firmable-company-pipeline';
import {runWebFirmablePipeline} from './web-firmable-pipeline';
const rows=[1,2,3].map(id=>({id:`f${id}`,name:`Company${id}`,website:`https://company${id}.com`}));
const outcomes=[{ok:true,saved:true,matched:true},{ok:true,saved:false,identityReviewRequired:true},{ok:true,saved:false,skipped:true}];
const checkpoint=async<T>(_name:string,work:()=>Promise<T>)=>work();
const options={deadline:1000,maxCompanies:3,concurrency:1};
it.each(['hybrid','firmable','web'] as const)('counts pending identity reviews and skips separately from persisted companies in %s',async lane=>{
 const inputs=structuredClone(outcomes);let i=0;
 const next=async()=>inputs[i++];
 const common={checkpoint,now:()=>0,profile:next,finish:async()=>{},control:async()=>true};
 const page={records:rows,totalCompany:3,predictedFilters:{filters:{},operators:{},excluded:{}}};
 const result=lane==='hybrid'?await runHybridCompanyPipeline({...common,plan:async()=>[],firmableSearch:async()=>page,webSearch:async()=>({rows:[],ok:true})},options):lane==='firmable'?await runFirmableCompanyPipeline({...common,search:async()=>page},{...options,pageSize:100}):await runWebFirmablePipeline({...common,plan:async()=>[{query:'Services',page:1}],search:async()=>({rows:rows.map(row=>({domain:new URL(row.website).hostname,name:row.name,website:row.website,discovery:{title:row.name,url:row.website,snippet:'Services'}})),ok:true})},options);
 expect(result).toMatchObject({saved:1,failed:0,identityReviewRequired:1,skipped:1});if('unprocessed'in result)expect(result.unprocessed).toBe(0);
});
