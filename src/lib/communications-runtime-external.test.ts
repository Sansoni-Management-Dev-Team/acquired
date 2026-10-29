import{it,expect,vi}from'vitest';vi.mock('server-only',()=>({}));
const capture=vi.hoisted(()=>vi.fn((options:unknown)=>{void options;return{drain:vi.fn(),proof:vi.fn()};}));
vi.mock('./communications-retained-outbound',()=>({createRetainedOutboundReview:capture}));
import{createAcquireCommunicationsRuntime}from'./communications-runtime';
import{JournalCodec}from'../../communications/packages/core/src/journal-codec';
import{AccountRuntimeVault}from'../../communications/packages/storage-postgres/src/account-vault';
it('wires canonical lowercase recipient digest and exact tracking scope through the actual runtime composition',()=>{
 const vault={activeVersion:'v1',keys:[{version:'v1',encryptionKey:Buffer.alloc(32,11),digestKey:Buffer.alloc(32,12)}],identityKey:Buffer.alloc(32,13),identityKeyVersion:'identity-v1'};
 createAcquireCommunicationsRuntime({unipile:{}as never,serviceOptions:{applicationId:'acquire',pool:{},vault}as never,applicationPool:{}as never,applicationCodec:new JournalCodec(vault),scopedAuthKey:Buffer.alloc(32,7),subscriberId:'acquire',quota:{account:{hour:10,day:20},application:{hour:30,day:40}}});
 const options=capture.mock.calls[0][0]as unknown as{externalSent:{recipientIdentity(raw:unknown):unknown;trackingDigests(row:unknown,raw:unknown):unknown}};const actual=new AccountRuntimeVault(vault);
 expect(options.externalSent.recipientIdentity({to_attendees:[{identifier:'Person@Example.Test'}]})).toEqual({keyVersion:'identity-v1',digest:actual.physicalIdentityDigest({namespace:'email',value:'person@example.test'})});
 expect(options.externalSent.trackingDigests({integration_id:'integration',provider_configuration_reference:'configuration'},{account_id:'provider',tracking_id:'tracking'})).toEqual([actual.trackingDigest({integrationId:'integration',providerConfigurationReference:'configuration',providerAccountId:'provider',trackingId:'tracking'},'v1')]);
});
