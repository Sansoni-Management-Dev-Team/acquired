import { createCipheriv, createDecipheriv, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { types } from 'node:util';
import { assertSameBinding, type OperationSnapshot } from '../../contracts/src';
export type JournalPurpose='context'|'receipt'|'outcome';
export interface JournalEnvelope {format:'communications-journal-v1';keyVersion:string;nonce:string;ciphertext:string;tag:string}
export interface JournalCodecConfig {activeVersion:string;keys:readonly {version:string;encryptionKey:Uint8Array;digestKey:Uint8Array}[];maxPlaintextBytes?:number}
const FORMAT='communications-journal-v1' as const;
function fail():never {throw new Error('Invalid journal data');}
const versionValid=(v:unknown):v is string=>typeof v==='string' && /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(v);
const purposes=['context','receipt','outcome'];
/** Accept only ordinary JSON values, including dense arrays. No accessors/toJSON or lossy types.
 * Shared references may appear twice, but ancestor cycles and excessively deep/large trees fail. */
function canonicalJson(value:unknown,maxBytes:number):string {
  const ancestors=new Set<object>();let nodes=0,estimated=0;
  function visit(input:unknown,depth:number):unknown {
    if(++nodes>10000 || depth>32) fail();
    if(input===null || typeof input==='boolean') return input;
    if(typeof input==='number'){if(!Number.isFinite(input) || Object.is(input,-0)) fail();return input;}
    if(typeof input==='string'){estimated+=Buffer.byteLength(input,'utf8');if(estimated>maxBytes)fail();return input;}
    if(typeof input!=='object' || types.isProxy(input) || ancestors.has(input)) fail();
    const prototype=Object.getPrototypeOf(input);
    if(Array.isArray(input)?prototype!==Array.prototype:prototype!==Object.prototype && prototype!==null) fail();
    const descriptors=Object.getOwnPropertyDescriptors(input),keys=Reflect.ownKeys(descriptors);
    if(keys.some(k=>typeof k==='symbol'))fail();
    ancestors.add(input);
    try {
      if(Array.isArray(input)) {
        if(input.length>10000 || keys.length!==input.length+1 || keys.some(k=>k!=='length' && !/^(0|[1-9]\d*)$/.test(String(k)))) fail();
        const result:unknown[]=[];
        for(let i=0;i<input.length;i++){const d=descriptors[String(i)];if(!d || !('value' in d) || !d.enumerable)fail();result.push(visit(d.value,depth+1));}
        return result;
      }
      const result=Object.create(null) as Record<string,unknown>;
      for(const k of (keys as string[]).sort()) {
        const d=descriptors[k];if(!('value' in d) || !d.enumerable)fail();estimated+=Buffer.byteLength(k,'utf8');if(estimated>maxBytes)fail();
        result[k]=visit(d.value,depth+1);
      }
      return result;
    } finally {ancestors.delete(input);}
  }
  const result=JSON.stringify(visit(value,0));if(Buffer.byteLength(result,'utf8')>maxBytes)fail();return result;
}
function exact(value:Record<string,unknown>,fields:string[]) {if(Object.keys(value).length!==fields.length || Object.keys(value).some(k=>!fields.includes(k)))fail();}
function snapshotJson(input:OperationSnapshot):string {
  const encoded=canonicalJson(input,8192),snapshot=JSON.parse(encoded) as OperationSnapshot;
  if(!snapshot || typeof snapshot!=='object' || Array.isArray(snapshot))fail();
  exact(snapshot as unknown as Record<string,unknown>,['key','binding','operation','payloadDigest']);
  assertSameBinding(snapshot.binding,snapshot.binding);
  exact(snapshot.binding as unknown as Record<string,unknown>,['applicationId','tenantId','ownerId','connectionId','accountId','generation','channel','platform','backend']);
  if(typeof snapshot.key!=='string' || !snapshot.key.length || snapshot.key.trim()!==snapshot.key || snapshot.key.length>200 || /[\u0000-\u001f\u007f]/.test(snapshot.key) || !/^[a-f0-9]{64}$/.test(snapshot.payloadDigest) || !['message','invitation','draft_create','draft_update','draft_delete'].includes(snapshot.operation))fail();
  return encoded;
}
function base64(value:unknown,maxBytes:number,exactBytes?:number):Buffer {
  if(typeof value!=='string' || !value.length || value.length>Math.ceil(maxBytes/3)*4 || value.length%4!==0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(value))fail();
  const bytes=Buffer.from(value,'base64');if(bytes.toString('base64')!==value || bytes.length>maxBytes || (exactBytes!==undefined && bytes.length!==exactBytes))fail();return bytes;
}

/** Pure codec only. Callers supply retained key versions; no env, vault or database access occurs. */
export class JournalCodec {
  #keys=new Map<string,{encryption:Buffer;digest:Buffer}>();
  #version:string;
  #maxBytes:number;
  constructor(config:JournalCodecConfig){
    try {
      const max=config.maxPlaintextBytes??1_048_576;
      if(!versionValid(config.activeVersion) || !Array.isArray(config.keys) || !config.keys.length || config.keys.length>32 || !Number.isSafeInteger(max) || max<1 || max>5_242_880)fail();
      for(const key of config.keys) {
        if(!versionValid(key.version) || this.#keys.has(key.version) || !(key.encryptionKey instanceof Uint8Array) || !(key.digestKey instanceof Uint8Array) || key.encryptionKey.length!==32 || key.digestKey.length!==32)fail();
        const encryption=Buffer.from(key.encryptionKey),digest=Buffer.from(key.digestKey);if(timingSafeEqual(encryption,digest))fail();
        for(const retained of this.#keys.values()) {
          if(timingSafeEqual(retained.encryption,digest) || timingSafeEqual(retained.digest,encryption))fail();
        }
        this.#keys.set(key.version,{encryption,digest});
      }
      if(!this.#keys.has(config.activeVersion))fail();this.#version=config.activeVersion;this.#maxBytes=max;
    } catch {fail();}
  }
  get keyVersion():string {return this.#version;}
  #aad(snapshot:OperationSnapshot,purpose:JournalPurpose,version:string):Buffer {
    if(!purposes.includes(purpose) || !versionValid(version) || !this.#keys.has(version))fail();
    return Buffer.from(canonicalJson({domain:'communications.journal.aead',format:FORMAT,keyVersion:version,purpose,snapshot:JSON.parse(snapshotJson(snapshot))},16384),'utf8');
  }
  encode(snapshot:OperationSnapshot,purpose:JournalPurpose,value:unknown):JournalEnvelope {
    try {
      const aad=this.#aad(snapshot,purpose,this.#version),plaintext=Buffer.from(canonicalJson(value,this.#maxBytes),'utf8'),nonce=randomBytes(12);
      const cipher=createCipheriv('aes-256-gcm',this.#keys.get(this.#version)!.encryption,nonce,{authTagLength:16});cipher.setAAD(aad);
      const ciphertext=Buffer.concat([cipher.update(plaintext),cipher.final()]);
      return {format:FORMAT,keyVersion:this.#version,nonce:nonce.toString('base64'),ciphertext:ciphertext.toString('base64'),tag:cipher.getAuthTag().toString('base64')};
    } catch {fail();}
  }
  decode(snapshot:OperationSnapshot,purpose:JournalPurpose,envelope:unknown):unknown {
    try {
      const raw=JSON.parse(canonicalJson(envelope,Math.ceil(this.#maxBytes/3)*4+1024)) as JournalEnvelope;
      if(!raw || typeof raw!=='object' || Array.isArray(raw))fail();exact(raw as unknown as Record<string,unknown>,['format','keyVersion','nonce','ciphertext','tag']);
      if(raw.format!==FORMAT)fail();const aad=this.#aad(snapshot,purpose,raw.keyVersion);
      const nonce=base64(raw.nonce,12,12),ciphertext=base64(raw.ciphertext,this.#maxBytes),tag=base64(raw.tag,16,16);
      const decipher=createDecipheriv('aes-256-gcm',this.#keys.get(raw.keyVersion)!.encryption,nonce,{authTagLength:16});decipher.setAAD(aad);decipher.setAuthTag(tag);
      const plaintext=Buffer.concat([decipher.update(ciphertext),decipher.final()]);
      // Preserve a leading BOM instead of silently stripping authenticated noncanonical bytes.
      const text=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(plaintext),value=JSON.parse(text);
      if(canonicalJson(value,this.#maxBytes)!==text)fail();return value;
    } catch {fail();}
  }
  digest(snapshot:OperationSnapshot,purpose:JournalPurpose,value:unknown,keyVersion=this.#version):string {
    try {
      const aad=this.#aad(snapshot,purpose,keyVersion),json=canonicalJson(value,this.#maxBytes);
      // Distinct domains and independent keys separate correlation hashes from encryption authentication.
      return createHmac('sha256',this.#keys.get(keyVersion)!.digest).update('communications.journal.digest.v1\0').update(aad).update('\0').update(json).digest('hex');
    } catch {fail();}
  }
}
