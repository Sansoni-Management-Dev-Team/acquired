import {afterEach,expect,it,vi} from 'vitest';
afterEach(()=>{vi.unstubAllEnvs();vi.resetModules();});
it('allows only the explicitly configured local HTTPS hostname for development assets',async()=>{
 vi.stubEnv('LOCAL_DEVELOPMENT','true');vi.stubEnv('APP_URL','https://synthetic-auth-test.example.test');
 const {default:config}=await import('../next.config');expect(config.allowedDevOrigins).toEqual(['synthetic-auth-test.example.test']);
});
it('does not enable extra development origins outside explicit local development',async()=>{
 vi.stubEnv('LOCAL_DEVELOPMENT','false');vi.stubEnv('APP_URL','https://synthetic-auth-test.example.test');
 const {default:config}=await import('../next.config');expect(config.allowedDevOrigins??[]).toEqual([]);
});
