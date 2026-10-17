import{z}from'zod';
export const agentChannelRelationshipSchema=z.object({status:z.enum(['connected','invitation_pending','not_connected','unknown']),canMessage:z.boolean().nullable(),observedAt:z.iso.datetime()}).strict().superRefine((v,c)=>{if(v.status==='connected'&&v.canMessage!==true||v.status==='invitation_pending'&&v.canMessage!==false||v.status==='not_connected'&&v.canMessage===true||v.status==='unknown'&&v.canMessage!==null)c.addIssue({code:'custom',message:'Exact trusted relationship capability required'});});
export type AgentChannelRelationship=z.infer<typeof agentChannelRelationshipSchema>;
export type AgentInvitationDelivery={status:'submitted';effect:'invitation';providerOperationId:string;submittedAt:string;intentId:string};
