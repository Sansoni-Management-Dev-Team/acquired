import { PgDialect } from 'drizzle-orm/pg-core';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const m=vi.hoisted(()=>({getSession:vi.fn(),limit:vi.fn(),where:vi.fn(),select:vi.fn(),database:vi.fn()}));
vi.mock('server-only',()=>({}));
vi.mock('better-auth',()=>({betterAuth:()=>({api:{getSession:m.getSession},handler:vi.fn()})}));
vi.mock('better-auth/adapters/drizzle',()=>({drizzleAdapter:()=>({})}));
vi.mock('better-auth/plugins',()=>({organization:()=>({})}));
vi.mock('@/db/client',()=>({requireDb:m.database}));
vi.mock('@/lib/transactional-email',()=>({sendPasswordResetEmail:vi.fn()}));
import {auth} from './auth';
const session={user:{id:'user-a'},session:{activeOrganizationId:'org-a'}};
beforeEach(()=>{vi.clearAllMocks();m.getSession.mockResolvedValue(session);m.limit.mockResolvedValue([{id:'membership'}]);m.where.mockReturnValue({limit:m.limit});m.select.mockReturnValue({from:()=>({where:m.where})});m.database.mockReturnValue({select:m.select});});
afterEach(()=>vi.restoreAllMocks());
it('denies a valid session whose active organization membership was removed',async()=>{
 m.limit.mockResolvedValue([]);
 expect(await auth.api.getSession({headers:new Headers()})).toBeNull();
});
it('rechecks membership on every call rather than caching stale authorization',async()=>{
 expect(await auth.api.getSession({headers:new Headers()})).toEqual(session);
 m.limit.mockResolvedValue([]);
 expect(await auth.api.getSession({headers:new Headers()})).toBeNull();
 expect(m.where).toHaveBeenCalledTimes(2);
});
it('allows current members and sessions selecting their first organization',async()=>{
 expect(await auth.api.getSession({headers:new Headers()})).toEqual(session);
 m.getSession.mockResolvedValue({user:{id:'user-a'},session:{activeOrganizationId:null}});
 expect(await auth.api.getSession({headers:new Headers()})).not.toBeNull();
 expect(m.where).toHaveBeenCalledTimes(1);
});
it('does not query memberships for signed-out requests',async()=>{
 m.getSession.mockResolvedValue(null);
 expect(await auth.api.getSession({headers:new Headers()})).toBeNull();
 expect(m.select).not.toHaveBeenCalled();
});
it('fails closed if the membership repository is unavailable',async()=>{
 m.limit.mockRejectedValue(Error('database unavailable'));
 expect(await auth.api.getSession({headers:new Headers()})).toBeNull();
});

it('scopes the membership query to both the authenticated user and active organization',async()=>{
 await auth.api.getSession({headers:new Headers()});
 const query=new PgDialect().sqlToQuery(m.where.mock.calls[0][0]);
 expect(query.params).toEqual(['org-a','user-a']);
 expect(query.sql).toContain('organization_id');
 expect(query.sql).toContain('user_id');
});
