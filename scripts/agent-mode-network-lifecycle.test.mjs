import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {agentModeLauncherServices} from './agent-mode-launcher-services.mjs';

// Deliberately constrained reader for the checked-in Compose service sections.
// It does not render Compose or invoke Docker. Assertions below validate every
// field the fake command adapter consumes, including all profile overlays.
function definitions(file){
 const source=readFileSync(new URL('../ops/agent-mode/'+file,import.meta.url),'utf8');
 const services=source.split('\nservices:\n')[1]?.split('\nvolumes:\n')[0]??'';
 return Object.fromEntries([...services.matchAll(/^  ([a-z][a-z0-9-]*):\n([\s\S]*?)(?=^  [a-z][a-z0-9-]*:\n|$(?![\s\S]))/gm)].map(([,name,body])=>[name,{
  body,networkMode:/^    network_mode: "([^"]+)"$/m.exec(body)?.[1],
  ports:[...( /^    ports:\n((?:      .*\n)+)/m.exec(body)?.[1]??'').matchAll(/^      - "([^"]+)"$/gm)].map(m=>m[1]),
  labels:/^    labels:\n((?:      .*\n)+)/m.exec(body)?.[1]??'',
 }]));
}
const base=()=>definitions('compose.local.yml');
const dependentNames=['app','transports','agent','research','communications','setup-callback','simulator-bridge'];
function profile(file){const result=base();for(const [name,value]of Object.entries(definitions(file)))result[name]={...result[name],...value};return result;}
class FakeDockerCommands{
 constructor(config){this.config=config;this.containers=new Map();this.calls=[];this.serial=0;}
 start(name){const definition=this.config[name];assert.ok(definition,'configured service '+name);const shared=definition.networkMode?.replace(/^service:/,'');if(shared&&!this.containers.has(shared))this.start(shared);this.containers.set(name,{state:'running',namespace:shared?this.containers.get(shared).namespace:'net-'+(++this.serial),authorization:'unchanged-'+name});}
 async command(args){this.calls.push(args);assert.equal(args[0],'restart');const container=this.containers.get(args[1]);assert.ok(container);const owner=this.config[args[1]].networkMode?.replace(/^service:/,'');container.namespace=owner?this.containers.get(owner).namespace:'net-'+(++this.serial);container.state='running';}
}
test('automatic app restart retains all six sidecars in the same actual configured namespace',async()=>{
 const fake=new FakeDockerCommands(profile('compose.multichannel.yml'));for(const name of dependentNames)fake.start(name);
 const namespace=fake.containers.get('transports').namespace,authorization=[...fake.containers].map(([name,value])=>[name,value.authorization]);
 await fake.command(['restart','app']);
 assert.ok(dependentNames.every(name=>fake.containers.get(name).namespace===fake.containers.get('app').namespace),'live sidecars must still reach the restarted app loopback');
 assert.equal(fake.containers.get('app').namespace,namespace);assert.deepEqual([...fake.containers].map(([name,value])=>[name,value.authorization]),authorization);assert.deepEqual(fake.calls,[['restart','app']]);
});
test('automatic app restart never starts deliberately stopped or paused sidecars',async()=>{
 const fake=new FakeDockerCommands(profile('compose.multichannel.yml'));for(const name of dependentNames)fake.start(name);fake.containers.get('agent').state='stopped';fake.containers.get('communications').state='paused';
 await fake.command(['restart','app']);assert.equal(fake.containers.get('agent').state,'stopped');assert.equal(fake.containers.get('communications').state,'paused');assert.deepEqual(fake.calls,[['restart','app']]);
 assert.equal(fake.containers.get('transports').namespace,fake.containers.get('app').namespace);
});
test('inert namespace owner is independent of app rebuilds and carries no source, secrets, database or Docker socket',()=>{
 const services=base(),owner=services.network;assert.ok(owner,'dedicated namespace owner required');assert.match(owner.body,/^    image: node:22\.12\.0$/m);assert.match(owner.body,/^    command: \["node", "-e", "setInterval\(\(\) => \{\}, 2147483647\)"\]$/m);
 assert.doesNotMatch(owner.body,/^    (?:build|volumes|env_file|environment|network_mode):/m);assert.doesNotMatch(owner.body,/docker\.sock|\/workspace/);assert.match(owner.body,/^    restart: unless-stopped$/m);
 for(const name of dependentNames.filter(n=>n!=='simulator-bridge'))assert.equal(services[name].networkMode,'service:network',name);
});
test('published application ports and OrbStack labels belong only to the stable owner',()=>{
 const services=base();assert.deepEqual(services.network?.ports,['127.0.0.1:3026:3000','127.0.0.1:5462:5462']);assert.match(services.network.labels,/dev\.orbstack\.domains: acquire-agent\.orb\.local/);assert.match(services.network.labels,/dev\.orbstack\.http-port: "3000"/);assert.deepEqual(services.app.ports,[]);assert.equal(services.app.labels,'');
 for(const [file,port]of [['compose.simulator.yml','127.0.0.1:5492:5491'],['compose.simulator25.yml','127.0.0.1:5592:5591'],['compose.simulator50.yml','127.0.0.1:5692:5691'],['compose.multichannel.yml','127.0.0.1:5792:5791']]){const overlay=definitions(file);assert.deepEqual(overlay.network?.ports,[port],file);assert.ok(!overlay.app,file+' must not publish from a shared-namespace app');assert.equal(overlay['simulator-bridge'].networkMode,'service:network');}
});
test('controlled app restart selects stable owner but continues withholding an explicitly stopped native worker',()=>{
 const result=agentModeLauncherServices({restartApp:true,workerStopped:true,simulated:true,communications:true});assert.deepEqual(result.up.slice(0,2),['network','app']);assert.ok(!result.up.includes('agent'));assert.ok(!result.rebind.includes('agent'));assert.equal(result.startWorkerAfterHealth,false);
});
test('replacing the namespace owner is explicitly a separate controlled rebind boundary',async()=>{
 const fake=new FakeDockerCommands(profile('compose.multichannel.yml'));for(const name of dependentNames)fake.start(name);await fake.command(['restart','network']);assert.notEqual(fake.containers.get('network').namespace,fake.containers.get('app').namespace);assert.ok(dependentNames.every(name=>fake.containers.get(name).state==='running'));assert.deepEqual(fake.calls,[['restart','network']]);
});
