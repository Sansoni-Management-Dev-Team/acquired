import type {ConnectionBinding,OperationSnapshot,SubmissionReceipt} from '../../communications/packages/contracts/src';
export type {MandateExecutionContext as MandateExecutionManifest} from './mandate-execution-context';
import type {MandateExecutionContext as MandateExecutionManifest} from './mandate-execution-context';
export type OriginalSubmissionSource={kind:'draft'|'campaign'|'agent';id:string};
export type SubmittedReceiptEvidence={version:1;intentId:string;source:OriginalSubmissionSource;bindingId:string;snapshot:OperationSnapshot;receipt:SubmissionReceipt;sourceDigest:string;executionContext:MandateExecutionManifest|null};
export type SubmittedReceiptResult={status:'unconfirmed'}|{status:'submitted';intentId:string;effect:'message'|'invitation';providerReference:string;submittedAt:string;originStatus:'sealed'|'legacy_unsealed';replayed:boolean};
export type OriginalSubmissionBinding={bindingId:string;binding:ConnectionBinding};
