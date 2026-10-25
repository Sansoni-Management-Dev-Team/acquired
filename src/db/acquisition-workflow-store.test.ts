import {describe,it,expect,vi} from 'vitest';
import {AcquisitionWorkflowStore} from './acquisition-workflow-store';
const actor={organizationId:'org',userId:'owner'},id='6b954126-cd24-4633-93f0-a9a3425069ec';
const row={id,mandate_id:'b5488ded-ce8e-4260-a59a-f15cab0c2378',organization_id:'org',owner_user_id:'owner',preset:'demo',presentation:'agent',state:'accepted',revision:1,error_code:null};
function fixture(fail=false){const query=vi.fn(async(sql:string)=>{if(sql.includes('workflow-demo-existing'))return{rows:[row]};if(sql.includes('SELECT id FROM member'))return{rows:[{id:'member'}],rowCount:1};if(sql==='SELECT id FROM acquisition_workflow_executions WHERE id=$1')return{rows:[{id}]};if(sql.includes('acquisition_workflow_start')){if(fail)throw Object.assign(Error('db secret'),{code:'40001'});return {rows:[row]};}return{rows:[],rowCount:0};});const release=vi.fn();return {query,release,pool:{connect:vi.fn(async()=>({query,release}))}};}
describe('durable workflow commands',()=>{
 it('replays legacy database-selected sources with original null arguments and no cloned records',async()=>{
  const f=fixture();const result=await new AcquisitionWorkflowStore(f.pool as never,actor).start({requestId:id,preset:'demo',presentation:'agent'});
  expect(result.mandateId).toBe(row.mandate_id);expect(result.replayed).toBe(true);
  expect(f.query).toHaveBeenCalledWith('SELECT * FROM public.acquisition_workflow_start($1,$2,$3,$4,$5)',[id,'demo','agent',null,null]);
  expect(f.query.mock.calls.map(c=>c[0]).join('\n')).not.toMatch(/INSERT INTO (mandates|contacts|targets|acquisition_memberships)/);
  expect(f.query.mock.calls.at(-1)?.[0]).toBe('COMMIT');expect(f.release).toHaveBeenCalledOnce();
 });
 it('rolls back conflicts and releases the connection without another start',async()=>{
  const f=fixture(true);await expect(new AcquisitionWorkflowStore(f.pool as never,actor).start({requestId:id,preset:'demo',presentation:'agent'})).rejects.toMatchObject({code:'40001'});
  expect(f.query.mock.calls.at(-1)?.[0]).toBe('ROLLBACK');expect(f.release).toHaveBeenCalledOnce();
  expect(f.query.mock.calls.filter(c=>c[0].includes('acquisition_workflow_start'))).toHaveLength(1);
 });
 it('reads through the restricted actor role without accepting owner identity from a client',async()=>{
  const f=fixture();expect(await new AcquisitionWorkflowStore(f.pool as never,actor).read(id)).toBeNull();
  expect(f.query).toHaveBeenCalledWith('BEGIN READ ONLY');expect(f.query).toHaveBeenCalledWith('SET LOCAL ROLE acquire_agent_user');
  expect(f.query).toHaveBeenCalledWith(expect.stringContaining("set_config('app.acquire_org'"),['org','owner']);
 });
});
