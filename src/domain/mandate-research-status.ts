import {z} from 'zod';

export const mandateResearchStatusSchema=z.enum(['not_started','queued','running','complete','partial','failed','cancelled']);
export type MandateResearchStatus=z.infer<typeof mandateResearchStatusSchema>;
export const mandateResearchStatusLabels:Record<MandateResearchStatus,string>={
  not_started:'Not started',queued:'Queued',running:'Researching',complete:'Complete',partial:'Partial',failed:'Failed',cancelled:'Cancelled',
};

type ResearchSummary={
  status:string|null;queued:number;active:number;partial:number;failed:number;cancelled:number;
  people?:{settled?:boolean;active?:number;queued?:number;cancelled?:number;admissionIncomplete?:number}|null;
};

/** A finished discovery job does not mean its enrichment children are finished. */
export function mandateResearchStatus(summary:ResearchSummary):MandateResearchStatus{
  if(!summary.status)return 'not_started';
  if(summary.status==='cancelled')return 'cancelled';
  const peoplePending=summary.people?.settled===false;
  if(summary.active>0||peoplePending||!['queued','complete','partial','failed'].includes(summary.status))return 'running';
  if(summary.queued>0)return summary.status==='queued'?'queued':'running';
  if(summary.status==='queued')return 'queued';
  if(summary.status==='failed')return 'failed';
  if(summary.status==='partial'||summary.partial>0||summary.failed>0||summary.cancelled>0||
    (summary.people?.cancelled||0)>0||(summary.people?.admissionIncomplete||0)>0)return 'partial';
  return 'complete';
}
