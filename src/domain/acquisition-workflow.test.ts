import {describe,it,expect} from 'vitest';
import {acquisitionWorkflowStartSchema,workflowPolicy} from './acquisition-workflow';
const requestId='6b954126-cd24-4633-93f0-a9a3425069ec';
describe('fixed acquisition workflows',()=>{
 it('keeps research and delivery choices server owned',()=>{
  expect(workflowPolicy('demo')).toEqual({research:'saved',outreach:'simulated'});
  expect(workflowPolicy('live-research-test')).toEqual({research:'live',outreach:'disabled'});
  expect(workflowPolicy('live')).toEqual({research:'live',outreach:'live'});
  expect(acquisitionWorkflowStartSchema.safeParse({requestId,preset:'demo',presentation:'agent',outreach:'live'}).success).toBe(false);
 });
 it('accepts an automatic saved demo without a new brief',()=>expect(acquisitionWorkflowStartSchema.parse({requestId,preset:'demo',presentation:'workspace'}).preset).toBe('demo'));
 it('requires a live brief or exact existing source, never an empty paid search',()=>{
  expect(acquisitionWorkflowStartSchema.safeParse({requestId,preset:'live',presentation:'agent'}).success).toBe(false);
  expect(acquisitionWorkflowStartSchema.safeParse({requestId,preset:'live-research-test',presentation:'workspace',mandateId:requestId,expectedMandateRevision:'42'}).success).toBe(true);
  expect(acquisitionWorkflowStartSchema.safeParse({requestId,preset:'live',presentation:'agent',mandateId:requestId}).success).toBe(false);
 });
 it('rejects a client-selected source for automatic demo and malformed runtime choices',()=>{
  expect(acquisitionWorkflowStartSchema.safeParse({requestId,preset:'demo',presentation:'agent',mandateId:requestId}).success).toBe(false);
  expect(acquisitionWorkflowStartSchema.safeParse({requestId,preset:'test',presentation:'agent'}).success).toBe(false);
 });
});
