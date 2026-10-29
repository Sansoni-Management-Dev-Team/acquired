import{it,expect,vi}from'vitest';import{reportDispatchDiagnostic}from'./dispatch-diagnostic';
it('reports fixed stage and allowlisted SQLSTATE only; ignores messages, details, unknown codes and getters',()=>{const port=vi.fn();reportDispatchDiagnostic(port,'application.source','error',Object.assign(Error('secret body'),{code:'40001',detail:'secret token'}));expect(port).toHaveBeenLastCalledWith({stage:'application.source',outcome:'error',sqlState:'40001'});reportDispatchDiagnostic(port,'service.grant','error',{code:'private-provider-code',message:'secret'});expect(port).toHaveBeenLastCalledWith({stage:'service.grant',outcome:'error'});const getter=vi.fn(()=>{throw Error('secret');});reportDispatchDiagnostic(port,'service.sql','error',Object.defineProperty({},'code',{get:getter}));expect(getter).not.toHaveBeenCalled();expect(JSON.stringify(port.mock.calls)).not.toContain('secret');});
it('does not alter control flow if diagnostics are disabled or the logger fails',()=>{expect(()=>reportDispatchDiagnostic(undefined,'service.generation','blocked')).not.toThrow();expect(()=>reportDispatchDiagnostic(()=>{throw Error('logging failed');},'application.permit','error',{code:'40P01'})).not.toThrow();});

it('observes correlated stages with bounded timings and redacted failures without changing errors',async()=>{
 const {observeDispatchStage,withDispatchObservation}=await import('./dispatch-diagnostic');
 const log=vi.spyOn(console,'info').mockImplementation(()=>{});vi.stubEnv('AGENT_VERBOSE_LOGGING','true');
 const threadId='11111111-1111-4111-8111-111111111111',operationId='22222222-2222-4222-8222-222222222222';
 const original=Object.assign(Error('PRIVATE BODY token recipient@example.invalid'),{code:'40001',detail:'PRIVATE'});
 try{
  await expect(withDispatchObservation({threadId,operationId,body:'PRIVATE'} as never,()=>observeDispatchStage('native.handler',async()=>{throw original;}))).rejects.toBe(original);
  expect(log).toHaveBeenCalledTimes(2);const rows=log.mock.calls.map(call=>JSON.parse(call[1] as string));
  expect(rows[0]).toMatchObject({stage:'native.handler',outcome:'start',threadId,operationId});
  expect(rows[1]).toMatchObject({stage:'native.handler',outcome:'error',threadId,operationId,sqlState:'40001'});
  expect(rows[1].durationMs).toBeGreaterThanOrEqual(0);expect(JSON.stringify(rows)).not.toContain('PRIVATE');expect(JSON.stringify(rows)).not.toContain('recipient@');
  log.mockClear();await expect(observeDispatchStage('delivery.lookup',async()=>({kind:'defer',reason:'PRIVATE'}))).resolves.toEqual({kind:'defer',reason:'PRIVATE'});expect(JSON.parse(log.mock.calls[1][1] as string)).toMatchObject({outcome:'wait'});
  log.mockImplementation(()=>{throw Error('logger failed');});await expect(observeDispatchStage('delivery.submit',async()=>42)).resolves.toBe(42);
 }finally{log.mockRestore();vi.unstubAllEnvs();}
});
it('reports safe workflow guard diagnostics with original stage and correlated identity even when the public error is generic',async()=>{
 const {reportAdmissionPreparationFailure,withDispatchObservation}=await import('./dispatch-diagnostic');
 const log=vi.spyOn(console,'warn').mockImplementation(()=>{}),getter=vi.fn(()=>{throw Error('PRIVATE');});
 try{
  withDispatchObservation({operationId:'22222222-2222-4222-8222-222222222222'},()=>reportAdmissionPreparationFailure('application.intent',Object.assign(Error('Exact active outreach workflow required for new dispatch'),{code:'P0001',detail:'PRIVATE'})));
  const result=JSON.parse(log.mock.calls[0][1] as string);expect(result).toMatchObject({timestamp:expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),stage:'application.intent',sqlState:'P0001',category:'workflow_dispatch_guard_rejected',operationId:'22222222-2222-4222-8222-222222222222',submission:'not_attempted_by_this_prepare',recovery:'reconcile_original_operation'});
  reportAdmissionPreparationFailure('application.prepare',Object.defineProperty({},'message',{get:getter}));expect(getter).not.toHaveBeenCalled();expect(JSON.stringify(log.mock.calls)).not.toContain('PRIVATE');expect(JSON.stringify(log.mock.calls)).not.toContain('Exact active');
  log.mockImplementation(()=>{throw Error('sink');});expect(()=>reportAdmissionPreparationFailure('application.prepare',Error('anything'))).not.toThrow();
 }finally{log.mockRestore();}
});
