// Serialize live experiments across the shared CPU, reader host and AI account.
import {mkdirSync,readFileSync,writeFileSync,rmSync,readdirSync,existsSync} from 'node:fs';
import {resolve} from 'node:path';
import {spawn} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {summarizeDesignPairs} from './research-design-results.mjs';
const args=process.argv.slice(2),mode=args[0],get=(name,fallback)=>{const i=args.indexOf(`--${name}`);return i<0?fallback:args[i+1];};
const pause=ms=>new Promise(r=>setTimeout(r,ms));const directory=resolve('.local-data/research-design');mkdirSync(directory,{recursive:true,mode:0o700});
const wait=get('wait-for');if(wait)for(const end=Date.now()+90*60000;!existsSync(wait);){if(Date.now()>end)throw Error('Prior experiment did not finish');await pause(1000);}
const lock=resolve(directory,'suite.lock'),token=randomUUID();
try{mkdirSync(lock);}catch{
 let owner;try{owner=JSON.parse(readFileSync(resolve(lock,'owner.json')));}catch{throw Error('Benchmark lock is occupied');}
 let alive=true;try{process.kill(owner.pid,0);}catch(e){if(e.code==='ESRCH')alive=false;}
 if(alive)throw Error('Another live benchmark/probe suite is running');
 rmSync(lock,{recursive:true});mkdirSync(lock);
}
writeFileSync(resolve(lock,'owner.json'),JSON.stringify({pid:process.pid,token,startedAt:new Date().toISOString()}),{mode:0o600});
function child(script,argv){return new Promise((yes,no)=>{const p=spawn(process.execPath,[resolve('scripts',script),...argv],{stdio:'inherit'});p.once('error',no);p.once('exit',code=>code===0?yes():no(Error(`${script} exited ${code}`)));});}
async function ensureIdle(){for(const name of readdirSync(directory)){const path=resolve(directory,name);if(!existsSync(resolve(path,'manifest.json'))||existsSync(resolve(path,'failure.json'))||existsSync(resolve(path,'final.json')))continue;let m;try{m=JSON.parse(readFileSync(resolve(path,'manifest.json')));}catch{continue;}if(!/^http:\/\/127\.0\.0\.1:\d+$/.test(m.appOrigin||''))continue;try{await fetch(m.appOrigin+'/api/mandates',{signal:AbortSignal.timeout(500)});throw Error(`Experiment ${name} is still running`);}catch(e){if(e.message.startsWith('Experiment'))throw e;}}}
try{
 await ensureIdle();
 if(mode==='pair'){
 const baseline=get('baseline');if(!baseline)throw Error('Pass --baseline DIR');const repeats=Number(get('repetitions','1')),order=get('order','BA');if(!Number.isInteger(repeats)||repeats<1||repeats>10||!(/^[ABCDEF]{2}$/.test(order)&&new Set(order).size===2))throw Error('Use 1–10 repetitions and two distinct designs from A/B/C/D/E/F');
 const [reference,candidate]=[...order].sort();
 const session=resolve(get('out',`.local-data/research-design/pair-${Date.now()}`));mkdirSync(session,{recursive:true,mode:0o700});
 const pairs=[];
 for(let n=0;n<repeats;n++){const actual=n%2?[...order].reverse():[...order];for(const design of actual)await child('research-design-benchmark.mjs',['run','--design',design,'--baseline',baseline,'--out',resolve(session,`${design}-${n+1}`)]);await child('research-design-benchmark.mjs',['compare','--a',resolve(session,`${reference}-${n+1}/final.json`),'--b',resolve(session,`${candidate}-${n+1}/final.json`)]);pairs.push({a:JSON.parse(readFileSync(resolve(session,`${reference}-${n+1}/final.json`))),b:JSON.parse(readFileSync(resolve(session,`${candidate}-${n+1}/final.json`)))});writeFileSync(resolve(session,'comparison.json'),JSON.stringify(summarizeDesignPairs(pairs),null,2),{mode:0o600});}
 }else if(mode==='e2e'){const forwarded=args.slice(1);const i=forwarded.indexOf('--wait-for');if(i>=0)forwarded.splice(i,2);await child('test-research-e2e.mjs',forwarded);}
 else if(mode==='probe')await child('probe-free-models.mjs',args.slice(1));
 else await child('research-design-benchmark.mjs',args);
}finally{let owner;try{owner=JSON.parse(readFileSync(resolve(lock,'owner.json')));}catch{}if(owner?.token===token)rmSync(lock,{recursive:true});}
