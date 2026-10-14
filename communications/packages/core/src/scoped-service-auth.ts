import type { AccessScope } from '../../contracts/src';
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
export interface ScopedServiceAuthOptions { key: Buffer; audience: string; applicationId: string; authorize(scope: AccessScope, proof: { expiresAt: string }): Promise<boolean>; now?: () => number }
export function createScopedServiceAuth(options: ScopedServiceAuthOptions): { issue(scope: AccessScope): string; verify(header: string | undefined): Promise<AccessScope | null> } {
 const id=(v:unknown):v is string=>typeof v==='string'&&v.length>0&&v.length<=200&&v===v.trim()&&!/[\u0000-\u001f\u007f]/.test(v);
 if(!Buffer.isBuffer(options.key)||options.key.length!==32||!id(options.audience)||!id(options.applicationId)||typeof options.authorize!=='function')throw Error('Invalid service authentication configuration');
 const key=Buffer.from(options.key),audience=options.audience,app=options.applicationId,authorize=Function.prototype.bind.call(options.authorize,options),now=options.now?Function.prototype.bind.call(options.now,options):Date.now;
 const signed=(payload:string)=>createHmac('sha256',key).update('communications-scope-v1\0'+payload).digest();
 const scope=(v:AccessScope)=>{if(!v||Object.keys(v).sort().join(',')!=='applicationId,ownerId,tenantId'||!id(v.applicationId)||v.applicationId!==app||!id(v.tenantId)||!id(v.ownerId))throw Error('Invalid service scope');return {applicationId:v.applicationId,tenantId:v.tenantId,ownerId:v.ownerId};};
 return {
  issue(value) {const s=scope(value),iat=now();if(!Number.isSafeInteger(iat)||iat<0)throw Error('Invalid service clock');const encoded=Buffer.from(JSON.stringify({...s,audience,iat,exp:iat+60000,nonce:randomBytes(18).toString('base64url')})).toString('base64url');return encoded+'.'+signed(encoded).toString('base64url');},
  async verify(header) {try {
    if(typeof header!=='string'||header.length>2048||!/^Bearer [A-Za-z0-9_-]+\.[A-Za-z0-9_-]{43}$/.test(header))return null;
    const [payload,signature]=header.slice(7).split('.'),actual=Buffer.from(signature,'base64url');if(!timingSafeEqual(signed(payload),actual))return null;
    const c=JSON.parse(Buffer.from(payload,'base64url').toString('utf8'));if(!c||typeof c!=='object'||Object.keys(c).sort().join(',')!=='applicationId,audience,exp,iat,nonce,ownerId,tenantId')return null;
    const s=scope({applicationId:c.applicationId,tenantId:c.tenantId,ownerId:c.ownerId}),clock=now();
    if(c.audience!==audience||!Number.isSafeInteger(clock)||!Number.isSafeInteger(c.iat)||!Number.isSafeInteger(c.exp)||c.iat<0||c.iat>clock||c.exp!==c.iat+60000||c.exp<=clock||typeof c.nonce!=='string'||!/^[A-Za-z0-9_-]{24}$/.test(c.nonce))return null;
    if(await authorize(Object.freeze({...s}),Object.freeze({expiresAt:new Date(c.exp).toISOString()}))!==true||now()>=c.exp)return null;return s;
  }catch{return null;}}
 };
}
