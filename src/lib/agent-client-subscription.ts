import type {HttpAgent} from '@ag-ui/client';
/** React subscribes directly to the open AG-UI client. The view owns no worker,
 * authority or orchestration state, and requires no hosted/enterprise wrapper. */
export function createAgentClientSubscription(agent:Pick<HttpAgent,'subscribe'>){
 let version=0;
 return {
  getSnapshot:()=>version,getServerSnapshot:()=>0,
  subscribe(listener:()=>void){
   const changed=()=>{version++;listener();};
   return agent.subscribe({onMessagesChanged:changed,onStateChanged:changed}).unsubscribe;
  },
 };
}
