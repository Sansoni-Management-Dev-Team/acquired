import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {writeFileSync,appendFileSync,chmodSync} from 'node:fs';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {validateResearchReleaseContext} from './aws-research-release.mjs';

const stack=fileURLToPath(new URL('../ops/aws/research/terraform/',import.meta.url));
const region='ap-southeast-2',account='352329340196',repository='acquire-acquire-develop';
const types=new Set(['aws_cloudwatch_log_group','aws_ecs_service','aws_ecs_task_definition','aws_iam_role','aws_iam_role_policy','aws_secretsmanager_secret','aws_security_group','aws_service_discovery_private_dns_namespace','aws_service_discovery_service','aws_vpc_security_group_egress_rule','aws_vpc_security_group_ingress_rule']);
export function reviewResearchPlan(plan){
  assert.equal(plan.errored||false,false);
  for(const resource of plan.resource_changes||[]){
    if(resource.mode!=='managed')continue;
    assert.ok(types.has(resource.type),'Research stack cannot own unrelated resource types');
    const actions=resource.change.actions;
    if(actions.includes('delete'))assert.ok(resource.type==='aws_ecs_task_definition'&&actions.includes('create'),'Only a new task revision may replace a resource');
    if(resource.type==='aws_ecs_service'&&actions.includes('create'))assert.equal(resource.change.after.desired_count,0,'Initial provisioning must not start a task');
    if(resource.type==='aws_ecs_service')assert.equal(resource.change.after.network_configuration[0].assign_public_ip,false);
  }
}
const command=(name,args,options={})=>execFileSync(name,args,{cwd:stack,encoding:'utf8',stdio:['ignore','pipe','pipe'],...options});
const aws=(...args)=>JSON.parse(command('aws',[...args,'--region',region,'--output','json','--no-cli-pager']));
async function provision(){
  const sha=validateResearchReleaseContext(process.env);
  assert.equal(aws('sts','get-caller-identity').Account,account);
  const variables=Object.fromEntries(['research','reader'].map(name=>{
    const digest=aws('ecr','describe-images','--repository-name',repository,'--image-ids',`imageTag=${name}-${sha}`).imageDetails[0].imageDigest;
    assert.match(digest,/^sha256:[a-f0-9]{64}$/);
    return [name+'_image',`${account}.dkr.ecr.${region}.amazonaws.com/${repository}@${digest}`];
  }));
  writeFileSync(stack+'input-images.auto.tfvars.json',JSON.stringify(variables),{mode:0o600});
  command('terraform',['init','-input=false','-lockfile=readonly'],{stdio:'inherit'});
  command('terraform',['plan','-input=false','-out=research.tfplan'],{stdio:'inherit'});
  chmodSync(stack+'research.tfplan',0o600);
  reviewResearchPlan(JSON.parse(command('terraform',['show','-json','research.tfplan'])));
  command('terraform',['apply','-input=false','research.tfplan'],{stdio:'inherit'});
  const output=JSON.parse(command('terraform',['output','-json','research']));
  if(process.env.GITHUB_OUTPUT)appendFileSync(process.env.GITHUB_OUTPUT,`base_task_definition=${output.base_task_definition}\n`);
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)await provision();
