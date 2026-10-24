/** Isolated local lane only. Uses private inherited environment; loads no env files. */
import{Pool}from'pg';
import{safeResearchFailure}from'../src/domain/research-trace-context';
import{withBackgroundBudget}from'../src/lib/background-workload';
import{runLocalResearchMaintenance}from'../src/lib/local-research-maintenance';
async function main(){
 const env=process.env,actor={organizationId:env.LOCAL_RESEARCH_ORGANIZATION_ID??'',userId:env.LOCAL_RESEARCH_OWNER_USER_ID??''};
 if(env.NODE_ENV!=='development'||env.LOCAL_DEVELOPMENT!=='true'||env.LOCAL_RESEARCH_MAINTENANCE_ENABLED!=='true')throw Error('local_research_maintenance_disabled');
 const url=new URL(env.DATABASE_URL??'');
 if(!['postgres:','postgresql:'].includes(url.protocol)||url.hostname!=='127.0.0.1'||url.port!=='5437'||url.pathname!=='/acquire_agent_mode')throw Error('local_research_database_endpoint_mismatch');
 const pool=new Pool({connectionString:env.DATABASE_URL,max:1,connectionTimeoutMillis:4000,idleTimeoutMillis:5000,statement_timeout:10000});
 let stopped=false;process.once('SIGTERM',()=>{stopped=true;});process.once('SIGINT',()=>{stopped=true;});
 let stage='scope',cursor='00000000-0000-0000-0000-000000000000';
 try{do{
  try{const recovered=await withBackgroundBudget('research.local-maintenance',15000,()=>runLocalResearchMaintenance(env,actor,{query:(sql,values)=>pool.query(sql,values),recover:async(...args)=>{stage='load_recovery';const{recoverMandateResearch}=await import('../src/lib/research-maintenance');stage='recover';return recoverMandateResearch(...args);},resume:async(scope,id)=>{stage='load_projection';const[{resumeAcquisitionWorkflow},{agentPool}]=await Promise.all([import('../src/lib/acquisition-workflow'),import('../src/lib/agent-runtime')]);stage='projection';return resumeAcquisitionWorkflow(agentPool(),scope,id);},report:({executionId,error})=>{cursor=executionId;console.info('local-research-maintenance',JSON.stringify({event:error?'scope_failed':'scope_complete',executionId,stage,...(error?safeResearchFailure(error):{})}));}},cursor));console.info('local-research-maintenance',JSON.stringify({event:'pass_complete',recovered,timestamp:new Date().toISOString()}));}
  catch(error){console.info('local-research-maintenance',JSON.stringify({event:'pass_failed',stage,timestamp:new Date().toISOString(),...safeResearchFailure(error),cause:safeResearchFailure((error as {cause?:unknown})?.cause),sqlState:/^[0-9A-Z]{5}$/.test(String((error as {cause?:{code?:string}})?.cause?.code))?(error as {cause:{code:string}}).cause.code:undefined}));}
  if(process.argv.includes('--once')||stopped)break;
  await new Promise(resolve=>setTimeout(resolve,30000));
 }while(!stopped);}finally{await pool.end();}
}
main().catch(()=>{console.error('local-research-maintenance startup refused');process.exitCode=1;});
