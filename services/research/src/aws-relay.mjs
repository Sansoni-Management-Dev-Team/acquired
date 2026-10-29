import {createAcquireBridge} from './acquire-bridge.mjs';
if(process.env.RESEARCH_DEPLOYMENT!=='aws-uat')throw Error('Explicit AWS UAT relay configuration required');
const origin='https://app.acquire.pajamaprofits.net';
const secret=process.env.RESEARCH_SERVICE_SECRET;
if(!secret||secret.length<32)throw Error('UAT service secret required');
const server=createAcquireBridge({workerSecret:secret,appSecret:secret,uat:true,appOrigin:origin,appSite:origin});
server.listen(3100,'127.0.0.1');
process.once('SIGTERM',()=>server.close(()=>process.exit(0)));
