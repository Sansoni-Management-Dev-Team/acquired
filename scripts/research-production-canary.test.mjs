import { expect, it } from 'vitest';
import { canaryStages, canaryJobConfig, assertCanaryScope } from './research-production-canary.mjs';

it('stages each feature and independently exercises all three rollback switches', () => {
 expect(canaryStages.map(stage => stage.name)).toEqual(['measurements','telemetry','progress','scheduling','rollback-telemetry','rollback-progress','rollback-scheduling']);
 expect(canaryStages[0].flags).toEqual({ telemetryBatching:false, progressCoalescing:false, schedulerCoalescing:false });
 expect(canaryStages[3].flags).toEqual({ telemetryBatching:true, progressCoalescing:true, schedulerCoalescing:true });
 for (const stage of canaryStages.slice(4)) expect(Object.values(stage.flags).filter(Boolean)).toHaveLength(2);
});

it('bounds canaries to one source/page/model, exercising automatic scheduling without discovery, people, enrichment or outreach', () => {
 const config = canaryJobConfig('https://arkindustrial.com.au/', canaryStages[3]);
 expect(config).toMatchObject({ discover:false, workflow:'business', approved:true, findPeople:false, performanceFlags:canaryStages[3].flags, budget:{ maxPages:1,maxModelCalls:1,maxDomains:1,maxMinutes:2 } });
 expect(config.mode).toBe('automatic');
 expect(config.targetBusinesses).toBe(1);
 expect(config.companyBudget).toBeUndefined();
 expect(config.performanceFlags).not.toBe(canaryStages[3].flags);
 expect(() => canaryJobConfig('http://127.0.0.1/', canaryStages[0])).toThrow();
});

it('prevents cleanup touching existing organization or user IDs', () => {
 expect(() => assertCanaryScope('customer-org', 'customer-user')).toThrow();
 expect(() => assertCanaryScope('research-canary-abc', 'customer-user')).toThrow();
 expect(() => assertCanaryScope('research-canary-abc', 'research-canary-abc')).not.toThrow();
});

it('allows the bounded first-party REDARC about page and rejects expanded crawl scopes', () => {
 expect(canaryJobConfig('https://www.redarcelectronics.com/au/about-us', canaryStages[0]).seeds).toEqual(['https://www.redarcelectronics.com/au/about-us']);
 for(const source of ['https://www.redarcelectronics.com/au/', 'https://www.redarcelectronics.com/au/about-us?extra=1', 'https://www.redarcelectronics.com/au/about-us#section', 'https://user@www.redarcelectronics.com/au/about-us'])expect(()=>canaryJobConfig(source,canaryStages[0])).toThrow();
});
