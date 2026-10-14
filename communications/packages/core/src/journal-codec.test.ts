import { describe, expect, it } from 'vitest';
import type { OperationSnapshot } from '../../contracts/src';
import { JournalCodec, type JournalEnvelope } from './journal-codec';
const snapshot:OperationSnapshot={key:'synthetic-operation',payloadDigest:'a'.repeat(64),operation:'message',binding:{applicationId:'app',tenantId:'tenant',ownerId:'owner',connectionId:'connection',accountId:'service-account',generation:1,channel:'whatsapp',platform:'whatsapp',backend:'unipile'}};
const key=(version='v1',value=1)=>({version,encryptionKey:new Uint8Array(32).fill(value),digestKey:new Uint8Array(32).fill(value+1)});
const value={recipient:{kind:'phone',value:'+61400000000'},conversation:{id:'synthetic-chat'}};
const codec=()=>new JournalCodec({activeVersion:'v1',keys:[key()]});
describe('scoped journal encryption',()=>{
  it('encrypts and recovers canonical context without plaintext in envelope',()=>{
    const c=codec(),envelope=c.encode(snapshot,'context',value);
    expect(c.decode(snapshot,'context',envelope)).toEqual(value);expect(envelope.format).toBe('communications-journal-v1');expect(envelope.keyVersion).toBe('v1');
    expect(Buffer.from(envelope.nonce,'base64')).toHaveLength(12);expect(Buffer.from(envelope.tag,'base64')).toHaveLength(16);expect(JSON.stringify(envelope)).not.toContain('+61400000000');
  });
  it('uses different nonce and ciphertext for repeated same input',()=>{const c=codec(),a=c.encode(snapshot,'context',value),b=c.encode(snapshot,'context',value);expect(a.nonce).not.toEqual(b.nonce);expect(a.ciphertext).not.toEqual(b.ciphertext);});
  it.each(['context','receipt','outcome'] as const)('binds %s to its own purpose',purpose=>{
    const c=codec(),envelope=c.encode(snapshot,purpose,value);expect(c.decode(snapshot,purpose,envelope)).toEqual(value);
    const other=purpose==='context'?'receipt':'context';expect(()=>c.decode(snapshot,other,envelope)).toThrow('Invalid journal data');
  });
  it.each(['applicationId','tenantId','ownerId','connectionId','accountId','generation'] as const)('binds encryption to %s',field=>{
    const c=codec(),envelope=c.encode(snapshot,'context',value);const changed={...snapshot,binding:{...snapshot.binding,[field]:field==='generation'?2:'other'}};
    expect(()=>c.decode(changed,'context',envelope)).toThrow('Invalid journal data');
  });
  it.each([{key:'other'},{payloadDigest:'b'.repeat(64)},{operation:'invitation' as const}])('binds full operation snapshot (%#)',patch=>{
    const c=codec(),envelope=c.encode(snapshot,'context',value);expect(()=>c.decode({...snapshot,...patch},'context',envelope)).toThrow('Invalid journal data');
  });
  it.each(['nonce','ciphertext','tag'] as const)('rejects tampered %s',field=>{
    const c=codec(),envelope=c.encode(snapshot,'context',value);const bytes=Buffer.from(envelope[field],'base64');bytes[0]^=1;envelope[field]=bytes.toString('base64');
    expect(()=>c.decode(snapshot,'context',envelope)).toThrow('Invalid journal data');
  });
  it.each([{format:'unknown'},{keyVersion:'missing'},{nonce:'not base64!'},{tag:'YQ=='},{ciphertext:''},{extra:'unsupported'}])('rejects malformed envelope (%#)',patch=>{
    const c=codec(),envelope=c.encode(snapshot,'context',value);expect(()=>c.decode(snapshot,'context',{...envelope,...patch})).toThrow('Invalid journal data');
  });
  it('rejects noncanonical base64',()=>{const c=codec(),envelope=c.encode(snapshot,'context',value);expect(()=>c.decode(snapshot,'context',{...envelope,tag:envelope.tag.replace(/=+$/,'')})).toThrow('Invalid journal data');});
  it('rejects oversized plaintext and ciphertext before processing',()=>{
    const c=new JournalCodec({activeVersion:'v1',keys:[key()],maxPlaintextBytes:128});expect(()=>c.encode(snapshot,'context','x'.repeat(200))).toThrow('Invalid journal data');
    const envelope=codec().encode(snapshot,'context','x'.repeat(200));expect(()=>c.decode(snapshot,'context',envelope)).toThrow('Invalid journal data');
  });
  it('supports retained old keys and explicit digest versions without silent fallback',()=>{
    const old=codec(),envelope=old.encode(snapshot,'context',value);const rotated=new JournalCodec({activeVersion:'v2',keys:[key(),key('v2',3)]});
    expect(rotated.decode(snapshot,'context',envelope)).toEqual(value);expect(rotated.encode(snapshot,'context',value).keyVersion).toBe('v2');
    expect(rotated.digest(snapshot,'context',value,'v1')).toEqual(old.digest(snapshot,'context',value));expect(rotated.digest(snapshot,'context',value)).not.toEqual(old.digest(snapshot,'context',value));
    expect(()=>rotated.digest(snapshot,'context',value,'missing')).toThrow('Invalid journal data');expect(()=>new JournalCodec({activeVersion:'v2',keys:[key('v2',3)]}).decode(snapshot,'context',envelope)).toThrow('Invalid journal data');
  });
  it('copies key material and does not enumerate keys',()=>{
    const material=key();const keys=[material];const c=new JournalCodec({activeVersion:'v1',keys});const envelope=c.encode(snapshot,'context',value),digest=c.digest(snapshot,'context',value);
    material.encryptionKey.fill(50);material.digestKey.fill(60);keys.splice(0);expect(c.decode(snapshot,'context',envelope)).toEqual(value);expect(c.digest(snapshot,'context',value)).toBe(digest);expect(JSON.stringify(c)).toBe('{}');
  });
  it('rejects wrong lengths, duplicate/missing versions and same encryption/digest key',()=>{
    for(const keys of [[{...key(),encryptionKey:new Uint8Array(31)}],[key(),key()],[key('v2')],[{...key(),digestKey:key().encryptionKey}]]) expect(()=>new JournalCodec({activeVersion:'v1',keys})).toThrow('Invalid journal data');
  });
});
describe('strict canonical keyed journal digest',()=>{
  it('sorts dictionary keys recursively, preserves array order and binds purpose/scope',()=>{
    const c=codec();expect(c.digest(snapshot,'context',{a:[1,2],b:{z:1,a:2}})).toEqual(c.digest(snapshot,'context',{b:{a:2,z:1},a:[1,2]}));
    expect(c.digest(snapshot,'context',[1,2])).not.toBe(c.digest(snapshot,'context',[2,1]));expect(c.digest(snapshot,'context',value)).not.toBe(c.digest(snapshot,'receipt',value));
    expect(c.digest(snapshot,'context',value)).not.toBe(c.digest({...snapshot,key:'another'},'context',value));expect(c.digest(snapshot,'context',value)).toMatch(/^[a-f0-9]{64}$/);
  });
  it.each([undefined,NaN,Infinity,-0,BigInt(1),()=>{},new Date(),new Map(),{a:undefined},[,1],{toJSON(){return 'counterfeit';}}].map(input=>({input})))('rejects ambiguous non-JSON value (%#)',({input})=>{
    const c=codec();expect(()=>c.encode(snapshot,'context',input)).toThrow('Invalid journal data');expect(()=>c.digest(snapshot,'context',input)).toThrow('Invalid journal data');
  });
  it('rejects cycles, accessors, hidden keys and symbol keys without invoking getters',()=>{
    const c=codec(),cycle:Record<string,unknown>={};cycle.self=cycle;let accessed=false;const getter={get value(){accessed=true;return 'secret';}};
    const hidden=Object.defineProperty({},'hidden',{value:'secret'});const symbol={[Symbol('hidden')]:'secret'};
    for(const input of [cycle,getter,hidden,symbol]) expect(()=>c.encode(snapshot,'context',input)).toThrow('Invalid journal data');expect(accessed).toBe(false);
  });
  it('rejects proxy traps and custom array prototypes without evaluating counterfeit JSON',()=>{
    const c=codec();let accessed=false;const proxy=new Proxy({value:'secret'},{ownKeys(target){accessed=true;return Reflect.ownKeys(target);}});
    expect(()=>c.encode(snapshot,'context',proxy)).toThrow('Invalid journal data');expect(accessed).toBe(false);
    class CounterfeitArray extends Array {} const counterfeit=new CounterfeitArray();counterfeit.push(1,2);expect(()=>c.encode(snapshot,'context',counterfeit)).toThrow('Invalid journal data');
  });
  it('rejects too deep structures and invalid snapshots without leaking plaintext',()=>{
    const c=codec();let deep:unknown='secret';for(let i=0;i<80;i++)deep=[deep];expect(()=>c.encode(snapshot,'context',deep)).toThrow('Invalid journal data');
    expect(()=>c.encode({...snapshot,payloadDigest:'not-a-digest'},'context',{secret:'sensitive'})).toThrow(/^Invalid journal data$/);
  });
  it.each([null,true,123,'synthetic',[1,null],{nested:true}].map(input=>({input})))('roundtrips valid JSON (%#)',({input})=>{const c=codec();expect(c.decode(snapshot,'outcome',c.encode(snapshot,'outcome',input))).toEqual(input);});
  it('sanitizes unknown envelope parse/type errors',()=>{expect(()=>codec().decode(snapshot,'context','secret raw payload' as unknown as JournalEnvelope)).toThrow(/^Invalid journal data$/);});
});
