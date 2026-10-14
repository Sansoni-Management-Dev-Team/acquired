import {expect,it,vi} from 'vitest';vi.mock('server-only',()=>({}));
import {readAcquireCommunicationsKeys} from './communications-configuration';
it('requires an independently configured application keyring and rejects service key reuse',()=>{
 const key=(n:number)=>Buffer.alloc(32,n).toString('base64'),env={ACQUIRE_COMMUNICATIONS_ACTIVE_KEY_VERSION:'a1',ACQUIRE_COMMUNICATIONS_KEYRING_JSON:JSON.stringify([{version:'a1',encryptionKey:key(21),digestKey:key(22)}])},reserved=[Buffer.alloc(32,11),Buffer.alloc(32,12)];
 expect(readAcquireCommunicationsKeys(env,reserved).keyVersion).toBe('a1');expect(()=>readAcquireCommunicationsKeys({},reserved)).toThrow('Application communications keys unavailable');
 expect(()=>readAcquireCommunicationsKeys({...env,ACQUIRE_COMMUNICATIONS_KEYRING_JSON:JSON.stringify([{version:'a1',encryptionKey:key(11),digestKey:key(22)}])},reserved)).toThrow('Application communications keys unavailable');
});
it('accepts all canonical base64 keys, including slash-prefixed material',()=>{expect(readAcquireCommunicationsKeys({ACQUIRE_COMMUNICATIONS_ACTIVE_KEY_VERSION:'a1',ACQUIRE_COMMUNICATIONS_KEYRING_JSON:JSON.stringify([{version:'a1',encryptionKey:Buffer.alloc(32,255).toString('base64'),digestKey:Buffer.alloc(32,254).toString('base64')}])},[]).keyVersion).toBe('a1');});
