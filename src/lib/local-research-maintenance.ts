type Actor={organizationId:string;userId:string};
type Environment={NODE_ENV?:string;LOCAL_DEVELOPMENT?:string;LOCAL_RESEARCH_MAINTENANCE_ENABLED?:string};
type Ports={query:(sql:string,values?:unknown[])=>Promise<{rows:Record<string,unknown>[]}>,recover:(organizationId:string,mandateId:string,now:number,deadline:number)=>Promise<unknown>,resume:(actor:Actor,id:string)=>Promise<unknown>};
/** Local isolated lane only. Discover owned scopes before calling existing recovery;
 * never invoke the global scheduled dispatcher against the shared local database. */
export async function runLocalResearchMaintenance(env:Environment,actor:Actor,ports:Ports){
 if(env.NODE_ENV!=='development'||env.LOCAL_DEVELOPMENT!=='true'||env.LOCAL_RESEARCH_MAINTENANCE_ENABLED!=='true'||!actor.organizationId||!actor.userId)throw Error('local_research_maintenance_disabled');
 const identity=(await ports.query("SELECT current_database() AS database,shobj_description(oid,'pg_database') AS marker FROM pg_database WHERE datname=current_database()")).rows[0];
 if(identity?.database!=='acquire_agent_mode'||identity.marker!=='acquire-agent-mode-local-only')throw Error('local_research_database_identity_mismatch');
 if(!(await ports.query('SELECT id FROM member WHERE organization_id=$1 AND user_id=$2 LIMIT 1',[actor.organizationId,actor.userId])).rows.length)throw Error('local_research_membership_required');
 const scopes=(await ports.query(`SELECT w.id,w.mandate_id FROM acquisition_workflow_executions w
 JOIN mandates m ON m.id=w.mandate_id AND m.organization_id=w.organization_id AND m.created_by=w.owner_user_id
 WHERE w.organization_id=$1 AND w.owner_user_id=$2 AND w.preset IN ('live','live-research-test') AND (w.state IN ('accepted','researching') OR (w.state IN ('ready','complete') AND EXISTS(SELECT 1 FROM research_jobs j WHERE j.organization_id=w.organization_id AND j.mandate_id=w.mandate_id AND j.created_by=w.owner_user_id AND j.workflow_execution_id=w.id AND j.status NOT IN ('complete','partial','failed','cancelled'))))
 ORDER BY w.updated_at,w.id LIMIT 2`,[actor.organizationId,actor.userId])).rows;
 const deadline=performance.now()+10000;let recovered=0;
 for(const scope of scopes){if(performance.now()>=deadline)break;await ports.recover(actor.organizationId,String(scope.mandate_id),Date.now(),deadline);await ports.resume(actor,String(scope.id));recovered++;}
 return recovered;
}
