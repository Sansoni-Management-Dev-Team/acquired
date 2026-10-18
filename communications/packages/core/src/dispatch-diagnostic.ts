export type DispatchDiagnosticStage='coordinator.claim'|'coordinator.record'|'coordinator.ready'|'coordinator.preflight'|'coordinator.begin'|'coordinator.admitted_record'|'coordinator.persist'|'admission.open'|'admission.permit'|'admission.service_commit'|'admission.app_commit'|'application.session'|'application.commit'|'application.binding'|'application.source'|'application.intent'|'application.coverage'|'application.policy'|'application.permit'|'service.grant'|'service.generation'|'service.sql';
export type DispatchDiagnostic={stage:DispatchDiagnosticStage;outcome:'error'|'blocked';sqlState?:'40001'|'40P01'|'55P03'|'57014'|'42501'};
export type DispatchDiagnosticPort=(event:DispatchDiagnostic)=>void;
/** Fixed metadata only. Never read error messages/details, query values or getters.
 * Diagnostics cannot change admission outcomes, even if a logger fails. */
export function reportDispatchDiagnostic(port:DispatchDiagnosticPort|undefined,stage:DispatchDiagnosticStage,outcome:'error'|'blocked',error?:unknown){
 if(!port)return;let code:unknown;try{if(error&&typeof error==='object'){const d=Object.getOwnPropertyDescriptor(error,'code');if(d&&'value'in d)code=d.value;}}catch{/*opaque errors remain private*/}
 const sqlState=typeof code==='string'&&['40001','40P01','55P03','57014','42501'].includes(code)?code as DispatchDiagnostic['sqlState']:undefined;
 try{port({stage,outcome,...(sqlState?{sqlState}:{})});}catch{/*no authority/effect changes from logging*/}
}
