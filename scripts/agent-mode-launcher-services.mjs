/** Local launcher process selection, never native execution authorization. */
export function agentModeLauncherServices({workerStopped=false,restartApp=false,simulated=false,communications=false}={}){
 const holdWorker=workerStopped||restartApp;
 const sidecars=['transports','reader','research',...(!holdWorker?['agent']:[]),...(simulated?['simulator-bridge']:[]),...(communications?['communications','setup-callback']:[])];
 return {up:holdWorker?['network','app',...sidecars]:[],rebind:sidecars,stopWorkerBeforeUp:restartApp&&!workerStopped,startWorkerAfterHealth:restartApp&&!workerStopped};
}
