import { expect, it } from 'vitest';
import { researchE2eConfig, validateLocalTestDatabase } from './research-e2e-config.mjs';
it('uses only the dedicated OrbStack database', () => {
 expect(validateLocalTestDatabase('postgresql://project_acquire:project_acquire@127.0.0.1:5434/project_acquire')).toBeTruthy();
 for (const url of ['postgresql://u:p@production.example.com/db', 'postgresql://u:p@127.0.0.1:5432/other', 'postgresql://project_acquire:project_acquire@127.0.0.1:5434/project_acquire?host=production.example.com']) expect(() => validateLocalTestDatabase(url)).toThrow();
});
it('creates deterministic environments without inherited production credentials', () => {
 const c = researchE2eConfig({ appPort:18120, workerPort:18121, fixturePort:18124, readerPort:18125, secret:'test-secret', authSecret:'test-auth-secret', environment: { DATABASE_URL:'postgresql://prod', OPENROUTER_API_KEY:'paid-key', CF_BROWSER_TOKEN:'production-token' } });
 expect(c.app.DATABASE_URL).toContain('127.0.0.1:5434');
 expect(c.app.TARGET_DATA_PROVIDER).toBe('fixture');
 expect(c.app.RESEARCH_SERVICE_SECRET).toBe('test-secret');
 expect(c.worker.OPENROUTER_API_KEY).toBe('fixture-only');
 expect(c.app.OPENROUTER_API_KEY).toBe('fixture-only');
 expect(JSON.stringify(c)).not.toContain('paid-key');
 expect(JSON.stringify(c)).not.toContain('production-token');
 expect(c.worker.E2E_READER_ORIGIN).toBe('http://127.0.0.1:18125');
});
it('requires an explicit live mode and key while retaining the local database', () => {
 expect(() => researchE2eConfig({ appPort:18120, workerPort:18121, fixturePort:18124, readerPort:18125, live:true, environment:{} })).toThrow('OPENROUTER_API_KEY');
 const c = researchE2eConfig({ appPort:18120, workerPort:18121, fixturePort:18124, readerPort:18125, live:true, environment:{OPENROUTER_API_KEY:'live-key'} });
 expect(c.worker.OPENROUTER_API_KEY).toBe('live-key');
 expect(c.app.DATABASE_URL).toContain('127.0.0.1:5434');
});
it('rejects invalid or colliding ports', () => {
 expect(() => researchE2eConfig({appPort:18120,workerPort:18120,fixturePort:18124,readerPort:18125})).toThrow();
 expect(() => researchE2eConfig({appPort:80,workerPort:18121,fixturePort:18124,readerPort:18125})).toThrow();
});

it('accepts only deterministic benchmark stages and applies cumulative flag defaults',async()=>{
 const {parseResearchE2eArguments,researchBenchmarkStages}=await import('./research-e2e-config.mjs');
 expect(parseResearchE2eArguments(['--benchmark-stage=legacy'])).toEqual({live:false,benchmarkStage:'legacy'});
 expect(researchBenchmarkStages.legacy).toEqual({telemetryBatching:false,progressCoalescing:false,schedulerCoalescing:false});
 expect(researchBenchmarkStages.scheduler).toEqual({telemetryBatching:true,progressCoalescing:true,schedulerCoalescing:true});
 expect(()=>parseResearchE2eArguments(['--live','--benchmark-stage=telemetry'])).toThrow();
 expect(()=>parseResearchE2eArguments(['--benchmark-stage=unknown'])).toThrow();
 const c=researchE2eConfig({appPort:18120,workerPort:18121,fixturePort:18124,readerPort:18125,secret:'s',authSecret:'a',benchmarkStage:'progress'});
 expect(c.app.RESEARCH_TELEMETRY_BATCHING).toBe('true');expect(c.app.RESEARCH_PROGRESS_COALESCING).toBe('true');expect(c.app.RESEARCH_SCHEDULER_COALESCING).toBe('false');
});
