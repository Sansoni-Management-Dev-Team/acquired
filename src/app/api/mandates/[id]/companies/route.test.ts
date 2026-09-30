import {beforeEach,expect,it,vi} from 'vitest';
const m=vi.hoisted(()=>({session:vi.fn(),load:vi.fn(),mandate:vi.fn(),recover:vi.fn()}));
vi.mock('@/lib/auth',()=>({auth:{api:{getSession:m.session}}}));
vi.mock('@/db/company-list-repository',()=>({CompanyListRepository:class{load=m.load;}}));
vi.mock('@/db/acquisition-repository',()=>({AcquisitionRepository:class{getMandate=m.mandate;}}));
vi.mock('@/lib/company-list-recovery',()=>({recoverCompanyListWork:m.recover}));
vi.mock('@/lib/research-request-observability',()=>({observeResearchRequest:(_request:Request,run:()=>Promise<Response>)=>run()}));
import {GET,POST} from './route';
const id='d867df25-1cad-441d-ae08-92d26da3117e';
beforeEach(()=>{vi.clearAllMocks();m.session.mockResolvedValue({session:{activeOrganizationId:'org'}});m.mandate.mockResolvedValue({id});});
it('returns unchanged activity without running scheduling recovery',async()=>{
  const revision='a'.repeat(64);m.load.mockResolvedValue({unchanged:true,revision,active:true});
  const response=await GET(new Request(`http://localhost/api/mandates/${id}/companies?revision=${revision}&page=2`),{params:Promise.resolve({id})});
  expect(await response.json()).toEqual({unchanged:true,revision,active:true});expect(m.load).toHaveBeenCalledWith(id,expect.objectContaining({page:2}),revision);expect(m.recover).not.toHaveBeenCalled();
});
it('recovers independently without loading company summaries',async()=>{
  const response=await POST(new Request(`http://localhost/api/mandates/${id}/companies`,{method:'POST'}),{params:Promise.resolve({id})});
  expect(response.status).toBe(200);expect(m.recover).toHaveBeenCalledWith('org',id);expect(m.load).not.toHaveBeenCalled();
});
it('rejects unauthenticated, invalid and inaccessible requests',async()=>{
  m.session.mockResolvedValueOnce(null);expect((await GET(new Request('http://localhost/companies'),{params:Promise.resolve({id})})).status).toBe(401);
  expect((await GET(new Request('http://localhost/companies?page=0'),{params:Promise.resolve({id})})).status).toBe(400);
  m.load.mockResolvedValue(null);expect((await GET(new Request('http://localhost/companies'),{params:Promise.resolve({id})})).status).toBe(404);
});
