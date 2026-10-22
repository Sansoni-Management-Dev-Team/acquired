import {timingSafeEqual} from 'node:crypto';
import {runNativeAgentTick} from '@/lib/agent-native-tick';
export const runtime='nodejs';
export const maxDuration=60;
const headers={'Cache-Control':'private, no-store'};
let running:ReturnType<typeof runNativeAgentTick>|undefined;
export async function POST(request:Request){
 const expected=process.env.AGENT_WORKER_SECRET,supplied=request.headers.get('authorization')?.match(/^Bearer\s+(.+)$/i)?.[1];
 if(!expected||!supplied)return Response.json({error:'Unauthorised'},{status:401,headers});
 const left=Buffer.from(expected),right=Buffer.from(supplied);
 if(left.length!==right.length||!timingSafeEqual(left,right))return Response.json({error:'Unauthorised'},{status:401,headers});
 // A caller may time out while its database work is still rolling back.
 // Share that pass in this persistent process instead of starting another.
 try{return Response.json(await (running??=runNativeAgentTick().finally(()=>{running=undefined;})),{headers});}
 catch{return Response.json({error:'Native worker failed; saved work requires inspection.'},{status:500,headers});}
}
