import {configuredAcquireCommunications} from '../src/lib/communications-configuration';
import {createAcquireCommunicationsService} from '../src/lib/communications-service';
async function main(){
 if(!process.argv.includes('--serve'))throw Error('Explicit --serve is required');
 const port=Number(process.env.COMMUNICATIONS_PORT||5461),host=process.env.COMMUNICATIONS_LISTEN_HOST||'127.0.0.1';
 if(!Number.isSafeInteger(port)||port<1||port>65535||!['127.0.0.1','0.0.0.0'].includes(host))throw Error('Invalid listener');
 const service=await createAcquireCommunicationsService(configuredAcquireCommunications());
 service.server.listen(port,host,()=>process.stdout.write(JSON.stringify({event:'communications_listening',port})+'\n'));
 service.server.on('error',()=>{process.stderr.write('Communications listener failed\n');process.exitCode=1;});
 const timer=setInterval(()=>{void service.tick().catch(()=>process.stderr.write('Communications worker deferred\n'));},3000);
 for(const signal of ['SIGINT','SIGTERM'] as const)process.once(signal,()=>{clearInterval(timer);void service.close().finally(()=>process.exit());});
}
void main().catch(()=>{process.stderr.write('Communications startup unavailable; check private configuration and approved storage\n');process.exitCode=1;});
