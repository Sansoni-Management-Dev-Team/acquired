import {afterEach,expect,it,vi} from 'vitest';
import {reportHostedDemoFailure} from './hosted-demo-diagnostic';
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
