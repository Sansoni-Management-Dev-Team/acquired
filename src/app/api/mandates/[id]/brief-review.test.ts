import {beforeEach,expect,it,vi} from 'vitest';
import {emptyBrief} from '@/domain/acquisition';
const mocks=vi.hoisted(()=>({session:vi.fn(),getMandate:vi.fn(),execute:vi.fn(),generate:vi.fn(),worker:vi.fn(),discover:vi.fn()}));
vi.mock('@/db/client',()=>({requireDb:vi.fn()}));
vi.mock('@/lib/auth',()=>({auth:{api:{getSession:mocks.session}}}));
vi.mock('@/lib/acquire-commands',()=>({acquireCommands:{execute:mocks.execute}}));
vi.mock('@/db/acquisition-repository',()=>({AcquisitionRepository:class{getMandate=mocks.getMandate;}}));
vi.mock('@/adapters/mandate-generation',()=>({generateMandate:mocks.generate}));
vi.mock('@/lib/research-service',()=>({researchEnabled:()=>true,researchWorker:mocks.worker}));
vi.mock('@/adapters/mandate-discovery',()=>({discoverMandate:mocks.discover}));
import {POST} from './route';
const id='00000000-0000-4000-8000-000000000001';
const brief={...emptyBrief(),naturalLanguage:'Saved business acquisition brief',criteria:emptyBrief().criteria.map(c=>['geography','subsectors'].includes(c.key)?{...c,state:'specified' as const,value:c.key==='geography'?'Queensland':'Commercial cleaning',origin:'assumed' as const,confirmed:true}:c)};
const request=(expectedRevision:string)=>new Request(`http://localhost/api/mandates/${id}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'brief',brief,expectedRevision})});
beforeEach(()=>{vi.clearAllMocks();mocks.session.mockResolvedValue({user:{id:'owner'},session:{activeOrganizationId:'org'}});mocks.getMandate.mockResolvedValue({id,brief:emptyBrief(),revision:'123'});mocks.execute.mockResolvedValue({name:'mandate.update',value:{id,brief,revision:'124'}});});
it('persists explicit reviewed assumptions through the owned CAS command with no generation or research',async()=>{
 const response=await POST(request('123'),{params:Promise.resolve({id})});
 expect(response.status).toBe(200);expect(await response.json()).toMatchObject({brief,revision:'124'});
 expect(mocks.execute).toHaveBeenCalledExactlyOnceWith({organizationId:'org',userId:'owner'},{name:'mandate.update',input:{mandateId:id,brief,expectedRevision:'123'}});
 expect(mocks.generate).not.toHaveBeenCalled();expect(mocks.worker).not.toHaveBeenCalled();expect(mocks.discover).not.toHaveBeenCalled();
});
it('rejects a stale review without changing criteria or starting discovery',async()=>{
 const response=await POST(request('122'),{params:Promise.resolve({id})});
 expect(response.status).toBe(409);expect(mocks.execute).not.toHaveBeenCalled();expect(mocks.generate).not.toHaveBeenCalled();expect(mocks.worker).not.toHaveBeenCalled();
});
