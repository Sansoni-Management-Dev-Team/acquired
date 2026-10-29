import { expect, it, vi } from 'vitest';
import { createScopedServiceAuth } from './scoped-service-auth';
const scope={applicationId:'acquire',tenantId:'org',ownerId:'owner'};
it('authenticates exact signed scope only while current authority and short expiry hold',async()=>{
 let now=Date.parse('2026-10-14T00:00:00Z');const authorize=vi.fn(async()=>true);const auth=createScopedServiceAuth({key:Buffer.alloc(32,7),audience:'communications',applicationId:'acquire',authorize,now:()=>now});
 const token=auth.issue(scope);expect(await auth.verify('Bearer '+token)).toEqual(scope);expect(authorize).toHaveBeenCalledWith(scope,{expiresAt:'2026-10-14T00:01:00.000Z'});
 authorize.mockResolvedValueOnce(false);expect(await auth.verify('Bearer '+token)).toBeNull();now+=61000;expect(await auth.verify('Bearer '+token)).toBeNull();
});
it('rejects changed identity, key, audience, unknown claims and a future-issued token',async()=>{
 let now=100000;const config={key:Buffer.alloc(32,7),audience:'communications',applicationId:'acquire',authorize:vi.fn(async()=>true),now:()=>now};const auth=createScopedServiceAuth(config);const token=auth.issue(scope);
 const parts=token.split('.');const claims=JSON.parse(Buffer.from(parts[0],'base64url').toString());claims.ownerId='other';expect(await auth.verify('Bearer '+Buffer.from(JSON.stringify(claims)).toString('base64url')+'.'+parts[1])).toBeNull();
 expect(await createScopedServiceAuth({...config,key:Buffer.alloc(32,8)}).verify('Bearer '+token)).toBeNull();expect(await createScopedServiceAuth({...config,audience:'other'}).verify('Bearer '+token)).toBeNull();now-=1000;expect(await auth.verify('Bearer '+token)).toBeNull();
});
it('optionally backdates issuance for small clock skew without relaxing verification or extending expiry',async()=>{
 let clock=100000;const config={key:Buffer.alloc(32,7),audience:'communications',applicationId:'acquire',authorize:vi.fn(async()=>true)},verifier=createScopedServiceAuth({...config,now:()=>clock});
 const normal=createScopedServiceAuth({...config,now:()=>100010});expect(await verifier.verify('Bearer '+normal.issue(scope))).toBeNull();
 const sender=createScopedServiceAuth({...config,now:()=>100010,issuedAtBackdateMs:1000});const token=sender.issue(scope),claims=JSON.parse(Buffer.from(token.split('.')[0],'base64url').toString());
 expect(claims.iat).toBe(99010);expect(claims.exp).toBe(159010);expect(await verifier.verify('Bearer '+token)).toEqual(scope);
 config.authorize.mockResolvedValueOnce(false);expect(await verifier.verify('Bearer '+token)).toBeNull();
 clock=159010;expect(await verifier.verify('Bearer '+token)).toBeNull();
 clock=100000;const ahead=createScopedServiceAuth({...config,now:()=>101001,issuedAtBackdateMs:1000});expect(await verifier.verify('Bearer '+ahead.issue(scope))).toBeNull();
});
it.each([-1,1001,0.5,NaN,Infinity])('rejects invalid issuance backdating %s',issuedAtBackdateMs=>{
 expect(()=>createScopedServiceAuth({key:Buffer.alloc(32,7),audience:'communications',applicationId:'acquire',authorize:async()=>true,issuedAtBackdateMs})).toThrow('Invalid service authentication configuration');
});
