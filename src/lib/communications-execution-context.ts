import{bindCommunicationsWorkflowContext}from'./communications-workflow-context';
import 'server-only';
import type{AcquireIntentSource,AcquireSendAdmissionOptions}from'./campaign-send-admission';
import{loadMandateExecutionContext}from'./mandate-execution-context';
/** The physical binding fixes the actor; source IDs are server-owned admitted
 * work. The caller supplies no mandate/mode/recipient or trusted boolean. */
export function communicationsExecutionContextLoader(actor:{organizationId:string;userId:string}):NonNullable<AcquireSendAdmissionOptions['loadExecutionContext']>{
 const owner=Object.freeze({...actor});
 return async(tx,source:AcquireIntentSource)=>{await bindCommunicationsWorkflowContext(tx,owner,source);return loadMandateExecutionContext(tx,{actor:owner,origin:source.kind==='agent'?{kind:'agent',operationId:source.operationId}:source.kind==='campaign'?{kind:'campaign',attemptId:source.attemptId,enrolmentId:source.enrolmentId}:{kind:'draft',messageId:source.messageId}});};
}
