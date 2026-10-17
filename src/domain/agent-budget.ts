import {z} from 'zod';
const id=z.string().trim().min(1).max(200),uint=z.string().regex(/^(0|[1-9]\d{0,14})$/);
const unit=z.enum(['usd_micro','calls','sends']);
const accountSchema=z.object({id,unit,cap:uint,spent:uint,reserved:uint,windowStart:z.string().datetime({offset:true}),windowEnd:z.string().datetime({offset:true})}).strict();
const requestSchema=z.object({operationId:id,accountId:id,unit,amount:uint.refine(value=>BigInt(value)>BigInt(0))}).strict();
const reservationSchema=requestSchema.extend({state:z.enum(['reserved','settled','uncertain','released']),actual:uint.optional(),resolutionId:id.optional(),evidenceDigest:z.string().regex(/^[a-f0-9]{64}$/).optional()}).strict();
export type AgentBudgetAccount=z.infer<typeof accountSchema>;
export type AgentBudgetRequest=z.infer<typeof requestSchema>;
export type AgentBudgetReservation=z.infer<typeof reservationSchema>;
function same(a:AgentBudgetRequest,b:AgentBudgetRequest){return a.operationId===b.operationId&&a.accountId===b.accountId&&a.amount===b.amount&&a.unit===b.unit;}
/** Evaluate inside the same short transaction that locks all shared accounts in
 * stable ID order and writes the reservation. This policy is not a money lock. */
export function reserveAgentBudget(rawAccount:AgentBudgetAccount,rawRequest:AgentBudgetRequest,now:string,rawPrior?:AgentBudgetReservation){
 const account=accountSchema.parse(rawAccount),request=requestSchema.parse(rawRequest);
 if(account.id!==request.accountId||account.unit!==request.unit)throw new Error('Budget account or unit differs');
 const instant=Date.parse(now),activeWindow=Number.isFinite(instant)&&instant>=Date.parse(account.windowStart)&&instant<Date.parse(account.windowEnd);
 if(rawPrior){const prior=reservationSchema.parse(rawPrior);if(!same(prior,request))throw new Error('Operation key reused with different budget reservation');if(['reserved','uncertain'].includes(prior.state)&&!activeWindow)throw new Error('Budget window expired; reconcile before reauthorising work');return {account,reservation:prior};}
 if(!activeWindow)throw new Error('Budget window is unavailable');
 const amount=BigInt(request.amount),reserved=BigInt(account.reserved),spent=BigInt(account.spent);
 if(spent+reserved+amount>BigInt(account.cap))throw new Error('Shared budget exhausted');
 return {account:{...account,reserved:(reserved+amount).toString()},reservation:{...request,state:'reserved' as const}};
}
export function settleAgentBudget(rawAccount:AgentBudgetAccount,rawReservation:AgentBudgetReservation,rawActual:string){
 const account=accountSchema.parse(rawAccount),reservation=reservationSchema.parse(rawReservation),actual=BigInt(uint.parse(rawActual));
 if(account.id!==reservation.accountId||account.unit!==reservation.unit)throw new Error('Budget scope differs');
 if(reservation.state==='settled'){
  if(reservation.actual!==actual.toString())throw new Error('Settlement replay has different usage');return {account,reservation,overrun:'0'};
 }
 if(!['reserved','uncertain'].includes(reservation.state))throw new Error('Budget reservation cannot be settled');
 const amount=BigInt(reservation.amount),reserved=BigInt(account.reserved);if(reserved<amount)throw new Error('Budget reservation accounting is inconsistent');
 // Record an observed overrun instead of hiding cost or dropping a receipt.
 return {account:{...account,reserved:(reserved-amount).toString(),spent:(BigInt(account.spent)+actual).toString()},reservation:{...reservation,state:'settled' as const,actual:actual.toString()},overrun:(actual>amount?actual-amount:BigInt(0)).toString()};
}
/** The caller must authenticate the provider's original no-submission proof;
 * neither a timeout nor a model's assertion is that proof. */
export function releaseAgentBudget(rawAccount:AgentBudgetAccount,rawReservation:AgentBudgetReservation,rawProof:{operationId:string;resolutionId:string;evidenceDigest:string}){
 const account=accountSchema.parse(rawAccount),reservation=reservationSchema.parse(rawReservation);
 const proof=z.object({operationId:id,resolutionId:id,evidenceDigest:z.string().regex(/^[a-f0-9]{64}$/)}).strict().parse(rawProof);
 if(proof.operationId!==reservation.operationId||account.id!==reservation.accountId||account.unit!==reservation.unit)throw new Error('No-submission proof scope differs');
 if(reservation.state==='released'){
  if(reservation.resolutionId!==proof.resolutionId||reservation.evidenceDigest!==proof.evidenceDigest)throw new Error('Different no-submission proof');return {account,reservation};
 }
 if(!['reserved','uncertain'].includes(reservation.state))throw new Error('A settled budget cannot be released');
 const amount=BigInt(reservation.amount),reserved=BigInt(account.reserved);if(reserved<amount)throw new Error('Budget reservation accounting is inconsistent');
 return {account:{...account,reserved:(reserved-amount).toString()},reservation:{...reservation,state:'released' as const,resolutionId:proof.resolutionId,evidenceDigest:proof.evidenceDigest}};
}
export function modelBudgetUpperBound(input:{maxInputTokens:number;maxOutputTokens:number;inputPriceMicroUsdPerMillion?:string;outputPriceMicroUsdPerMillion?:string;maxAttempts:number}){
 if(input.inputPriceMicroUsdPerMillion===undefined||input.outputPriceMicroUsdPerMillion===undefined)throw new Error('An approved token-price ceiling is required');
 const inTokens=z.number().int().min(1).max(1000000).parse(input.maxInputTokens),outTokens=z.number().int().min(1).max(64000).parse(input.maxOutputTokens),attempts=z.number().int().min(1).max(5).parse(input.maxAttempts);
 const value=BigInt(inTokens)*BigInt(uint.parse(input.inputPriceMicroUsdPerMillion))+BigInt(outTokens)*BigInt(uint.parse(input.outputPriceMicroUsdPerMillion));
 return (((value+BigInt(999999))/BigInt(1000000))*BigInt(attempts)).toString();
}
