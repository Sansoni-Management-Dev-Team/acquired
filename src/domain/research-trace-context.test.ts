import {expect,it} from 'vitest';
import {researchTraceHeaders,researchTraceRequestHeaders,safeResearchFailure,safeResearchTrace} from './research-trace-context';
it('accepts diagnostic IDs without deriving native admission authority',()=>{
 const result=researchTraceHeaders(new Headers({'x-acquire-research-job':'job-123','x-request-id':'request-123','x-acquire-research-call':'call-123','x-acquire-native-research-job':'not-a-trace','x-acquire-native-research-key':'authority'}));
 expect(result).toEqual({jobId:'job-123',requestId:'request-123',logicalCallId:'call-123'});
 expect(safeResearchTrace({jobId:'private person@example.com',requestId:'https://secret.example/token',logicalCallId:'x'.repeat(101)})).toEqual({});
});
it('logs only recognized error names and bounded SQLSTATE codes, never private errors',()=>{
 expect(safeResearchFailure(Object.assign(new Error('PRIVATE SQL'),{name:'PRIVATE_TOKEN',code:'secret-token',cause:{code:'57014',message:'PRIVATE credential'}}))).toEqual({errorName:'Error',databaseCode:'57014'});
 expect(safeResearchFailure({name:'PostgresError',code:'40P01'})).toEqual({errorName:'PostgresError',databaseCode:'40P01'});
 expect(safeResearchFailure({name:'Error',code:'private_key'})).toEqual({errorName:'Error'});
});
it('round-trips bounded mandate/run/operation diagnostics without carrying malformed IDs or native authority',()=>{
 const context={jobId:'job-123',requestId:'request-123',logicalCallId:'call-123',mandateId:'mandate-123',runId:'run-123',operationId:'operation-123'},headers=researchTraceRequestHeaders(context);
 expect(headers).toEqual({'x-acquire-research-job':'job-123','x-request-id':'request-123','x-acquire-research-call':'call-123','x-acquire-mandate-id':'mandate-123','x-acquire-research-run':'run-123','x-acquire-agent-operation':'operation-123'});expect(researchTraceHeaders(new Headers({...headers,'x-acquire-native-research-key':'private-authority'}))).toEqual(context);
 expect(researchTraceRequestHeaders({mandateId:'person@example.com',runId:'https://private.invalid/run',operationId:'x'.repeat(101)})).toEqual({});expect(researchTraceHeaders(new Headers({'x-acquire-mandate-id':'private; token','x-acquire-research-run':'run-1','x-acquire-agent-operation':'operation-1'}))).toEqual({runId:'run-1',operationId:'operation-1'});
});
