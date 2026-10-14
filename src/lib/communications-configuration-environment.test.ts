import {expect,it,vi,afterEach} from 'vitest';vi.mock('server-only',()=>({}));
const f=vi.hoisted(()=>({read:vi.fn(),connect:vi.fn(),end:vi.fn()}));
vi.mock('pg',()=>({Pool:class{connect=f.connect;end=f.end;}}));
vi.mock('@/db/campaign-client',()=>({campaignSqlPool:()=>({connect:f.connect})}));
vi.mock('../../communications/packages/adapter-unipile/src/v1-runtime',()=>({createConfiguredUnipileV1Runtime:()=>({})}));
vi.mock('../../communications/packages/adapter-unipile/src/v1-runtime-env',()=>({readConfiguredUnipileV1Environment:f.read}));
import {configuredAcquireCommunications} from './communications-configuration';
afterEach(()=>vi.unstubAllEnvs());
it('passes a plain explicit snapshot of native Node process.env to strict configuration without opening SQL',()=>{
 vi.stubEnv('COMMUNICATIONS_RUNTIME_ENABLED','true');vi.stubEnv('COMMUNICATIONS_DATABASE_URL','postgresql://synthetic.invalid/unused');vi.stubEnv('ACQUIRE_COMMUNICATIONS_ACTIVE_KEY_VERSION','a1');vi.stubEnv('ACQUIRE_COMMUNICATIONS_KEYRING_JSON',JSON.stringify([{version:'a1',encryptionKey:Buffer.alloc(32,21).toString('base64'),digestKey:Buffer.alloc(32,22).toString('base64')}]));
 f.read.mockImplementation(env=>{if(Object.getPrototypeOf(env)!==Object.prototype)throw Error('Native environment is not an explicit descriptor');return {scopedAuthKey:Buffer.alloc(32,8),options:{applicationId:'acquire',pool:{connect:f.connect},callbackKey:Buffer.alloc(32,7),vault:{identityKey:Buffer.alloc(32,13),activeVersion:'v1',keys:[{version:'v1',encryptionKey:Buffer.alloc(32,11),digestKey:Buffer.alloc(32,12)}]}}};});
 expect(configuredAcquireCommunications().host).toBeDefined();expect(f.read.mock.calls[0][0]).not.toBe(process.env);expect(Object.getPrototypeOf(f.read.mock.calls[0][0])).toBe(Object.prototype);expect(f.connect).not.toHaveBeenCalled();
});
