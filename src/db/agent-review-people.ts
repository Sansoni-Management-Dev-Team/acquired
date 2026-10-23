import type {PoolClient} from 'pg';
import type {AgentThread} from './agent-store';
import type {AgentChatPersonView} from '@/domain/agent-chat-presentation';
const uuid=/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
/** Optional read-only labels on the caller's scoped transaction. Reuse the
 * approved owned-target projection; this role cannot read target tables directly. */
export async function loadAgentReviewPeople(client:PoolClient,thread:AgentThread,contactIds:string[]):Promise<AgentChatPersonView[]>{
 const ids=[...new Set(contactIds.filter(id=>uuid.test(id)))].slice(0,50);
 if(!ids.length)return [];
 await client.query('SAVEPOINT agent_review_display_people');
 try{
  const rows=(await client.query(`SELECT c.id,c.display_name AS name,c.role,coalesce(candidate->>'companyName',candidate->'target'->>'companyName') AS company
 FROM jsonb_array_elements(public.agent_owned_target_snapshot($1::uuid,$2::uuid[])->'candidates') candidate
 JOIN contacts c ON c.id=(candidate->>'contactId')::uuid AND c.organization_id=$3`,[thread.id,ids,thread.organization_id])).rows;
  return rows.filter(row=>ids.includes(row.id)).map(row=>({id:row.id,...(typeof row.name==='string'&&row.name.trim()?{name:row.name}:{}),...(typeof row.company==='string'&&row.company.trim()?{company:row.company}:{}),...(typeof row.role==='string'&&row.role.trim()?{role:row.role}:{})}));
 }catch{await client.query('ROLLBACK TO SAVEPOINT agent_review_display_people');return [];}
 finally{await client.query('RELEASE SAVEPOINT agent_review_display_people');}
}
