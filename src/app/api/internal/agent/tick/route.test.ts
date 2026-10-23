import {beforeEach,afterEach,expect,it,vi} from 'vitest';
const tick=vi.hoisted(()=>vi.fn());vi.mock('@/lib/agent-native-tick',()=>({runNativeAgentTick:tick}));
import {POST} from './route';
const request=(secret?:string)=>new Request('https://app.test/api/internal/agent/tick',{method:'POST',headers:secret?{authorization:'Bearer '+secret}:{}});
beforeEach(()=>{vi.resetAllMocks();vi.stubEnv('AGENT_WORKER_SECRET','synthetic-native-worker-secret');tick.mockResolvedValue({enabled:true,processed:1,outcome:'complete'});});afterEach(()=>vi.unstubAllEnvs());
it('denies missing, wrong or differently sized credentials without doing work',async()=>{for(const secret of [undefined,'wrong','x'.repeat(100)])expect((await POST(request(secret))).status).toBe(401);expect(tick).not.toHaveBeenCalled();});
it('executes a bounded tick only after server worker authentication',async()=>{const result=await POST(request('synthetic-native-worker-secret'));expect(result.status).toBe(200);expect(await result.json()).toEqual({enabled:true,processed:1,outcome:'complete'});expect(tick).toHaveBeenCalledOnce();});
it('does not echo worker exceptions, tenant details or credentials',async()=>{tick.mockRejectedValue(Error('private tenant payload'));const result=await POST(request('synthetic-native-worker-secret'));expect(result.status).toBe(500);expect(await result.text()).not.toContain('private');});
