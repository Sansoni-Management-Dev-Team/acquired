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
