import { afterEach, describe, expect, it, vi } from "vitest";
import { request, type Server } from "node:http";
import { connect, type AddressInfo } from "node:net";
import type { ReplyIngress, WebhookIngressResult } from "../../../packages/core/src/reply-ingress";
import { createReplyWebhookServer } from "./reply-webhook-server";

const servers: Server[] = [];
afterEach(async () => { await Promise.all(servers.splice(0).map(server => new Promise<void>(resolve => { server.close(() => resolve()); server.closeAllConnections(); }))); });
async function start(ingress: ReplyIngress, options: {maxRequestBytes?:number;bodyTimeoutMs?:number;captureTimeoutMs?:number} = {}) {
  const server = createReplyWebhookServer({ingress,...options}); servers.push(server);
  await new Promise<void>(resolve => server.listen(0,"127.0.0.1",resolve));
  return {server,port:(server.address() as AddressInfo).port};
}
function fixture(result: WebhookIngressResult = {status:"accepted"}) {
  return {authenticate:vi.fn(() => true),capture:vi.fn(async (input: Parameters<ReplyIngress["capture"]>[0]) => { void input; return result; })};
}
function post(port: number, body: Buffer = Buffer.from('{"hello":"world"}'), headers: Record<string,string> = {"content-type":"application/json"}, path = "/v1/webhook", method = "POST") {
  return new Promise<{status:number;body:string} >((resolve,reject) => {
    const req=request({hostname:"127.0.0.1",port,path,method,headers},res => {
      const chunks:Buffer[]=[];res.on("data", chunk => chunks.push(chunk));res.on("end",()=>resolve({status:res.statusCode!,body:Buffer.concat(chunks).toString()}));
    });req.on("error",reject);if(method === "GET")req.end();else req.end(body);
  });
}
function deferred<T>() { let resolve!: (value:T)=>void; const promise = new Promise<T>(done => {resolve=done;});return {promise,resolve}; }

describe("dedicated webhook HTTP boundary", () => {
  it("preserves authenticated raw bytes and does not acknowledge before commit",async()=>{
    const commit=deferred<WebhookIngressResult>();const captured=deferred<void>();
    const ingress={authenticate:vi.fn(()=>true),capture:vi.fn(async(input: Parameters<ReplyIngress["capture"]>[0])=>{void input;captured.resolve();return commit.promise;})};
    const {port}=await start(ingress);const raw=Buffer.from(' {"content":"é", "a":1} \n');
    let settled=false;const response=post(port,raw,{"content-type":"application/json; charset=UTF-8","x-fixture-auth":"synthetic"}).then(value=>{settled=true;return value;});
    await captured.promise;expect(settled).toBe(false);
    expect(ingress.authenticate).toHaveBeenCalledBefore(ingress.capture);
    const input=ingress.capture.mock.calls[0]![0] as unknown as {rawBody:Uint8Array;rawHeaders:string[]};
    expect(Buffer.from(input.rawBody)).toEqual(raw);expect(input.rawHeaders).toContain("synthetic");
    commit.resolve({status:"accepted"});expect(await response).toEqual({status:200,body:'{"status":"accepted"}'});
  });
  it("acknowledges already durably captured duplicates",async()=>{const {port}=await start(fixture({status:"duplicate"}));expect(await post(port)).toEqual({status:200,body:'{"status":"duplicate"}'});});
  it.each(["unauthorized","invalid_request","too_large","forbidden"] as const)("maps rejected %s safely",async(code)=>{
    const {port}=await start(fixture({status:"rejected",code}));const response=await post(port);expect(response.status).toBe({unauthorized:401,invalid_request:400,too_large:413,forbidden:403}[code]);expect(response.body).toBe(JSON.stringify({error:{code}}));
  });
  it("never calls capture on authentication failure",async()=>{const ingress=fixture();ingress.authenticate.mockReturnValue(false);const {port}=await start(ingress);expect((await post(port)).status).toBe(401);expect(ingress.capture).not.toHaveBeenCalled();});
  it("rejects authentication without waiting for a request body",async()=>{
    const ingress=fixture();ingress.authenticate.mockReturnValue(false);const {port}=await start(ingress);
    const response=await new Promise<number>((resolve,reject)=>{const req=request({hostname:"127.0.0.1",port,path:"/v1/webhook",method:"POST",headers:{"content-type":"application/json","content-length":"100"}},res=>{res.resume();res.on("end",()=>{req.destroy();resolve(res.statusCode!);});});req.on("error",reject);req.flushHeaders();});
    expect(response).toBe(401);expect(ingress.capture).not.toHaveBeenCalled();
  });
  it.each(["text/plain","application/json; charset=iso-8859-1","application/json; boundary=x","application/json; charset=utf-8; charset=utf-8"])("rejects unsupported content type %s",async(type)=>{const ingress=fixture();const {port}=await start(ingress);expect((await post(port,Buffer.from('{}'),{"content-type":type})).status).toBe(400);expect(ingress.capture).not.toHaveBeenCalled();});
  it("rejects a missing content type",async()=>{const ingress=fixture();const {port}=await start(ingress);expect((await post(port,Buffer.from('{}'),{})).status).toBe(400);expect(ingress.capture).not.toHaveBeenCalled();});
  it.each([true,false])("bounds declared and chunked raw body (declared=%s)",async(declared)=>{const ingress=fixture();const {port}=await start(ingress,{maxRequestBytes:4});const headers:Record<string,string>={"content-type":"application/json"};if(declared)headers["content-length"]="5";else headers["transfer-encoding"]="chunked";expect((await post(port,Buffer.from("12345"),headers)).status).toBe(413);expect(ingress.capture).not.toHaveBeenCalled();});
  it("passes raw invalid JSON to ingress for durable validation rather than parsing here",async()=>{const ingress=fixture({status:"rejected",code:"invalid_request"});const {port}=await start(ingress);expect((await post(port,Buffer.from("not json"))).status).toBe(400);expect(Buffer.from(ingress.capture.mock.calls[0]![0].rawBody)).toEqual(Buffer.from("not json"));});
  it.each([{status:"retry"},null,{status:"accepted",privateId:"private"},{status:"rejected",code:"unexpected"},{status:"accepted",then:"bad"}])("handles retry or malformed results safely %#",async(result)=>{const ingress=fixture();ingress.capture.mockImplementation(async()=>result as WebhookIngressResult);const {port}=await start(ingress);expect(await post(port)).toEqual({status:503,body:'{"error":{"code":"retry"}}'});});
  it("sanitizes capture rejection and auth exceptions",async()=>{
    const ingress=fixture();ingress.capture.mockRejectedValue(new Error("private payload and key"));let {port}=await start(ingress);expect(await post(port)).toEqual({status:503,body:'{"error":{"code":"retry"}}'});
    ingress.authenticate.mockImplementation(()=>{throw new Error("private secret");});({port}=await start(ingress));expect(await post(port)).toEqual({status:503,body:'{"error":{"code":"retry"}}'});
  });
  it.each([["/v1/webhook?x=1","POST"],["/v1/submit","POST"],["/v1/webhook","GET"]])("keeps route boundary exact %s %s",async(path,method)=>{const ingress=fixture();const {port}=await start(ingress);expect((await post(port,Buffer.from('{}'),{"content-type":"application/json"},path,method)).status).toBe(404);expect(ingress.authenticate).not.toHaveBeenCalled();});
  it("rejects duplicate content-type headers before capture",async()=>{
    const ingress=fixture();const {port}=await start(ingress);
    const response=await new Promise<string>((resolve,reject)=>{const socket=connect(port,"127.0.0.1");let data="";socket.on("connect",()=>socket.end("POST /v1/webhook HTTP/1.1\r\nHost: localhost\r\nContent-Type: application/json\r\nContent-Type: text/plain\r\nContent-Length: 2\r\nConnection: close\r\n\r\n{}"));socket.on("data",chunk=>{data+=chunk;});socket.on("end",()=>resolve(data));socket.on("error",reject);});
    expect(response).toContain("HTTP/1.1 400");expect(ingress.capture).not.toHaveBeenCalled();
  });
  it("rejects accessor-bearing capture results without invoking accessors",async()=>{
    const getter=vi.fn(()=>"accepted");const malformed=Object.defineProperty({},"status",{get:getter,enumerable:true});const ingress=fixture();ingress.capture.mockResolvedValue(malformed as WebhookIngressResult);
    const {port}=await start(ingress);expect((await post(port)).status).toBe(503);expect(getter).not.toHaveBeenCalled();
  });
  it("captures dependency callbacks and limits at construction",async()=>{
    const ingress=fixture();const options={ingress,maxRequestBytes:4,bodyTimeoutMs:1000};const server=createReplyWebhookServer(options);servers.push(server);await new Promise<void>(resolve=>server.listen(0,"127.0.0.1",resolve));
    const originalCapture=ingress.capture;ingress.authenticate=vi.fn(()=>false);ingress.capture=vi.fn(async()=>({status:"retry"}));options.maxRequestBytes=1;
    expect((await post((server.address() as AddressInfo).port,Buffer.from('{}'))).status).toBe(200);expect(originalCapture).toHaveBeenCalledOnce();expect(ingress.capture).not.toHaveBeenCalled();
  });
  it("times out an unfinished body without capture",async()=>{
    const ingress=fixture();const {port}=await start(ingress,{bodyTimeoutMs:30});
    const response=await new Promise<{status:number;body:string}>((resolve,reject)=>{const req=request({hostname:"127.0.0.1",port,path:"/v1/webhook",method:"POST",headers:{"content-type":"application/json","content-length":"10"}},res=>{let body="";res.on("data",chunk=>{body+=chunk;});res.on("end",()=>{req.destroy();resolve({status:res.statusCode!,body});});});req.on("error",reject);req.write("{");});
    expect(response).toEqual({status:408,body:'{"error":{"code":"request_timeout"}}'});expect(ingress.capture).not.toHaveBeenCalled();
  });
  it("returns retry when capture cannot commit within the acknowledgement window",async()=>{
    const capture=deferred<WebhookIngressResult>();const ingress=fixture();ingress.capture.mockImplementation(()=>capture.promise);
    const {port}=await start(ingress,{bodyTimeoutMs:30,captureTimeoutMs:30});
    const response=await post(port);expect(response).toEqual({status:503,body:'{"error":{"code":"retry"}}'});
    expect(ingress.capture).toHaveBeenCalledOnce();
    // Storage is still free to commit; timeout did not fail, cancel or retry that operation.
    capture.resolve({status:"accepted"});await new Promise(resolve=>setTimeout(resolve,20));
    expect(response).toEqual({status:503,body:'{"error":{"code":"retry"}}'});expect(ingress.capture).toHaveBeenCalledOnce();
  });
  it("does not capture an aborted body",async()=>{
    const ingress=fixture();const {port}=await start(ingress,{bodyTimeoutMs:50});
    await new Promise<void>(resolve=>{const req=request({hostname:"127.0.0.1",port,path:"/v1/webhook",method:"POST",headers:{"content-type":"application/json","content-length":"10"}});req.on("error",()=>{});req.on("socket",socket=>socket.on("connect",()=>{req.write("{");setTimeout(()=>{req.destroy();resolve();},10);}));});
    await new Promise(resolve=>setTimeout(resolve,60));expect(ingress.capture).not.toHaveBeenCalled();
  });
  it.each([{maxRequestBytes:0},{maxRequestBytes:1.5},{maxRequestBytes:1_048_577},{bodyTimeoutMs:0},{bodyTimeoutMs:60_001},{bodyTimeoutMs:Infinity},{captureTimeoutMs:0},{captureTimeoutMs:1.5},{captureTimeoutMs:Infinity},{captureTimeoutMs:25_000},{bodyTimeoutMs:15_000,captureTimeoutMs:15_000},{bodyTimeoutMs:29_999,captureTimeoutMs:1}])("rejects invalid configuration %#",async(options)=>{expect(()=>createReplyWebhookServer({ingress:fixture(),...options})).toThrow("Invalid reply webhook server configuration");});
});
