import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { expect, it } from 'vitest';
import source from './abs-ebitda-benchmarks.json';

type Observation = {period:string;employmentThousands:number;ebitdaMillions:number;cells:string;salesServiceIncomeMillions?:number|null;salesServiceIncomeCell?:string;salesServiceIncomeMissingReason?:string};
const benchmarks = source.benchmarks as Array<Omit<typeof source.benchmarks[number], 'observations'> & {observations:Observation[]}>;
it('sources revenue EBITDA denominators from sales and service income in matching ABS periods and units', () => {
  expect(source).toMatchObject({ revenueDenominator: { metric: 'Sales and service income', units: 'AUD millions (current prices)' } });
  for (const benchmark of benchmarks) for (const observation of benchmark.observations) {
    if (observation.salesServiceIncomeMillions === null) expect(observation.salesServiceIncomeMissingReason).toBe('ABS source cell blank (denominator unavailable)');
    else {
      expect(observation.salesServiceIncomeMillions, `${benchmark.id}/${observation.period}`).toEqual(expect.any(Number));
      expect(observation.salesServiceIncomeMillions).toBeGreaterThan(0);
    }
    const row = observation.cells.match(/\d+/)![0];
    const column = benchmark.sheet === 'Table_1' ? 'D' : { '2022-23': 'H', '2023-24': 'I', '2024-25': 'J' }[observation.period];
    expect(observation.salesServiceIncomeCell).toBe(`${column}${row}`);
  }
});
it('matches independently inspected subdivision, division and size-band sales cells without using total income', () => {
  const observations = (id:string) => benchmarks.find(b=>b.id===id)!.observations;
  expect(observations('division-manufacturing').map(o=>o.salesServiceIncomeMillions)).toEqual([507581,515438,551184]);
  expect(observations('anzsic-73').map(o=>o.salesServiceIncomeMillions)).toEqual([25903,28192,30321]);
  expect(observations('size-manufacturing-20-199').map(o=>o.salesServiceIncomeMillions)).toEqual([129755,128555,131332]);
});
it('preserves every existing headcount benchmark, population, EBITDA value and source locator', () => {
  const legacy=benchmarks.map(({observations,...benchmark})=>({...benchmark,observations:observations.map(({period,employmentThousands,ebitdaMillions,cells})=>({period,employmentThousands,ebitdaMillions,cells}))}));
  expect(createHash('sha256').update(JSON.stringify(legacy)).digest('hex')).toBe('ac5f8e37341735d86e3637a839dcce4d975bfa8bb7b587a1fce809e27aaa9342');
});
it('retains loss-making industries instead of inventing positive revenue margins', () => {
  const observation=benchmarks.find(b=>b.id==='anzsic-89')!.observations.find(o=>o.period==='2024-25')!;
  expect(observation.ebitdaMillions).toBe(-19);
  expect(observation.salesServiceIncomeMillions).toBeGreaterThan(0);
  expect(observation.ebitdaMillions/observation.salesServiceIncomeMillions!).toBeLessThan(0);
});

it('does not fabricate revenue denominators for blank ABS source cells', () => {
  expect(benchmarks.flatMap(b=>b.observations.filter(o=>o.salesServiceIncomeMillions===null).map(o=>`${b.id}/${o.period}/${o.salesServiceIncomeCell}`))).toEqual(['anzsic-15/2024-25/D77','anzsic-17/2022-23/D83','anzsic-17/2024-25/D85','anzsic-25/2022-23/D115']);
});

it('source parser distinguishes missing and non-finite inputs from real zero and losses', () => {
  const result=spawnSync('python3',['-c',"import runpy,json; parser=runpy.run_path('scripts/build-ebitda-benchmarks.py')['number']; print(json.dumps([parser(x) for x in [None,'','np','nan','inf','0','-19','551184']]))"],{encoding:'utf8'});
  expect(result.status).toBe(0);
  expect(JSON.parse(result.stdout)).toEqual([null,null,null,null,null,0,-19,551184]);
});
