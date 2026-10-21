import {PageLoading} from './page-loading';
/** Loading and final create forms receive the same server-side availability. */
export function ConfiguredPageLoading(){
 return <PageLoading agentModeEnabled={process.env.AGENT_MODE_EXPLORATION_ENABLED==='true'} nativeAgentEnabled={process.env.AGENT_DURABLE_STATE_ENABLED==='true'&&process.env.AGENT_NATIVE_EXECUTION_ENABLED==='true'}/>;
}
