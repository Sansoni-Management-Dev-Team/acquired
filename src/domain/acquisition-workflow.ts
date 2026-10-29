import {z} from 'zod';
import {briefSchema} from './acquisition';

export const acquisitionWorkflowPresetSchema=z.enum(['demo','live-research-test','live']);
export type AcquisitionWorkflowPreset=z.infer<typeof acquisitionWorkflowPresetSchema>;
export type AcquisitionWorkflowState='accepted'|'researching'|'ready'|'outreach'|'complete'|'failed'|'cancelled'|'uncertain';
export type AcquisitionWorkflowExecution={
 id:string;mandateId:string;organizationId:string;ownerUserId:string;
 preset:AcquisitionWorkflowPreset;presentation:'agent'|'workspace';
 state:AcquisitionWorkflowState;revision:number;errorCode?:string|null;replayed?:boolean;
};
export function workflowPolicy(preset:AcquisitionWorkflowPreset){
 return {demo:{research:'saved',outreach:'simulated'},'live-research-test':{research:'live',outreach:'disabled'},live:{research:'live',outreach:'live'}}[preset] as {research:'saved'|'live';outreach:'simulated'|'disabled'|'live'};
}
export const acquisitionWorkflowStartSchema=z.object({
 requestId:z.string().uuid(),preset:acquisitionWorkflowPresetSchema,presentation:z.enum(['agent','workspace']),
 brief:briefSchema.optional(),mandateId:z.string().uuid().optional(),expectedMandateRevision:z.string().regex(/^\d{1,30}$/).optional(),
}).strict().superRefine((v,ctx)=>{
 if(v.preset==='demo'){
  if(v.brief||v.mandateId||v.expectedMandateRevision)ctx.addIssue({code:'custom',message:'Demo automatically selects saved research.'});
 }else if(Boolean(v.brief)===Boolean(v.mandateId)||v.mandateId&&!v.expectedMandateRevision||v.brief&&v.expectedMandateRevision){
  ctx.addIssue({code:'custom',message:'Supply a brief or an existing mandate with its current revision.'});
 }
});
export type AcquisitionWorkflowStart=z.infer<typeof acquisitionWorkflowStartSchema>;
