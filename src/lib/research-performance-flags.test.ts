import {expect,it} from 'vitest';
import {newResearchPerformanceFlags} from './research-performance-flags';
it('enables the three optimizations for new runs by default',()=>{
 expect(newResearchPerformanceFlags({})).toEqual({telemetryBatching:true,progressCoalescing:true,schedulerCoalescing:true});
});
it('supports independent rollout and rollback switches',()=>{
 expect(newResearchPerformanceFlags({RESEARCH_TELEMETRY_BATCHING:'false',RESEARCH_PROGRESS_COALESCING:'0',RESEARCH_SCHEDULER_COALESCING:'true'})).toEqual({telemetryBatching:false,progressCoalescing:false,schedulerCoalescing:true});
});
it('rejects invalid switches instead of silently enabling a typo',()=>{
 expect(()=>newResearchPerformanceFlags({RESEARCH_SCHEDULER_COALESCING:'tru'})).toThrow('RESEARCH_SCHEDULER_COALESCING');
});
