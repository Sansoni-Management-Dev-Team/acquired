import {expect,it,vi} from 'vitest';
import {balancedReservation,balancedWakeups} from './balanced-policy';
it('shares actual local reader capacity between search and page work only in B',()=>{
 expect(balancedReservation('search',{LOCAL_DEVELOPMENT:'true',RESEARCH_PIPELINE_DESIGN:'balanced-v1'})).toEqual({balancedLocal:true,provider:'page'});
 expect(balancedReservation('search',{LOCAL_DEVELOPMENT:'true'}).provider).toBe('search');
 expect(balancedReservation('ai',{LOCAL_DEVELOPMENT:'true',RESEARCH_PIPELINE_DESIGN:'balanced-v1'}).provider).toBe('ai');
 expect(balancedReservation('search',{RESEARCH_PIPELINE_DESIGN:'balanced-v1'}).balancedLocal).toBe(false);
});
it('durably wakes scheduling without UI polls until the run settles',async()=>{
 const wake=vi.fn().mockResolvedValueOnce({stop:false}).mockResolvedValueOnce({stop:true});
 const steps={do:async<T>(_name:string,run:()=>Promise<T>)=>run(),sleep:vi.fn(async()=>{})};
 await balancedWakeups(steps,wake,1000,()=>0);expect(wake).toHaveBeenCalledTimes(2);expect(steps.sleep).toHaveBeenCalledTimes(1);
});
it('shares rendered search capacity for C locally without enabling the alternative in production',()=>{expect(balancedReservation('search',{LOCAL_DEVELOPMENT:'true',RESEARCH_PIPELINE_DESIGN:'corpus-v1'})).toEqual({balancedLocal:true,provider:'page'});expect(balancedReservation('search',{RESEARCH_PIPELINE_DESIGN:'corpus-v1'})).toEqual({balancedLocal:false,provider:'search'});});
