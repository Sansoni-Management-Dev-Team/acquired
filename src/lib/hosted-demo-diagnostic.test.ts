import {afterEach,expect,it,vi} from 'vitest';
import {reportHostedDemoFailure,reportHostedCoverageRevalidation} from './hosted-demo-diagnostic';
afterEach(()=>{vi.restoreAllMocks();vi.unstubAllEnvs();});
it('logs only fixed boundary and allowlisted SQL state, never private error content',()=>{
 vi.stubEnv('AGENT_VERBOSE_LOGGING','true');const log=vi.spyOn(console,'warn').mockImplementation(()=>{});
 reportHostedDemoFailure('coverage.sql.gate',Object.assign(Error('private recipient and secret'),{code:'55P03',detail:'secret'}));
 expect(log).toHaveBeenCalledWith('hosted-demo-failure',JSON.stringify({boundary:'coverage.sql.gate',sqlState:'55P03'}));
});
it('ignores hostile getters and logging failures and remains opt-in',()=>{
 const log=vi.spyOn(console,'warn').mockImplementation(()=>{throw Error('logger failed');});
 reportHostedDemoFailure('bridge.revalidate',Error('private'));expect(log).not.toHaveBeenCalled();
 vi.stubEnv('AGENT_VERBOSE_LOGGING','true');expect(()=>reportHostedDemoFailure('bridge.revalidate',Object.defineProperty({},'code',{get(){throw Error('getter');}}))).not.toThrow();
});

it('limits revalidation diagnostics to opt-in status codes and tolerates logger failure',()=>{
 const log=vi.spyOn(console,'warn').mockImplementation(()=>{});
 reportHostedCoverageRevalidation('http_error',503);expect(log).not.toHaveBeenCalled();
 vi.stubEnv('AGENT_VERBOSE_LOGGING','true');
 for(const status of [undefined,200,399,600,401.5,NaN])reportHostedCoverageRevalidation('http_error',status);
 expect(log).not.toHaveBeenCalled();
 log.mockImplementation(()=>{throw Error('logger failed');});expect(()=>reportHostedCoverageRevalidation('http_error',401)).not.toThrow();
});
