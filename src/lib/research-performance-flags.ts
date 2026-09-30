import type { ResearchConfig } from '@/domain/research';
/** Snapshot on new root requests only. Continuations retain their original flags. */
export function newResearchPerformanceFlags(env: Record<string, string | undefined> = process.env): NonNullable<ResearchConfig['performanceFlags']> {
 const enabled=(name:string)=>{
  const value=env[name]?.trim().toLowerCase();
  if(value===undefined || value==='' || value==='true' || value==='1') return true;
  if(value==='false' || value==='0') return false;
  throw new Error(`Invalid ${name}; use true/false or 1/0`);
 };
 return {
  telemetryBatching:enabled('RESEARCH_TELEMETRY_BATCHING'),
  progressCoalescing:enabled('RESEARCH_PROGRESS_COALESCING'),
  schedulerCoalescing:enabled('RESEARCH_SCHEDULER_COALESCING'),
 };
}
