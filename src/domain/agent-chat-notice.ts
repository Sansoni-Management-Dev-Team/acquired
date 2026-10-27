export const contactChannelReviewedNotice='You reviewed a person’s exact channel and account. Provider identity and full history must still be verified before outreach.';
export type AgentNoticeKind='welcome'|'setup_activity'|'contact_channel_reviewed'|'routine_activity'|'review_decision'|'lead_update';
export type AgentLeadUpdate={id:string;name:string;company?:string;kind:'reply'|'draft'|'attention'|'status';reply?:{text:string;channel:'email'|'whatsapp'|'linkedin';at:string}};
