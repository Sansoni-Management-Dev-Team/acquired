/** Isolated local lane only. Uses private inherited environment; loads no env files. */
import{Pool}from'pg';
import{withBackgroundBudget}from'../src/lib/background-workload';
import{runLocalResearchMaintenance}from'../src/lib/local-research-maintenance';
async function main(){
 const env=process.env,actor={organizationId:env.LOCAL_RESEARCH_ORGANIZATION_ID??'',userId:env.LOCAL_RESEARCH_OWNER_USER_ID??''};
 if(env.NODE_ENV!=='development'||env.LOCAL_DEVELOPMENT!=='true'||env.LOCAL_RESEARCH_MAINTENANCE_ENABLED!=='true')throw Error('local_research_maintenance_disabled');
 const url=new URL(env.DATABASE_URL??'');
 if(!['postgres:','postgresql:'].includes(url.protocol)||url.hostname!=='127.0.0.1'||url.port!=='5437'||url.pathname!=='/acquire_agent_mode')throw Error('local_research_database_endpoint_mismatch');
 const pool=new Pool({connectionString:env.DATABASE_URL,max:1,connectionTimeoutMillis:4000,idleTimeoutMillis:5000,statement_timeout:10000});
 let stopped=false;process.once('SIGTERM',()=>{stopped=true;});process.once('SIGINT',()=>{stopped=true;});
 try{do{
  try{const recovered=await withBackgroundBudget('research.local-maintenance',15000,()=>runLocalResearchMaintenance(env,actor,{query:(sql,values)=>pool.query(sql,values),recover:async(...args)=>{const{recoverMandateResearch}=await import('../src/lib/research-maintenance');return recoverMandateResearch(...args);},resume:async(scope,id)=>{const[{resumeAcquisitionWorkflow},{agentPool}]=await Promise.all([import('../src/lib/acquisition-workflow'),import('../src/lib/agent-runtime')]);return resumeAcquisitionWorkflow(agentPool(),scope,id);}}));console.info('local-research-maintenance',JSON.stringify({event:'pass_complete',recovered,timestamp:new Date().toISOString()}));}
  catch{console.info('local-research-maintenance',JSON.stringify({event:'pass_failed',timestamp:new Date().toISOString()}));}
  if(process.argv.includes('--once')||stopped)break;
  await new Promise(resolve=>setTimeout(resolve,30000));
 }while(!stopped);}finally{await pool.end();}
}
main().catch(()=>{console.error('local-research-maintenance startup refused');process.exitCode=1;});
