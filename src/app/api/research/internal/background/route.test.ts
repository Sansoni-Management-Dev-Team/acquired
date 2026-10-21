import {beforeEach,expect,it,vi} from 'vitest';
const mocks=vi.hoisted(()=>({enabled:vi.fn(),authorized:vi.fn(),observe:vi.fn(),maintain:vi.fn(),legacy:vi.fn()}));
vi.mock('@/lib/research-service',()=>({researchEnabled:mocks.enabled,researchServiceAuthorized:mocks.authorized}));
vi.mock('@/lib/agent-initial-research-observer',()=>({observeScheduledInitialResearch:mocks.observe}));
vi.mock('@/lib/research-maintenance',()=>({maintainScheduledResearch:mocks.maintain}));
vi.mock('@/lib/company-background-dispatch',()=>({recoverCompanyBackground:mocks.legacy}));
import {POST} from './route';
beforeEach(()=>{vi.resetAllMocks();mocks.enabled.mockReturnValue(true);mocks.authorized.mockReturnValue(true);mocks.maintain.mockResolvedValue(3);mocks.observe.mockResolvedValue({checked:0,recovered:0,messages:0});});
it('runs the existing shared maintenance capability without a browser read',async()=>{
 const response=await POST(new Request('http://example.test/api/research/internal/background',{method:'POST'}));
 expect(await response.json()).toEqual({pending:3});expect(mocks.maintain).toHaveBeenCalledExactlyOnceWith();expect(mocks.legacy).not.toHaveBeenCalled();
});
it('requires the current service authority before maintenance',async()=>{
 mocks.authorized.mockReturnValue(false);expect((await POST(new Request('http://example.test',{method:'POST'}))).status).toBe(403);expect(mocks.maintain).not.toHaveBeenCalled();expect(mocks.observe).not.toHaveBeenCalled();
});

it('recovers marked initial research and persists chat observations through the existing service pass before maintenance',async()=>{
 const response=await POST(new Request('http://example.test/api/research/internal/background',{method:'POST'}));
 expect(await response.json()).toEqual({pending:3});expect(mocks.observe).toHaveBeenCalledExactlyOnceWith();expect(mocks.observe.mock.invocationCallOrder[0]).toBeLessThan(mocks.maintain.mock.invocationCallOrder[0]);
});
