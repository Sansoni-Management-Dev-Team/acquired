import {compareDesigns} from './research-design-metrics.mjs';
const median=values=>{const a=[...values].sort((x,y)=>x-y),i=Math.floor(a.length/2);return a.length%2?a[i]:(a[i-1]+a[i])/2;};
export function summarizeDesignPairs(pairs){
 if(!pairs.length)throw Error('No paired samples');
 const comparisons=pairs.map(({a,b})=>compareDesigns(a,b));
 const fingerprints=new Set(pairs.flatMap(({a,b})=>[a,b].map(r=>JSON.stringify(['caseHash','baselineHash','providerHash','observerHash'].map(k=>r.manifest[k])))));
 const comparable=comparisons.every(c=>c.comparable)&&fingerprints.size===1;
 const durationComparable=comparable&&pairs.every(({a,b})=>a.summary.settled&&b.summary.settled);
 const describe=key=>{const samples=pairs.map(p=>p[key].summary.elapsedMs);return{samples,medianMs:median(samples),minMs:Math.min(...samples),maxMs:Math.max(...samples)};};
 const a=describe('a'),b=describe('b');
 return{designs:{reference:pairs[0].a.manifest.design||'A',candidate:pairs[0].b.manifest.design||'B'},repetitions:pairs.length,comparable,durationComparable,sufficientRepetitions:pairs.length>=3,a,b,medianDurationRatio:durationComparable?b.medianMs/a.medianMs:null,coverage:pairs.map(({a,b})=>({a:a.summary.coverage,b:b.summary.coverage})),comparisons,note:'Deadline/interrupted runs are coverage-within-budget experiments, not successful full-completion speed measurements. Keep raw samples and source evidence; three repetitions are a minimum, not statistical proof.'};
}
