// Isolated React UI fixture only: no credentials, database, migration or provider transport.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFileSync,mkdirSync} from 'node:fs';
import {createRequire} from 'node:module';
import {join,resolve} from 'node:path';
const root=resolve(import.meta.dirname,'..');
if(process.argv.includes('--build')) {
 const require=createRequire(import.meta.url),vite=require.resolve('vite',{paths:[require.resolve('vitest/package.json')]}),{build}=await import(require.resolve('esbuild',{paths:[vite]}));
 const directory=join(root,'.local-data/communications/settings-fixture');mkdirSync(directory,{recursive:true,mode:0o700});
 await build({stdin:{contents:`import React from 'react';import{createRoot}from'react-dom/client';import{ChannelConnections}from'./src/components/channel-connections';createRoot(document.getElementById('root')).render(<ChannelConnections/>);`,resolveDir:root,loader:'tsx'},bundle:true,platform:'browser',jsx:'automatic',outfile:join(directory,'ui.js'),define:{'process.env.NODE_ENV':'"development"'}});
 console.log('Actual settings component bundled for synthetic browser fixture.');
} else {
 assert.equal(process.env.COMMUNICATIONS_SETTINGS_FIXTURE,'1','Requires explicit synthetic UI opt-in');
 const file=process.env.COMMUNICATIONS_SETTINGS_BUNDLE||join(root,'.local-data/communications/settings-fixture/ui.js'),bundle=readFileSync(file);
 const scope={applicationId:'acquire',tenantId:'fixture-org',ownerId:'fixture-owner'},connections=[];
 let available=true;const requests=[];const snapshot=()=>({available,connections:available?connections:[],checkedAt:new Date().toISOString()});
 const server=createServer(async(req,res)=>{
  const json=(data,status=200)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(data));};
  if(req.url==='/fixture/state'&&req.method==='GET'){json({requests,connections});return;}
  if(req.url==='/fixture/unavailable'&&req.method==='POST'){available=false;json({ok:true});return;}
  if(req.url==='/ui.js'){res.writeHead(200,{'Content-Type':'text/javascript'});res.end(bundle);return;}
  if(req.url==='/api/channels/connections') {
   if(req.method==='GET'){json(snapshot(),available?200:503);return;}
   let body='';for await(const chunk of req){body+=chunk;if(body.length>8192){json({},413);return;}}
   const input=JSON.parse(body);requests.push(input);
   if(input.action==='setup'){
    const channel=input.channel,binding={...scope,connectionId:channel,accountId:'physical-'+channel,generation:1,channel,platform:input.platform,backend:'unipile'};
    connections.push({binding,label:channel==='email'?'fixture@example.test':channel==='whatsapp'?'+15555550123':'Synthetic LinkedIn owner',status:'syncing',capabilities:{messaging:{send:true,durableIdempotency:true,receiptLookup:true},events:{read:true,history:true,realtime:true}},readiness:{status:'waiting',code:'incomplete'},isDefault:false});json({status:'unknown'});return;
   }
   const c=connections.find(c=>JSON.stringify(c.binding)===JSON.stringify(input.binding));if(!c){json({},404);return;}
   if(input.action==='default'){for(const previous of connections)if(previous.binding.channel===c.binding.channel)previous.isDefault=false;c.isDefault=true;json(c);return;}
   if(input.action==='status'){c.status='connected';c.readiness={status:'ready'};json(c);return;}
   if(input.action==='disconnect'){c.status='disconnected';c.readiness={status:'review',code:'reconnect'};json({status:'unknown'});return;}
   json({},400);return;
  }
  res.writeHead(200,{'Content-Type':'text/html','Cache-Control':'no-store'});res.end('<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Unipile settings fixture</title><style>body{font:16px system-ui;margin:24px;background:#f5f5f4;color:#222}button,select{font:inherit;padding:10px;margin:6px;cursor:pointer}section{max-width:800px;margin:auto}h3{margin-bottom:0}button:disabled{opacity:.5;cursor:not-allowed}svg{width:24px}#root>section>div:last-child>div{background:white;border:1px solid #ccc;border-radius:12px;padding:16px;margin:12px 0}[role=status]{padding:12px;border:1px solid #aaa}</style></head><body><div id="root"></div><script src="/ui.js"></script></body></html>');
 });
 server.listen(Number(process.env.PORT||0),process.env.COMMUNICATIONS_SETTINGS_HOST||'127.0.0.1',()=>{const a=server.address();console.log('Synthetic settings fixture listening on port '+a.port);});
}
