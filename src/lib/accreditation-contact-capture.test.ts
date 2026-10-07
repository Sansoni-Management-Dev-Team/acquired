import { beforeEach,expect,it,vi } from 'vitest';
vi.mock('@/adapters/accreditation-register',async original=>({...await original<typeof import('@/adapters/accreditation-register')>(),readAccreditationContact:vi.fn()}));
vi.mock('@/db/accreditation-contacts',()=>({saveAccreditationContact:vi.fn()}));
import { readAccreditationContact } from '@/adapters/accreditation-register';
import { saveAccreditationContact } from '@/db/accreditation-contacts';
import { captureAccreditationContacts } from './accreditation-contact-capture';
const source='https://nata.com.au/accredited-organisation/synthetic-12345-67890/';
const database={} as Parameters<typeof captureAccreditationContacts>[0];
const input={organizationId:'synthetic-org',targetId:'synthetic-target',domain:'synthetic.example.test',deadline:Date.now()+30000,raw:{org_registers:[{url:source},{url:source}]}};
beforeEach(()=>vi.resetAllMocks());
it('retained register URL capture uses exact target domain and source, and saves independently of executive admission',async()=>{
 const contact={name:'Avery Morgan',phone:'+61 0400 000 999',role:'Accreditation contact' as const,sourceUrl:source,registry:'NATA' as const,accreditationNumber:'12345',siteNumber:'67890',capturedAt:'2026-10-08T00:00:00Z'};
 vi.mocked(readAccreditationContact).mockResolvedValue(contact);
 expect(await captureAccreditationContacts(database,input)).toEqual({saved:1,failed:0});
 expect(readAccreditationContact).toHaveBeenCalledExactlyOnceWith(source,input.domain,input.deadline);
 expect(saveAccreditationContact).toHaveBeenCalledExactlyOnceWith(database,input.organizationId,input.targetId,contact);
});
it('missing register URLs never invent a lookup or launch a paid phone request',async()=>{
 expect(await captureAccreditationContacts(database,{...input,raw:{description:source}})).toEqual({saved:0,failed:0});
 expect(readAccreditationContact).not.toHaveBeenCalled();expect(saveAccreditationContact).not.toHaveBeenCalled();
});
it('unavailable registry is classified separately without discarding an already saved profile',async()=>{
 vi.mocked(readAccreditationContact).mockRejectedValue(Error('timeout'));
 expect(await captureAccreditationContacts(database,input)).toEqual({saved:0,failed:1});expect(saveAccreditationContact).not.toHaveBeenCalled();
});
