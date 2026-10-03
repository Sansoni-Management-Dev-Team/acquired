import { expect, it } from 'vitest';
import { chooseBalancedTask } from './balanced-research';
const task=(domain:string,lane:string)=>({id:`${domain}:${lane}`,config:{companyDomain:domain,researchTask:lane==='page'?'page':lane==='website'?'website':'field',researchField:['page','website'].includes(lane)?undefined:lane}});
it('starts every field despite a large website backlog',()=>{
 const pending=Array.from({length:90},(_,i)=>['website','abn','size','revenue','people','email'].map(f=>task(`c${i}`,f))).flat(); const active:ReturnType<typeof task>[]=[];
 for(let i=0;i<12;i++){const next=chooseBalancedTask(pending,active);expect(next).toBeDefined();active.push(next!);pending.splice(pending.indexOf(next!),1);}
 expect(new Set(active.map(t=>t.config.researchField||t.config.researchTask))).toEqual(new Set(['website','abn','size','revenue','people','email']));
 expect(new Set(active.map(t=>t.config.companyDomain)).size).toBe(12);
});
it('does not let a slow ABN wave starve other fields',()=>{
 const pending=[task('one','abn'),task('two','size'),task('three','people')];
 expect(chooseBalancedTask(pending,Array.from({length:8},(_,i)=>task(`c${i}`,'abn')))?.config.researchField).toBe('size');
});
it('reserves page progress without letting sitemap jobs consume the pool',()=>{
 const pending=[...Array.from({length:100},(_,i)=>task(`p${i}`,'page')),task('one','abn')];
 const active=Array.from({length:4},(_,i)=>task(`p${i}`,'page'));
 expect(chooseBalancedTask(pending,active)?.config.researchField).toBe('abn');
});
