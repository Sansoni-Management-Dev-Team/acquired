import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
const app = 'http://localhost:3010';
const run = randomUUID().slice(0,8);
const email = `linkedin-local-${run}@example.invalid`;
const password = `Linkedin-test-${randomUUID()}!`;
let cookie;
async function call(path,method='GET',body) {
  const response = await fetch(app+path,{method,headers:{Origin:app,...(cookie?{Cookie:cookie}:{}),...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(60000)});
  const data=await response.json();
  assert.ok(response.ok,`${path}: ${response.status} ${JSON.stringify(data)}`);
  return {data,response};
}
assert.equal((await fetch(app+'/api/channels/linkedin')).status,401);
const signup=await call('/api/auth/sign-up/email','POST',{name:'LinkedIn Local Test',email,password});
cookie=signup.response.headers.getSetCookie().map(c=>c.split(';')[0]).find(c=>c.includes('session_token='));
assert.ok(cookie);
await call('/api/auth/organization/create','POST',{name:'LinkedIn Local Test',slug:`linkedin-local-${run}`});
assert.equal((await call('/api/channels/linkedin')).data.status,'disconnected');
const connection=(await call('/api/channels/linkedin','POST',{fixture:true})).data;
assert.equal(connection.status,'login_required');
assert.ok(connection.viewerUrl.startsWith('http://127.0.0.1:18096/view/'));
await call('/api/channels/linkedin','POST',{action:'pause'});
mkdirSync('.local-data/linkedin',{recursive:true});
writeFileSync('.local-data/linkedin/app-test.json',JSON.stringify({email,password}),{mode:0o600});
console.log('PASS local app auth, organisation ownership and service proxy. Fictional UI test account saved privately.');
