import {test} from 'node:test';
import assert from 'node:assert/strict';
import {reviewResearchPlan} from './aws-research-infrastructure.mjs';
const resource=(type,actions,after={})=>({mode:'managed',type,change:{actions,after}});
test('research infrastructure permits private zero-task provisioning and task revision replacement',()=>{
 assert.doesNotThrow(()=>reviewResearchPlan({resource_changes:[resource('aws_ecs_service',['create'],{desired_count:0,network_configuration:[{assign_public_ip:false}]}),resource('aws_ecs_task_definition',['create','delete'])]}));
});
test('infrastructure cannot create databases, expose/start initial tasks or destroy shared resources',()=>{
 for(const value of [resource('aws_rds_cluster',['create']),resource('postgresql_database',['create']),resource('aws_iam_role',['delete']),resource('aws_ecs_service',['create'],{desired_count:1,network_configuration:[{assign_public_ip:false}]}),resource('aws_ecs_service',['update'],{network_configuration:[{assign_public_ip:true}]})])assert.throws(()=>reviewResearchPlan({resource_changes:[value]}));
});
