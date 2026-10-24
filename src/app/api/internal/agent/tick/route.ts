import {timingSafeEqual} from 'node:crypto';
import {coalescedNativeAgentTick} from '@/lib/agent-native-tick-coalesced';
export const runtime='nodejs';
export const maxDuration=90;
const headers={'Cache-Control':'private, no-store'};
export async function POST(request:Request){
 const expected=process.env.AGENT_WORKER_SECRET,supplied=request.headers.get('authorization')?.match(/^Bearer\s+(.+)$/i)?.[1];
 if(!expected||!supplied)return Response.json({error:'Unauthorised'},{status:401,headers});
 const left=Buffer.from(expected),right=Buffer.from(supplied);
 if(left.length!==right.length||!timingSafeEqual(left,right))return Response.json({error:'Unauthorised'},{status:401,headers});
 // A caller may time out while its database work is still rolling back.
 // Share that pass in this persistent process instead of starting another.
 try{return Response.json(await coalescedNativeAgentTick(),{headers});}
 catch{return Response.json({error:'Native worker failed; saved work requires inspection.'},{status:500,headers});}
}
