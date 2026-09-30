import { LOCAL_DATABASE_URL } from './dev-config.mjs';
export const researchBenchmarkStages = {
 legacy:{telemetryBatching:false,progressCoalescing:false,schedulerCoalescing:false},
 telemetry:{telemetryBatching:true,progressCoalescing:false,schedulerCoalescing:false},
 progress:{telemetryBatching:true,progressCoalescing:true,schedulerCoalescing:false},
 scheduler:{telemetryBatching:true,progressCoalescing:true,schedulerCoalescing:true},
};
export function parseResearchE2eArguments(args) {
 let live=false,benchmarkStage=null;
 for(const arg of args) {
  if(arg==='--live'&&!live)live=true;
  else if(arg.startsWith('--benchmark-stage=')&&!benchmarkStage&&Object.hasOwn(researchBenchmarkStages,arg.slice(18)))benchmarkStage=arg.slice(18);
  else throw new Error('Usage: pnpm test:research:e2e [--live | --benchmark-stage=legacy|telemetry|progress|scheduler]');
 }
 if(live&&benchmarkStage)throw new Error('Live smoke and deterministic benchmark stages cannot be combined');
 return {live,benchmarkStage};
}

export function validateLocalTestDatabase(value) {
 const url = new URL(value);
 if (url.protocol !== 'postgresql:' || url.hostname !== '127.0.0.1' || url.port !== '5434' || url.pathname !== '/project_acquire' || url.username !== 'project_acquire' || url.search || url.hash) throw new Error('Research E2E requires the dedicated OrbStack database on 127.0.0.1:5434/project_acquire');
 return value;
}
export function researchE2eConfig({ appPort, workerPort, fixturePort, readerPort, secret, authSecret, live=false, environment={}, benchmarkStage=null }) {
 if(benchmarkStage&&!Object.hasOwn(researchBenchmarkStages,benchmarkStage))throw new Error('Invalid benchmark stage');
 if(live&&benchmarkStage)throw new Error('Benchmark stages require deterministic fixtures');
 const flags=researchBenchmarkStages[benchmarkStage]||researchBenchmarkStages.scheduler;
 const ports=[appPort,workerPort,fixturePort,readerPort];
 if(ports.some(p=>!Number.isInteger(p)||p<1024||p>65535)||new Set(ports).size!==4) throw new Error('E2E ports must be distinct integers between 1024 and 65535');
 if(live&&!environment.OPENROUTER_API_KEY) throw new Error('Live smoke requires OPENROUTER_API_KEY');
 const appOrigin=`http://127.0.0.1:${appPort}`;
 const key=live?environment.OPENROUTER_API_KEY:'fixture-only';
 const base = Object.fromEntries(['PATH','HOME','TMPDIR','USER','SHELL','LANG','PNPM_HOME','XDG_CACHE_HOME'].flatMap(k=>process.env[k]===undefined?[]:[[k,process.env[k]]]));
 return {
  app: { ...base, NODE_ENV:'development', DATABASE_DRIVER:'postgres', DATABASE_URL:validateLocalTestDatabase(LOCAL_DATABASE_URL), DATABASE_SSL_CA:'', BETTER_AUTH_SECRET:authSecret,
   APP_URL:appOrigin,NEXT_PUBLIC_APP_URL:appOrigin, RESEARCH_ENABLED:'true', RESEARCH_WORKER_URL:`http://127.0.0.1:${workerPort}`, RESEARCH_SERVICE_SECRET:secret,
   TARGET_DATA_PROVIDER:'fixture',OPENROUTER_API_KEY:key,AI_PROVIDER:'openrouter-free',AI_VERBOSE_LOGGING:'true',
   RESEARCH_TELEMETRY_BATCHING:String(flags.telemetryBatching),RESEARCH_PROGRESS_COALESCING:String(flags.progressCoalescing),RESEARCH_SCHEDULER_COALESCING:String(flags.schedulerCoalescing), LOCAL_DEVELOPMENT:'true',LOCAL_RESEARCH_POLICY:'production',
  },
  worker: { APP_ORIGIN:appOrigin,LOCAL_DEVELOPMENT:'true',LOCAL_RESEARCH_POLICY:'production',LOCAL_CRAWL4AI_URL:'http://127.0.0.1:18083',SERVICE_SECRET:secret,OPENROUTER_API_KEY:key,
   ...(!live?{E2E_FIXTURE_ORIGIN:`http://127.0.0.1:${fixturePort}`,E2E_READER_ORIGIN:`http://127.0.0.1:${readerPort}`}:{}) },
  reader: { E2E_FIXTURE_ORIGIN:`http://host.docker.internal:${fixturePort}` },
 };
}
