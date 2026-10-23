import {expect,it,vi} from 'vitest';
import {loadAcceptedCompanyObservations} from './company-observation-read-model';
import {PgDialect} from 'drizzle-orm/pg-core';
const mandateId='00000000-0000-4000-8000-000000000001',targetId='00000000-0000-4000-8000-000000000002',observationId='00000000-0000-4000-8000-000000000003';
const observation={id:observationId,organizationId:'org-a',mandateId,targetId,inputDigest:'a'.repeat(64),observedAt:'2026-10-18T00:00:00.000Z',sourceFacts:{firmographics:{sector:{value:'Source facts'}},identifiers:{firmableId:'f123'},firmableCompanyId:'f123'}};
it('loads the latest accepted facts only for the requested mandate and company identities',async()=>{
 const execute=vi.fn().mockResolvedValueOnce({rows:[{installed:true}]}).mockResolvedValueOnce({rows:[observation]});
 expect(await loadAcceptedCompanyObservations({execute},'org-a',mandateId,[targetId])).toEqual(new Map([[targetId,{id:observationId,inputDigest:'a'.repeat(64),observedAt:observation.observedAt,sourceFacts:observation.sourceFacts}]]));
 const query=new PgDialect().sqlToQuery(execute.mock.calls[1][0]);expect(query.sql).toContain('DISTINCT ON');expect(query.sql).toContain('observed_at DESC');expect(query.sql).toContain('created_at DESC');expect(query.params).toContain('org-a');expect(query.params).toContain(mandateId);expect(query.params).toContain(targetId);
});
it('preserves historical reads without the new schema and avoids all work for empty company selections',async()=>{
 const execute=vi.fn().mockResolvedValue({rows:[{installed:false}]});expect((await loadAcceptedCompanyObservations({execute},'org-a',mandateId,[])).size).toBe(0);expect(execute).not.toHaveBeenCalled();
 expect((await loadAcceptedCompanyObservations({execute},'org-a',mandateId,[targetId])).size).toBe(0);expect(execute).toHaveBeenCalledTimes(1);
});
it('normalizes the PostgreSQL timestamptz text returned by the normal Drizzle driver',async()=>{
 const execute=vi.fn().mockResolvedValueOnce([{installed:true}]).mockResolvedValueOnce([{...observation,observedAt:'2026-10-18 00:00:00+00'}]);
 expect((await loadAcceptedCompanyObservations({execute},'org-a',mandateId,[targetId])).get(targetId)?.observedAt).toBe('2026-10-18T00:00:00.000Z');
});
it('refuses foreign, duplicate, unrequested or malformed observations rather than overlaying their facts',async()=>{
 for(const records of [[{...observation,organizationId:'other'}],[{...observation,mandateId:targetId}],[{...observation,targetId:mandateId}],[observation,observation],[{...observation,inputDigest:'invalid'}]]){
  const execute=vi.fn().mockResolvedValueOnce([{installed:true}]).mockResolvedValueOnce(records);
  await expect(loadAcceptedCompanyObservations({execute},'org-a',mandateId,[targetId])).rejects.toThrow();
 }
});
