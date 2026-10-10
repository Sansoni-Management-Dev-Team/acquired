import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { Sessions } from "./sessions.mjs";
import { serviceServer } from "./http.mjs";
import { serviceConfig } from "./routing.mjs";
const actor = { organizationId: "org", userId: "owner" };
test("connected but unsynchronized inbox reports a wait, and unresolved identities report review", async () => {
  const store = { authorize: async () => {}, replyMonitoringEnabled: true };
  const sessions = new Sessions(store, () => {}, serviceConfig());
  const session = {
    status: "connected",
    replyReady: false,
    stopped: false,
    events: Promise.resolve(),
    socket: {
      user: { id: "61400000000@s.whatsapp.net" },
      ev: new EventEmitter(),
    },
    auth: {
      connectionId: "connection",
      state: { creds: {} },
      readReplyEvents: async () => [{ id: "1", remote_identity: "123@lid" }],
    },
  };
  sessions.sessions.set(sessions.key(actor), session);
  const secret = "fixture-secret-at-least-32-characters";
  const server = serviceServer(store, sessions, secret);
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  try {
    const url = `http://127.0.0.1:${server.address().port}/replies?organizationId=org&userId=owner`;
    let r = await fetch(url, {
      headers: { Authorization: `Bearer ${secret}` },
    });
    assert.equal(r.status, 409);
    assert.equal((await r.json()).detail.code, "incomplete");
    session.replyReady = true;
    r = await fetch(url, { headers: { Authorization: `Bearer ${secret}` } });
    assert.equal(r.status, 409);
    assert.equal((await r.json()).detail.code, "reply_unverified");
  } finally {
    await new Promise((r) => server.close(r));
  }
});

test('failure bodies expose only stable contract codes',async()=>{
 const {failureBody}=await import('./failures.mjs');
 assert.deepEqual(failureBody({code:'internal-provider-secret',message:'private provider body'}),{error:'WhatsApp operation cannot proceed',detail:{code:'unavailable'}});
});

test('capabilities cannot declare delivery ready while the journal schema is unavailable',async()=>{
 const secret='isolated-whatsapp-test-secret-with-32chars';
 const store={authorize:async()=>{},campaignsEnabled:true,health:async()=>{throw Error('Journal schema unavailable');}};
 const server=serviceServer(store,{},secret);await new Promise(r=>server.listen(0,'127.0.0.1',r));
 try{
  const response=await fetch(`http://127.0.0.1:${server.address().port}/capabilities?organizationId=org&userId=owner`,{headers:{Authorization:`Bearer ${secret}`}});
  assert.equal(response.status,503);assert.equal((await response.json()).detail.code,'unavailable');
 }finally{await new Promise(r=>server.close(r));}
});
