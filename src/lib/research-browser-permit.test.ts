import { beforeEach, expect, it, vi } from 'vitest';
const m = vi.hoisted(() => ({claim:vi.fn(),reserve:vi.fn()}));
vi.mock('./research-provider-queue',()=>({claimResearchProvider:m.claim,reserveResearchProvider:m.reserve}));
import { researchBrowserPermit } from './research-browser-permit';
beforeEach(()=>vi.resetAllMocks());
it('retains an early reserved slot instead of allocating again behind waiting jobs',async()=>{
 m.claim.mockResolvedValue({granted:false,retryAfterMs:12,expired:false});
 expect(await researchBrowserPermit('job','reserved')).toEqual({granted:false,retryAfterMs:12,expired:false});
 expect(m.reserve).not.toHaveBeenCalled();
});
it('returns expiry for durable rebooking instead of joining the synchronous queue',async()=>{
 m.claim.mockResolvedValue({granted:false,retryAfterMs:0,expired:true});
 expect(await researchBrowserPermit('job','expired')).toMatchObject({expired:true});
 expect(m.reserve).not.toHaveBeenCalled();
});
it('keeps bounded synchronous admission for callers without a reservation',async()=>{
 m.reserve.mockResolvedValue({granted:false,retryAfterMs:30000});
 await researchBrowserPermit('job');
 expect(m.reserve).toHaveBeenCalledWith('job',expect.any(String),'search',22000);
});
