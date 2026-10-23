export async function register(){
 if(process.env.NEXT_RUNTIME==='nodejs'){
  const {initializeAcquireTelemetry}=await import('./lib/langfuse-telemetry');
  initializeAcquireTelemetry();
 }
}
