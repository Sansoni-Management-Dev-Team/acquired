import{createServer,connect}from'node:net';import{pathToFileURL}from'node:url';
export function demoAppRelayAddresses(env){
 if(env.NODE_ENV!=='development'||env.AGENT_DEMO_COMMUNICATIONS_ENABLED!=='true'||env.AGENT_MODE_COMMUNICATIONS_MODE!=='simulator')throw Error('Explicit local demo relay required');
 return[{port:5890,destinationPort:5893},{port:5891,destinationPort:5892}];
}
/** TLS bytes are forwarded unchanged. No environment or request can choose a destination. */
export async function startDemoAppRelays(env=process.env,net={createServer,connect}){
 const addresses=demoAppRelayAddresses(env),servers=[],sockets=new Set();
 try{for(const address of addresses){
  const server=net.createServer(socket=>{const upstream=net.connect({host:'host.docker.internal',port:address.destinationPort});sockets.add(socket);sockets.add(upstream);for(const[a,b]of[[socket,upstream],[upstream,socket]]){a.setTimeout(30000,()=>a.destroy());a.on('error',()=>b.destroy());a.on('close',()=>{sockets.delete(a);b.destroy();});}socket.pipe(upstream).pipe(socket);});servers.push(server);
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(address.port,'127.0.0.1',resolve);});
 }}catch(error){for(const socket of sockets)socket.destroy();for(const server of servers)server.close();throw error;}
 return{async close(){for(const socket of sockets)socket.destroy();await Promise.all(servers.map(server=>new Promise(resolve=>server.close(resolve))));}};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){startDemoAppRelays().then(relay=>{console.log('Fixed local demo relays ready');for(const signal of['SIGINT','SIGTERM'])process.once(signal,()=>{void relay.close().then(()=>process.exit());});}).catch(()=>{console.error('Demo relays unavailable');process.exitCode=1;});}
