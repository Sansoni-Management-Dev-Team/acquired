import {afterEach,beforeEach,expect,it,vi} from 'vitest';
const m=vi.hoisted(()=>({session:vi.fn(),enabled:vi.fn(),start:vi.fn(),read:vi.fn(),resume:vi.fn(),after:vi.fn(),pool:{}}));
vi.mock('next/server',()=>({after:m.after}));
vi.mock('@/lib/auth',()=>({auth:{api:{getSession:m.session}}}));
vi.mock('@/lib/agent-runtime',()=>({agentPool:()=>m.pool}));
vi.mock('@/lib/acquisition-workflow',async()=>{const{z}=await import('zod');return {acquisitionWorkflowEnabled:m.enabled,startAcquisitionWorkflow:m.start,readAcquisitionWorkflow:m.read,resumeAcquisitionWorkflow:m.resume,acquisitionWorkflowStartSchema:z.object({requestId:z.string().uuid(),preset:z.enum(['demo','live-research-test','live']),presentation:z.enum(['agent','workspace'])}).strict(),AcquisitionWorkflowError:class extends Error{constructor(message:string,readonly status:number){super(message)}}};});
import {GET,POST} from './route';
const id='10000000-0000-4000-8000-000000000001',mandateId='20000000-0000-4000-8000-000000000002',url='http://localhost/api/acquisition-workflows';
const input={requestId:id,preset:'demo',presentation:'agent'},saved={id,mandateId,preset:'demo',presentation:'agent',state:'accepted',revision:1};
function request(body:unknown=input,origin='http://localhost'){return new Request(url,{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify(body)});}
beforeEach(()=>{vi.clearAllMocks();m.enabled.mockReturnValue(true);m.session.mockResolvedValue({session:{activeOrganizationId:'org'},user:{id:'owner'}});m.start.mockResolvedValue({...saved,replayed:false});m.read.mockResolvedValue(saved);});
it('accepts a durable workflow through the shared command using authenticated scope',async()=>{const r=await POST(request());expect(r.status).toBe(201);expect(await r.json()).toMatchObject(saved);expect(m.start).toHaveBeenCalledWith(m.pool,{organizationId:'org',userId:'owner'},input);expect(r.headers.get('Cache-Control')).toBe('private, no-store');});
it('returns a replay without starting a different identity',async()=>{m.start.mockResolvedValue({...saved,replayed:true});expect((await POST(request())).status).toBe(200);});
it('reads only the exact owned request and never creates on status lookup',async()=>{const r=await GET(new Request(url+'?requestId='+id));expect(r.status).toBe(200);expect(await r.json()).toMatchObject(saved);expect(m.read).toHaveBeenCalledWith(m.pool,{organizationId:'org',userId:'owner'},id);expect(m.start).not.toHaveBeenCalled();});
it('returns missing without selecting another saved mandate',async()=>{m.read.mockResolvedValue(null);expect(await (await GET(new Request(url+'?requestId='+id))).json()).toEqual({status:'missing'});expect(m.start).not.toHaveBeenCalled();});
it('rejects duplicate or forged status scope',async()=>{for(const q of ['requestId=bad',`requestId=${id}&requestId=${id}`,`requestId=${id}&userId=other`])expect((await GET(new Request(url+'?'+q))).status).toBe(400);expect(m.read).not.toHaveBeenCalled();});
it('enforces the release flag before creating work',async()=>{m.enabled.mockReturnValue(false);expect((await POST(request())).status).toBe(404);expect((await GET(new Request(url+'?requestId='+id))).status).toBe(404);expect(m.start).not.toHaveBeenCalled();expect(m.read).not.toHaveBeenCalled();});
it('requires origin, authenticated organization, and strict input',async()=>{expect((await POST(request(input,'https://other.invalid'))).status).toBe(403);expect((await POST(request({...input,ownerUserId:'other'}))).status).toBe(400);m.session.mockResolvedValue(null);expect((await POST(request())).status).toBe(401);expect(m.start).not.toHaveBeenCalled();});
it('returns complete sanitized JSON when auth/storage fails',async()=>{m.session.mockRejectedValueOnce(Error('private connection string'));const r=await POST(request());expect(r.status).toBe(503);expect(await r.text()).not.toContain('private connection');m.start.mockRejectedValueOnce(Error('private SQL'));const r2=await POST(request());expect(r2.status).toBe(503);expect(await r2.text()).not.toContain('private SQL');});

it('schedules research only after durable response and does not await provider work',async()=>{m.resume.mockImplementation(()=>new Promise(()=>{}));const response=await POST(request());expect(response.status).toBe(201);expect(m.after).toHaveBeenCalledOnce();expect(m.resume).not.toHaveBeenCalled();});

afterEach(()=>vi.unstubAllEnvs());
it('keeps saved status available when new starts are disabled after rollout',async()=>{m.enabled.mockReturnValue(false);vi.stubEnv('ACQUISITION_WORKFLOW_SCHEMA_READY','true');expect((await POST(request())).status).toBe(404);expect((await GET(new Request(url+'?requestId='+id))).status).toBe(200);expect(m.read).toHaveBeenCalledOnce();});
