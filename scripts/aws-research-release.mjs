import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';

const account='352329340196',region='ap-southeast-2';
const repository='acquire-acquire-develop';
const registry=`${account}.dkr.ecr.${region}.amazonaws.com/${repository}`;
const serviceName='acquire-research-develop',cluster='acquire-acquire-develop';
const envValue=(container,name)=>container.environment?.find(item=>item.name===name)?.value;
export function validateResearchService(service){
  assert.equal(service.serviceName,serviceName);
  assert.equal(service.deploymentController?.type,'ECS');
  assert.ok([0,1].includes(service.desiredCount));
  assert.ok(service.runningCount<=1);assert.equal(service.pendingCount,0);
  assert.equal(service.deploymentConfiguration?.minimumHealthyPercent,0);
  assert.equal(service.deploymentConfiguration?.maximumPercent,100);
  assert.ok(service.deployments.length===1&&service.deployments[0].rolloutState==='COMPLETED','Drain/finish the existing rollout first');
}
export function prepareResearchTask(base,images){
  assert.equal(base.family,serviceName);assert.equal(base.networkMode,'awsvpc');
  assert.ok(base.requiresCompatibilities?.includes('FARGATE'));
  assert.equal(base.runtimePlatform?.cpuArchitecture,'X86_64');
  const result=structuredClone(base),containers=result.containerDefinitions;
  assert.deepEqual(containers.map(c=>c.name).sort(),['callback','reader','research','search']);
  for(const name of ['research','reader'])assert.match(images[name],new RegExp('^'+registry.replaceAll('.','\\.')+'@sha256:[a-f0-9]{64}$'));
  const worker=containers.find(c=>c.name==='research'),relay=containers.find(c=>c.name==='callback');
  assert.equal(envValue(worker,'RESEARCH_DEPLOYMENT'),'aws-uat');
  assert.equal(envValue(worker,'RESEARCH_APP_ORIGIN'),'http://127.0.0.1:3100');
  assert.equal(envValue(relay,'RESEARCH_DEPLOYMENT'),'aws-uat');
  assert.deepEqual(worker.command,['node','dist/server.mjs']);
  assert.deepEqual(relay.command,['node','dist/aws-relay.mjs']);
  assert.ok(worker.healthCheck);assert.ok(worker.stopTimeout>=20);
  for(const name of ['RESEARCH_DATABASE_URL','RESEARCH_SERVICE_SECRET','OPENAI_API_KEY']){
    assert.ok(envValue(worker,name)===undefined,'Credentials must use ECS secrets');
    assert.ok(worker.secrets?.some(s=>s.name===name&&s.valueFrom.startsWith(`arn:aws:secretsmanager:${region}:${account}:secret:`)));
  }
  assert.equal(relay.secrets?.find(s=>s.name==='RESEARCH_SERVICE_SECRET')?.valueFrom,worker.secrets.find(s=>s.name==='RESEARCH_SERVICE_SECRET').valueFrom);
  assert.ok(envValue(relay,'RESEARCH_SERVICE_SECRET')===undefined);
  assert.equal(envValue(containers.find(c=>c.name==='reader'),'CRAWL4AI_PORT'),'18083');
  assert.match(containers.find(c=>c.name==='search').image,/@sha256:[a-f0-9]{64}$/);
  assert.deepEqual(containers.find(c=>c.name==='search').command,['serve','-a','127.0.0.1','-p','7000']);
  for(const c of containers){
    assert.equal(c.essential,true);
    assert.equal(c.linuxParameters?.sharedMemorySize,undefined,'Fargate has no sharedMemorySize');
    assert.equal(c.linuxParameters?.tmpfs,undefined,'Fargate has no tmpfs');
    if(['research','callback'].includes(c.name))c.image=images.research;
    if(c.name==='reader')c.image=images.reader;
  }
  for(const key of ['taskDefinitionArn','revision','status','registeredAt','registeredBy','deregisteredAt','requiresAttributes','compatibilities'])delete result[key];
  return result;
}

function aws(...args){
  // Never echo CLI output or errors containing configuration/secrets.
  try{return JSON.parse(execFileSync('aws',[...args,'--region',region,'--output','json','--no-cli-pager'],{encoding:'utf8',stdio:['ignore','pipe','pipe'],timeout:15*60*1000}));}
  catch{throw Error(`AWS ${args[0]} ${args[1]} failed; inspect the deployment in AWS`);}
}
export function validateResearchReleaseContext(env){
  const sha=env.GITHUB_SHA;
  assert.match(sha||'',/^[a-f0-9]{40}$/);
  assert.equal(env.GITHUB_REPOSITORY,'Sansoni-Management-Dev-Team/acquired');
  assert.equal(env.GITHUB_REF,'refs/heads/test/deployment');
  assert.equal(env.GITHUB_EVENT_NAME,'push');
  return sha;
}
async function release(){
  const sha=validateResearchReleaseContext(process.env);
  assert.equal(aws('sts','get-caller-identity').Account,account);
  const current=aws('ecs','describe-services','--cluster',cluster,'--services',serviceName);
  assert.ok(!(current.failures?.length)&&current.services.length===1,'Research ECS service acquire-research-develop must exist before deployment');
  const service=current.services[0];validateResearchService(service);
  const images=Object.fromEntries(['research','reader'].map(name=>{
    const image=aws('ecr','describe-images','--repository-name',repository,'--image-ids',`imageTag=${name}-${sha}`).imageDetails[0];
    assert.match(image.imageDigest,/^sha256:[a-f0-9]{64}$/);
    return [name,registry+'@'+image.imageDigest];
  }));
  const baseArn=process.env.RESEARCH_BASE_TASK_DEFINITION||service.taskDefinition;
  assert.ok(baseArn.startsWith(`arn:aws:ecs:${region}:${account}:task-definition/${serviceName}:`));
  const base=aws('ecs','describe-task-definition','--task-definition',baseArn).taskDefinition;
  const task=prepareResearchTask(base,images);
  const registered=aws('ecs','register-task-definition','--cli-input-json',JSON.stringify(task)).taskDefinition.taskDefinitionArn;
  try{
    aws('ecs','update-service','--cluster',cluster,'--service',serviceName,'--task-definition',registered,'--desired-count','1');
    execFileSync('aws',['ecs','wait','services-stable','--cluster',cluster,'--services',serviceName,'--region',region],{stdio:['ignore','pipe','pipe'],timeout:15*60*1000});
    const after=aws('ecs','describe-services','--cluster',cluster,'--services',serviceName).services[0];
    assert.equal(after.taskDefinition,registered);assert.equal(after.runningCount,1);assert.equal(after.pendingCount,0);
    console.log('Research service is stable on the reviewed digest-pinned release. Run a scoped UAT canary before enabling app research.');
  }catch(error){
    const after=aws('ecs','describe-services','--cluster',cluster,'--services',serviceName).services[0];
    if(after.taskDefinition===registered){
      aws('ecs','update-service','--cluster',cluster,'--service',serviceName,'--task-definition',service.taskDefinition,'--desired-count',String(service.desiredCount));
      execFileSync('aws',['ecs','wait','services-stable','--cluster',cluster,'--services',serviceName,'--region',region],{stdio:['ignore','pipe','pipe'],timeout:15*60*1000});
    }
    throw error;
  }
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)await release();
