import {test} from 'node:test';
import assert from 'node:assert/strict';
import {prepareResearchTask,validateResearchService} from './aws-research-release.mjs';
const registry='352329340196.dkr.ecr.ap-southeast-2.amazonaws.com/acquire-acquire-develop';
const images={research:registry+'@sha256:'+'a'.repeat(64),reader:registry+'@sha256:'+'b'.repeat(64)};
const secret='arn:aws:secretsmanager:ap-southeast-2:352329340196:secret:acquire-research-develop-example';
const task=()=>({family:'acquire-research-develop',networkMode:'awsvpc',requiresCompatibilities:['FARGATE'],runtimePlatform:{cpuArchitecture:'X86_64',operatingSystemFamily:'LINUX'},cpu:'2048',memory:'8192',executionRoleArn:'arn:aws:iam::352329340196:role/research-execution',taskRoleArn:'arn:aws:iam::352329340196:role/research',volumes:[],containerDefinitions:[
 {name:'research',image:'old',essential:true,command:['node','dist/server.mjs'],environment:[{name:'RESEARCH_DEPLOYMENT',value:'aws-uat'},{name:'RESEARCH_APP_ORIGIN',value:'http://127.0.0.1:3100'}],secrets:['RESEARCH_DATABASE_URL','RESEARCH_SERVICE_SECRET','OPENAI_API_KEY'].map(name=>({name,valueFrom:secret+':'+name+'::'})),stopTimeout:120,healthCheck:{command:['CMD','node','-e','process.exit(0)']}},
 {name:'callback',image:'old',essential:true,command:['node','dist/aws-relay.mjs'],environment:[{name:'RESEARCH_DEPLOYMENT',value:'aws-uat'}],secrets:[{name:'RESEARCH_SERVICE_SECRET',valueFrom:secret+':RESEARCH_SERVICE_SECRET::'}]},
 {name:'reader',image:'old',essential:true,environment:[{name:'CRAWL4AI_PORT',value:'18083'}]},
 {name:'search',image:'karust/openserp@sha256:'+'c'.repeat(64),essential:true,command:['serve','-a','127.0.0.1','-p','7000']},
 ]});
test('research rollout preserves complete owner configuration and pins only worker, relay and reader images',()=>{
 const original=task();original.taskDefinitionArn='read-only metadata';original.revision=1;
 const result=prepareResearchTask(original,images);
 assert.equal(result.containerDefinitions[0].image,images.research);
 assert.equal(result.containerDefinitions[1].image,images.research);
 assert.equal(result.containerDefinitions[2].image,images.reader);
 assert.equal(result.containerDefinitions[3].image,original.containerDefinitions[3].image);
 assert.deepEqual(result.volumes,[]);assert.deepEqual(result.containerDefinitions[0].secrets,original.containerDefinitions[0].secrets);
 assert.equal(result.taskDefinitionArn,undefined);assert.equal(original.containerDefinitions[0].image,'old');
});
test('release rejects wrong scope, missing sidecars/secrets, plaintext credentials and mutable images',()=>{
 for(const change of [t=>t.family='acquire-n8n-develop',t=>t.containerDefinitions.pop(),t=>t.containerDefinitions[0].secrets.pop(),t=>t.containerDefinitions[0].environment.push({name:'RESEARCH_DATABASE_URL',value:'private'}),t=>t.containerDefinitions[1].command=['sh','-c','migrate'],t=>t.containerDefinitions[0].environment[0].value='local']){
   const value=task();change(value);assert.throws(()=>prepareResearchTask(value,images));
 }
 assert.throws(()=>prepareResearchTask(task(),{...images,research:registry+':latest'}));
});
test('single-worker service refuses overlap, other services and an active rollout',()=>{
 const service={serviceName:'acquire-research-develop',deploymentController:{type:'ECS'},deploymentConfiguration:{minimumHealthyPercent:0,maximumPercent:100},desiredCount:1,runningCount:1,pendingCount:0,deployments:[{status:'PRIMARY',rolloutState:'COMPLETED'}]};
 assert.doesNotThrow(()=>validateResearchService(service));
 for(const change of [{serviceName:'acquire-acquire-develop'},{desiredCount:2},{pendingCount:1},{deploymentConfiguration:{minimumHealthyPercent:100,maximumPercent:200}},{deployments:[{rolloutState:'IN_PROGRESS'}]}])assert.throws(()=>validateResearchService({...service,...change}));
});
