import {expect,it,vi} from 'vitest';
vi.mock('server-only',()=>({}));const m=vi.hoisted(()=>({db:vi.fn(),query:vi.fn()}));vi.mock('@/db/campaign-client',()=>({withCampaignDb:m.db}));
import {recordManagedConnection,saveManagedDefault,readManagedDefaults,resolveRecordedApplicationConnection} from './communications-bindings';
const actor={organizationId:'org',userId:'owner'},binding={applicationId:'acquire',tenantId:'org',ownerId:'owner',connectionId:'c',accountId:'a',generation:1,channel:'email' as const,platform:'gmail' as const,backend:'unipile' as const},connection={binding,label:'owner@example.test',status:'syncing' as const,capabilities:{messaging:{send:true,durableIdempotency:true,receiptLookup:true},events:{read:true,history:true,realtime:true}},readiness:{status:'waiting' as const,code:'incomplete' as const},isDefault:true};
it('records a current non-default connection without changing any primary selection or existing work',async()=>{
 m.db.mockImplementation(async(_actor,work)=>work({query:m.query}));
 m.query.mockImplementation(async(sql:string)=>({rows:sql.includes('INSERT INTO public.communication_bindings')?[{id:'other-lane-binding'}]:[]}));
 m.query.mockClear();
 expect(await recordManagedConnection(actor,{...connection,isDefault:false})).toBe('other-lane-binding');
 const statements=m.query.mock.calls.map(c=>c[0]);
 expect(statements.some(s=>s.includes('communication_defaults')||s.includes('campaign_channel_bindings')||s.includes('outreach_draft_bindings')||/UPDATE|DELETE/.test(s))).toBe(false);
});
it('rejects foreign owners, inactive states and a conflicting immutable generation when recording without selection',async()=>{
 m.db.mockClear();await expect(recordManagedConnection(actor,{...connection,binding:{...binding,ownerId:'foreign'}})).rejects.toThrow();expect(m.db).not.toHaveBeenCalled();
 await expect(recordManagedConnection(actor,{...connection,status:'disconnected'})).rejects.toThrow();
 m.db.mockImplementation(async(_actor,work)=>work({query:m.query}));m.query.mockResolvedValue({rows:[{id:'existing',service_account_id:'different',platform:'gmail',backend:'unipile',authority:'service',channel:'email'}]});
 await expect(recordManagedConnection(actor,{...connection,isDefault:false})).rejects.toThrow();
});
it('commits an immutable service binding and a default for NEW work in one scoped transaction',async()=>{
 const calls:string[]=[];m.query.mockImplementation(async(sql:string)=>{calls.push(sql);return {rows:sql.includes('INSERT INTO public.communication_bindings')?[{id:'local-binding'}]:[],rowCount:1};});m.db.mockImplementation(async(_actor,work)=>{await work({query:m.query});calls.push('COMMIT');});await saveManagedDefault(actor,connection);expect(calls.at(-1)).toBe('COMMIT');expect(calls.some(s=>s.includes('campaign_channel_bindings'))).toBe(false);expect(calls.some(s=>s.includes('communication_defaults'))).toBe(true);expect(m.db).toHaveBeenCalledWith(actor,expect.any(Function));
});
it('selects an existing immutable binding without demanding an UPDATE privilege',async()=>{m.db.mockImplementation(async(_actor,work)=>work({query:m.query}));m.query.mockImplementation(async(sql:string)=>{if(sql.includes('FROM public.communication_bindings')&&/FOR UPDATE/i.test(sql))throw Error('42501: immutable binding is read-only');return {rows:sql.includes('FROM public.communication_bindings')?[{id:'local-binding',service_account_id:'a',platform:'gmail',backend:'unipile',authority:'service',channel:'email'}]:[]};});await expect(saveManagedDefault(actor,connection)).resolves.toBeUndefined();});
it('rejects another owner and immutable generation conflicts without selecting a new backend',async()=>{
 m.db.mockClear();await expect(saveManagedDefault(actor,{...connection,binding:{...binding,ownerId:'other'}})).rejects.toThrow();expect(m.db).not.toHaveBeenCalled();
 m.db.mockImplementation(async(_actor,work)=>work({query:m.query}));m.query.mockResolvedValue({rows:[{id:'local-binding',service_account_id:'wrong',platform:'gmail',backend:'unipile',authority:'service',channel:'email'}]});await expect(saveManagedDefault(actor,connection)).rejects.toThrow();
});
it('reads only recorded owner-scoped defaults with exact account and generation',async()=>{m.db.mockImplementation(async(_actor,work)=>work({query:m.query}));m.query.mockResolvedValue({rows:[{channel:'email',connection_id:'c',generation:1,account_id:'a'}]});expect(await readManagedDefaults(actor)).toEqual([{channel:'email',connectionId:'c',generation:1,accountId:'a'}]);});
it('resolves an immutable work binding and leaves an unbound historical enrolment unresolved',async()=>{
 m.db.mockImplementation(async(_actor,work)=>work({query:m.query}));m.query.mockResolvedValueOnce({rows:[{id:'local-binding',application_id:'acquire',organization_id:'org',owner_user_id:'owner',service_connection_id:'original-c',service_account_id:'original-a',generation:1,channel:'email',platform:'gmail',backend:'unipile',authority:'service',recovery_only:false}]});
 expect(await resolveRecordedApplicationConnection(actor,'email',{enrolmentId:'enrolment'})).toMatchObject({bindingId:'local-binding',binding:{connectionId:'original-c',generation:1},recoveryOnly:false});
 m.query.mockResolvedValueOnce({rows:[]});expect(await resolveRecordedApplicationConnection(actor,'email',{enrolmentId:'old-unbound'})).toBeNull();expect(m.query.mock.lastCall?.[0]).not.toContain('communication_defaults');
});

it('records the same verified immutable generation through an explicit scoped pool without selecting defaults',async()=>{const pool={connect:vi.fn()},options={pool};m.db.mockImplementation(async(_actor,work)=>work({query:m.query}));m.query.mockImplementation(async(sql:string)=>({rows:sql.includes('FROM public.communication_bindings')?[{id:'owned-original',service_account_id:'a',platform:'gmail',backend:'unipile',authority:'service',channel:'email'}]:[]}));expect(await recordManagedConnection(actor,{...connection,isDefault:false},options)).toBe('owned-original');expect(m.db).toHaveBeenLastCalledWith(actor,expect.any(Function),options);expect(m.query.mock.lastCall?.[0]).not.toMatch(/INSERT|UPDATE|DELETE/);});
it('reads defaults without the mutation send gate while preserving the scoped actor',async()=>{
 m.db.mockClear();m.query.mockClear();m.db.mockImplementation(async(_actor,work)=>work({query:m.query}));m.query.mockResolvedValue({rows:[]});
 await readManagedDefaults(actor);
 expect(m.db).toHaveBeenCalledWith(actor,expect.any(Function),{readOnly:true});
 expect(m.query.mock.calls.every(([sql])=>/^SELECT /.test(sql))).toBe(true);
});
