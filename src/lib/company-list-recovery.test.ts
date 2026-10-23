import {expect,it,vi} from 'vitest';
const recover=vi.hoisted(()=>vi.fn());
vi.mock('./research-maintenance',()=>({recoverMandateResearch:recover}));
import {recoverCompanyListWork} from './company-list-recovery';
it('delegates explicit list recovery to the same worker-maintenance capability and exact scope/time',async()=>{
 recover.mockResolvedValue(true);expect(await recoverCompanyListWork('org','mandate',123)).toBe(true);
 expect(recover).toHaveBeenCalledExactlyOnceWith('org','mandate',123);
});
