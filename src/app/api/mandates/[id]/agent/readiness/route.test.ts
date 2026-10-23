import{it,expect,vi,beforeEach}from'vitest';
vi.mock('server-only',()=>({}));
const f=vi.hoisted(()=>({scope:vi.fn(),readiness:vi.fn()}));
vi.mock('@/lib/agent-request-scope',()=>({agentRequestScope:f.scope,agentResponseHeaders:{'Cache-Control':'private, no-store'},agentRequestFailure:()=>Response.json({error:'Readiness unavailable'},{status:409})}));
import{GET}from'./route';const ctx={params:Promise.resolve({id:'mandate'})},req=new Request('https://app.test');
beforeEach(()=>{vi.clearAllMocks();f.scope.mockResolvedValue({thread:{id:'owned'},store:{runtimeReadiness:f.readiness}});f.readiness.mockResolvedValue({registered:false,reason:'Connect email, WhatsApp and LinkedIn',budgets:[],channels:[]});});
it('shows owned readiness and actionable setup without starting work or exposing env values',async()=>{const response=await GET(req,ctx);expect(response.status).toBe(200);expect(response.headers.get('cache-control')).toContain('no-store');expect((await response.json()).readiness.reason).toContain('Connect');expect(f.readiness).toHaveBeenCalledWith('owned');});
it('does not create a thread to inspect a new mandate',async()=>{f.scope.mockResolvedValue({thread:undefined,store:{runtimeReadiness:f.readiness}});const result=await(await GET(req,ctx)).json();expect(result.readiness.registered).toBe(false);expect(result.readiness.reason).toContain('Start');expect(f.readiness).not.toHaveBeenCalled();});
it('retains authenticated scope denials',async()=>{f.scope.mockResolvedValue(Response.json({error:'Denied'},{status:401}));expect((await GET(req,ctx)).status).toBe(401);expect(f.readiness).not.toHaveBeenCalled();});
