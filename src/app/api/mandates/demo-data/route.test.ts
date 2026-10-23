import{beforeEach,expect,it,vi}from'vitest';
import{emptyBrief}from'@/domain/acquisition';
const m=vi.hoisted(()=>({session:vi.fn(),select:vi.fn(),create:vi.fn(),status:vi.fn(),pool:{}}));
vi.mock('@/lib/auth',()=>({auth:{api:{getSession:m.session}}}));
vi.mock('@/lib/agent-runtime',()=>({agentPool:()=>m.pool}));
vi.mock('@/lib/cached-demo-research',()=>({selectCachedDemoResearch:m.select}));
vi.mock('@/lib/create-cached-demo',async()=>{const{z}=await import('zod');return{createCachedDemo:m.create,cachedDemoCreateSchema:z.object({requestId:z.string().uuid(),sourceMandateId:z.string().uuid().optional()}).strict()};});
vi.mock('@/lib/cached-demo-status',async original=>({...await original<typeof import('@/lib/cached-demo-status')>(),readCachedDemoStatus:m.status}));
import{GET,POST}from'./route';
const source='10000000-0000-4000-8000-000000000001',id='10000000-0000-4000-8000-000000000002',url='http://localhost/api/mandates/demo-data';
const req=(body:unknown={requestId:id,sourceMandateId:source},origin='http://localhost')=>new Request(url,{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify(body)});
beforeEach(()=>{vi.clearAllMocks();m.session.mockResolvedValue({session:{activeOrganizationId:'org'},user:{id:'actor'}});m.select.mockResolvedValue({sourceMandateId:source,brief:emptyBrief(),companyCount:2,peopleCount:100,targetIds:['private-source-id'],sourceDigest:'private-digest'});m.create.mockResolvedValue({id,replayed:false,initialResearch:{status:'complete',source:'cached'}});});
it('reads current tenant data selection without exposing the private manifest or scheduling research',async()=>{const r=await GET(new Request(url));expect(r.status).toBe(200);expect(await r.json()).toEqual({sourceMandateId:source,brief:emptyBrief(),companies:2,people:100});expect(m.select).toHaveBeenCalledWith(m.pool,{organizationId:'org',userId:'actor'});expect(m.create).not.toHaveBeenCalled();});
it('creates an ordinary saved-data demo through the same server command',async()=>{const r=await POST(req());expect(r.status).toBe(201);expect(m.create).toHaveBeenCalledWith(m.pool,{organizationId:'org',userId:'actor'},{requestId:id,sourceMandateId:source},'workspace');});
it('stops clearly on missing saved data without creating or dispatching anything',async()=>{m.select.mockResolvedValueOnce(undefined);const r=await GET(new Request(url));expect(r.status).toBe(409);expect(await r.text()).toContain('No live research');expect(m.create).not.toHaveBeenCalled();});
it('checks session, origin and strict input before the data command',async()=>{expect((await POST(req(undefined,'https://foreign.invalid'))).status).toBe(403);expect((await POST(req({requestId:id,sourceMandateId:source,approved:true}))).status).toBe(400);m.session.mockResolvedValue(null);expect((await GET(new Request(url))).status).toBe(401);expect((await POST(req())).status).toBe(401);expect(m.select).not.toHaveBeenCalled();expect(m.create).not.toHaveBeenCalled();});

it('reads only the original owned demo status without selecting or creating again',async()=>{m.status.mockResolvedValueOnce({status:'ready',id,revision:'9'});const r=await GET(new Request(url+'?'+new URLSearchParams({requestId:id,sourceMandateId:source,presentation:'agent'})));expect(r.status).toBe(200);expect(await r.json()).toEqual({status:'ready',id,revision:'9'});expect(m.status).toHaveBeenCalledWith(m.pool,{organizationId:'org',userId:'actor'},{requestId:id,sourceMandateId:source,presentation:'agent'});expect(m.select).not.toHaveBeenCalled();expect(m.create).not.toHaveBeenCalled();});
it('refuses malformed and caller-supplied status scope before querying storage',async()=>{for(const suffix of ['requestId=bad','requestId='+id+'&sourceMandateId='+source+'&presentation=agent&userId=other','requestId='+id+'&requestId='+source+'&sourceMandateId='+source+'&presentation=agent'])expect((await GET(new Request(url+'?'+suffix))).status).toBe(400);expect(m.status).not.toHaveBeenCalled();});
it.each(['read','create'] as const)('returns a complete JSON503 when session storage fails before demo %s',async action=>{
 m.session.mockRejectedValueOnce(Error('private database connection failure'));
 const r=action==='read'?await GET(new Request(url)):await POST(req());expect(r.status).toBe(503);expect(r.headers.get('Cache-Control')).toBe('private, no-store');expect(await r.json()).toEqual({error:'Sign-in status is temporarily unavailable. Please try again.'});expect(m.select).not.toHaveBeenCalled();expect(m.create).not.toHaveBeenCalled();
});
