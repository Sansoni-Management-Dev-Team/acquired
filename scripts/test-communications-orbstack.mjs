// Standalone compiled SDK/service verification. No schema bootstrap or provider credentials.
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const directory = join(root, ".local-data/communications");
const build = join(directory, "orbstack-build");
const container = "acquire-communications-fixture";
const port = 18444;
const docker = args => execFileSync("docker", ["--context", "orbstack", ...args], { cwd: root, encoding: "utf8", maxBuffer: 4 * 1024 * 1024 });
mkdirSync(directory, { recursive: true, mode: 0o700 });
assert.equal(execFileSync("git", ["check-ignore", ".local-data/communications/orbstack-build"], { cwd: root, encoding: "utf8" }).trim(), ".local-data/communications/orbstack-build");
docker(["info", "--format", "{{.ServerVersion}}"]);
execFileSync("pnpm", ["exec", "tsc", "-p", "communications/tsconfig.build.json", "--outDir", build], { cwd: root, stdio: "inherit" });

const previous = docker(["ps", "-aq", "--filter", `name=^/${container}$`]).trim();
if (previous) {
  const metadata = JSON.parse(docker(["inspect", previous]))[0];
  assert.equal(metadata.Config.Labels?.["acquire.fixture"], "communications", "Refuse to replace a container not owned by this fixture");
  docker(["rm", "--force", previous]);
}
docker(["run", "--detach", "--name", container, "--label", "acquire.fixture=communications",
  "--publish", `127.0.0.1:${port}:4044`, "--mount", `type=bind,src=${build},dst=/fixture,readonly`,
  "--read-only", "--user", "1000:1000", "--cap-drop", "ALL", "--security-opt", "no-new-privileges",
  "--pids-limit", "64", "--memory", "128m", "node:22-alpine",
  "node", "/fixture/services/api/src/fixture-entry.js", "--fixture", "--host", "0.0.0.0", "--port", "4044"]);
const metadata = JSON.parse(docker(["inspect", container]))[0];
assert.equal(metadata.Mounts.length, 1);
assert.equal(metadata.Mounts[0].Source, build);
assert.equal(metadata.Mounts[0].RW, false);
assert.ok(metadata.Config.Env.every(value => !/^(?:UNIPILE_|COMMUNICATIONS_|DATABASE_URL|GOOGLE_GMAIL_)/.test(value)));

const require = createRequire(import.meta.url);
const { CommunicationsClient } = require(join(build, "packages/sdk/src/index.js"));
const { messageDigest } = require(join(build, "packages/core/src/message-digest.js"));
const configuration = { baseUrl: `http://127.0.0.1:${port}`, contractVersion: "1", apiKey: "fixture-only-service-key", allowLoopbackHttp: true, timeoutMs: 5000 };
const client = new CommunicationsClient(configuration);
async function healthy() {
  for (let attempt = 0; attempt < 40; attempt++) {
    try { assert.deepEqual(await client.health(), { contractVersion: "1" }); return; }
    catch { await new Promise(resolve => setTimeout(resolve, 250)); }
  }
  throw new Error("Standalone fixture service did not become healthy");
}
await healthy();
const binding = { applicationId: "fixture-app", tenantId: "fixture-tenant", ownerId: "fixture-owner", connectionId: "fixture-connection", accountId: "fixture-account", generation: 1, channel: "whatsapp", platform: "whatsapp", backend: "baileys" };
const message = { recipient: { kind: "phone", value: "+61400000002" }, text: "Standalone synthetic communications test" };
const submission = { snapshot: { binding, key: `fixture:${randomUUID()}`, operation: "message", payloadDigest: messageDigest("message", message) }, message };
assert.deepEqual(await client.ready(binding), { status: "ready" });
const sent = await client.submit(submission);
assert.equal(sent.status, "submitted");
assert.deepEqual(sent.receipt.message.binding, binding);
assert.deepEqual(await client.submit(submission), sent);
const lookup = { snapshot: submission.snapshot, expectedRecipient: message.recipient };
assert.deepEqual(await client.lookup(lookup), sent);
await assert.rejects(client.ready({ ...binding, ownerId: "another-owner" }), error => error.code === "forbidden");
await assert.rejects(client.ready({ ...binding, generation: 2 }), error => error.code === "connection_unavailable");
await assert.rejects(new CommunicationsClient({ ...configuration, apiKey: "incorrect-synthetic-key" }).ready(binding), error => error.code === "unauthorized");
await assert.rejects(client.submit({ ...submission, message: { ...message, text: "Changed under old digest" } }), error => error.code === "operation_conflict");
await assert.rejects(client.lookup({ ...lookup, message: { binding, id: "wrong-original-id" } }));
assert.deepEqual(await client.lookup(lookup), sent);

const transportProof = String.raw`
const assert=require('node:assert/strict');
const {createServer}=require('node:http');
const {createHmac}=require('node:crypto');
const {UnipileV2Transport,verifyUnipileWebhook}=require('/fixture/packages/adapter-unipile/src/index.js');
(async()=>{
  let writes=0;
  const server=createServer(async(request,response)=>{
    let body=''; for await(const chunk of request) body+=chunk;
    assert.equal(request.headers['x-api-key'],'synthetic-unipile-key');
    if(request.method==='GET'){response.writeHead(200,{'content-type':'application/json'}).end(JSON.stringify({items:[]}));return;}
    writes++;assert.deepEqual(JSON.parse(body),{text:'Synthetic transport message'});request.socket.destroy();
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  try{
    const transport=new UnipileV2Transport({apiVersion:'v2',baseUrl:'http://127.0.0.1:'+server.address().port+'/v2',apiKey:'synthetic-unipile-key',allowLoopbackHttp:true,timeoutMs:3000});
    assert.equal((await transport.listAccounts()).kind,'success');
    assert.equal((await transport.sendMessage('acc_fixture','chat_fixture',{text:'Synthetic transport message'})).kind,'unknown');
    assert.equal(writes,1);
    const now=Math.floor(Date.now()/1000),raw=Buffer.from(' {"id":"evt_fixture"} '),secret='synthetic-webhook-key';
    const signature='t='+now+',v0='+createHmac('sha256',secret).update(now+'.').update(raw).digest('hex');
    assert.equal(verifyUnipileWebhook({rawBody:raw,signature,secret,nowSeconds:now}).verified,true);
    assert.equal(verifyUnipileWebhook({rawBody:Buffer.from('{"id":"evt_fixture"}'),signature,secret,nowSeconds:now}).verified,false);
    process.stdout.write(JSON.stringify({containerNativeHttp:true,providerWrites:0,syntheticWrites:writes,noRetry:true,rawSignatureVerified:true}));
  }finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
})().catch(()=>{process.stderr.write('Container transport verification failed\n');process.exitCode=1;});
`;
const transport = JSON.parse(execFileSync("docker", ["--context", "orbstack", "exec", "-i", container, "node"], { input: transportProof, encoding: "utf8", maxBuffer: 1024 * 1024 }));
const v1 = JSON.parse(execFileSync("docker", ["--context", "orbstack", "exec", "-i", container, "node", "--input-type=module"], {
  input: readFileSync(join(root, "scripts/communications-v1-fixture-proof.mjs"), "utf8"), encoding: "utf8", maxBuffer: 1024 * 1024,
}));
docker(["restart", container]);
await healthy();
assert.equal(await client.lookup(lookup), null, "Memory-only fixture must not pretend receipts survive restart");

const sources = [];
function inventory(path) {
  for (const entry of readdirSync(path, { withFileTypes: true })) {
    if (["node_modules", "dist"].includes(entry.name)) continue;
    const file = join(path, entry.name);
    if (entry.isDirectory()) inventory(file);
    else if (entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts")) sources.push(file);
  }
}
inventory(join(root, "communications"));
const hashes = Object.fromEntries(sources.sort().map(file => [file.slice(root.length), createHash("sha256").update(readFileSync(file)).digest("hex")]));
const report = { checkedAt: new Date().toISOString(), scope: "Compiled standalone SDK/service + container-local synthetic Unipile HTTP/signature fixtures; no application DB or real provider calls", sourceRevision: execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim(), sourceHashes: hashes, verificationScriptHashes: Object.fromEntries(["scripts/test-communications-orbstack.mjs", "scripts/communications-v1-fixture-proof.mjs"].map(file => [file, createHash("sha256").update(readFileSync(join(root, file))).digest("hex")])), image: metadata.Image, dockerContext: "orbstack", container,
  passed: ["health/version", "readiness", "synthetic_submit_replay_lookup", "owner_generation_auth_rejections", "changed_content_rejected", "wrong_receipt_rejected", "no_live_credential_mounts", "memory_only_restart_honesty"], transport, v1, persistentJournalVerified: false, migrationsApplied: 0 };
const output = join(directory, "verification/orbstack-standalone.json");
mkdirSync(dirname(output), { recursive: true, mode: 0o700 });
writeFileSync(output, JSON.stringify(report, null, 2) + "\n", { mode: 0o600 });
console.log("Standalone OrbStack SDK/service and native v1/v2 transport, normalization and webhook checks passed. No migrations or live provider writes. Dedicated fixture remains at http://127.0.0.1:18444.");
