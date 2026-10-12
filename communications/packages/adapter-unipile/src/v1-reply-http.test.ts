import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { UnipileV1Transport } from './v1-http';

const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => { await Promise.all(cleanup.splice(0).map(fn => fn())); });
async function fixture(handler: (req: IncomingMessage, res: ServerResponse) => void) {
  const server = createServer(handler);await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  cleanup.push(() => new Promise<void>(resolve => { server.closeAllConnections();server.close(() => resolve()); }));
  const address=server.address();if(!address||typeof address==='string')throw new Error('Fixture unavailable');
  return `http://127.0.0.1:${address.port}/api/v1`;
}
function client(baseUrl:string,overrides={}) {return new UnipileV1Transport({apiVersion:'v1',baseUrl,apiKey:'synthetic-read-key',allowLoopbackHttp:true,timeoutMs:100,...overrides});}
const account='opaque/+account',chat='chat/+opaque';
const exactChat={object:'Chat',id:chat,account_id:account};

describe('read-only Unipile v1 reply transport',()=>{
  it('lists exactly one account using documented cursor/limit query fields',async()=>{
    const seen:unknown[]=[];const base=await fixture((req,res)=>{seen.push({method:req.method,url:req.url,cache:req.headers['cache-control'],contentType:req.headers['content-type']});res.end('{"object":"ChatList","items":[],"cursor":null}');});
    expect(await client(base).listChats(account,{cursor:'opaque/+cursor',limit:250})).toMatchObject({kind:'success'});
    expect(seen).toEqual([{method:'GET',url:'/api/v1/chats?account_id=opaque%2F%2Baccount&cursor=opaque%2F%2Bcursor&limit=250',cache:'no-store',contentType:undefined}]);
  });
  it('verifies exact chat ownership before unscoped message/attendee list reads',async()=>{
    const paths:string[]=[];const base=await fixture((req,res)=>{paths.push(req.url!);expect(req.method).toBe('GET');expect(req.headers['cache-control']).toBe('no-store');res.end(JSON.stringify(req.url!.includes('/messages')?{object:'MessageList',items:[],cursor:null}:req.url!.includes('/attendees')?{object:'ChatAttendeeList',items:[],cursor:null}:exactChat));});
    const api=client(base);expect((await api.listChatMessages(account,chat,{cursor:'next/+page',limit:1})).kind).toBe('success');expect((await api.getChatAttendees(account,chat)).kind).toBe('success');
    expect(paths).toEqual(['/api/v1/chats/chat%2F%2Bopaque?account_id=opaque%2F%2Baccount','/api/v1/chats/chat%2F%2Bopaque/messages?cursor=next%2F%2Bpage&limit=1','/api/v1/chats/chat%2F%2Bopaque?account_id=opaque%2F%2Baccount','/api/v1/chats/chat%2F%2Bopaque/attendees']);
  });
  it.each([{...exactChat,account_id:'other'},{...exactChat,id:'other'},{...exactChat,object:'Message'},null,{},[exactChat]])('refuses mismatched preflight without a list read %#',async(data)=>{
    const paths:string[]=[];const base=await fixture((req,res)=>{paths.push(req.url!);res.end(JSON.stringify(data));});const api=client(base);
    await expect(api.listChatMessages(account,chat)).rejects.toThrow('Invalid Unipile read scope');await expect(api.getChatAttendees(account,chat)).rejects.toThrow('Invalid Unipile read scope');
    expect(paths).toHaveLength(2);expect(paths.every(path=>path.includes('account_id=')&&!path.includes('/messages')&&!path.includes('/attendees'))).toBe(true);
  });
  it('refuses unexpected successful preflight status',async()=>{let requests=0;const base=await fixture((_req,res)=>{requests++;res.statusCode=201;res.end(JSON.stringify(exactChat));});await expect(client(base).getChatAttendees(account,chat)).rejects.toThrow('Invalid Unipile read scope');expect(requests).toBe(1);});
  it.each([401,403,404,429,503])('preserves failed preflight result without retries or extra reads %s',async(status)=>{
    const paths:string[]=[];const base=await fixture((req,res)=>{paths.push(req.url!);res.statusCode=status;res.end('private fixture diagnostic');});const result=await client(base).listChatMessages(account,chat);
    expect(result.kind).not.toBe('success');expect(JSON.stringify(result)).not.toContain('private fixture diagnostic');expect(paths).toHaveLength(1);
  });
  it.each([{limit:0},{limit:251},{limit:1.5},{limit:Infinity},{cursor:''},{cursor:'x\n'},{cursor:'x'.repeat(2049)},{offset:1},{account_id:'other'},{before:'2026-10-12T00:00:00.000Z'},{sync:true}])('rejects malformed or unsupported pagination before I/O %#',async(pagination)=>{
    const fetcher=vi.fn();const api=client('https://a.unipile.com/api/v1',{fetch:fetcher});await expect(api.listChats(account,pagination as never)).rejects.toThrow('Invalid Unipile request');await expect(api.listChatMessages(account,chat,pagination as never)).rejects.toThrow('Invalid Unipile request');expect(fetcher).not.toHaveBeenCalled();
  });
  it('rejects hidden/foreign pagination fields instead of silently ignoring them',async()=>{
    const pagination=Object.defineProperty({},'account_id',{value:'other'});const fetcher=vi.fn();const api=client('https://a.unipile.com/api/v1',{fetch:fetcher});
    await expect(api.listChats(account,pagination)).rejects.toThrow('Invalid Unipile request');expect(fetcher).not.toHaveBeenCalled();
  });
  it('rejects pagination accessors without invoking them',async()=>{
    const getter=vi.fn(()=> 'next-page');const pagination=Object.defineProperty({},'cursor',{enumerable:true,get:getter});const fetcher=vi.fn();const api=client('https://a.unipile.com/api/v1',{fetch:fetcher});
    await expect(api.listChatMessages(account,chat,pagination)).rejects.toThrow('Invalid Unipile request');expect(getter).not.toHaveBeenCalled();expect(fetcher).not.toHaveBeenCalled();
  });
  it.each(['','..',' account','a\n','a'.repeat(2049),'account1,account2'])('rejects invalid or multiple account scope before I/O %#',async(id)=>{
    const fetcher=vi.fn();const api=client('https://a.unipile.com/api/v1',{fetch:fetcher});await expect(api.listChats(id)).rejects.toThrow('Invalid Unipile request');await expect(api.listChatMessages(id,chat)).rejects.toThrow('Invalid Unipile request');await expect(api.getChatAttendees(id,chat)).rejects.toThrow('Invalid Unipile request');expect(fetcher).not.toHaveBeenCalled();
  });
  it.each(['','..',' c','c\n','c'.repeat(2049)])('rejects invalid chat paths before I/O %#',async(id)=>{const fetcher=vi.fn();const api=client('https://a.unipile.com/api/v1',{fetch:fetcher});await expect(api.listChatMessages(account,id)).rejects.toThrow('Invalid Unipile request');await expect(api.getChatAttendees(account,id)).rejects.toThrow('Invalid Unipile request');expect(fetcher).not.toHaveBeenCalled();});
  it('does not retry failed list reads or invoke synchronization',async()=>{const paths:string[]=[];const base=await fixture((req,res)=>{paths.push(req.url!);if(req.url!.includes('/messages')){res.statusCode=503;res.end('{}');}else res.end(JSON.stringify(exactChat));});expect(await client(base).listChatMessages(account,chat)).toEqual({kind:'unavailable',reason:'provider_failure',status:503});expect(paths).toHaveLength(2);expect(paths.some(path=>path.includes('/sync'))).toBe(false);});
  it('cancellation during preflight prevents the unscoped read',async()=>{const controller=new AbortController();const paths:string[]=[];const base=await fixture((req,res)=>{paths.push(req.url!);controller.abort();res.end(JSON.stringify(exactChat));});expect((await client(base).getChatAttendees(account,chat,{signal:controller.signal})).kind).not.toBe('success');expect(paths).toHaveLength(1);});
  it('owns pagination values before awaiting preflight',async()=>{const pagination={cursor:'original',limit:5};const base=await fixture((req,res)=>{if(!req.url!.includes('/messages')){pagination.cursor='changed';pagination.limit=250;res.end(JSON.stringify(exactChat));}else{expect(req.url).toBe('/api/v1/chats/chat%2F%2Bopaque/messages?cursor=original&limit=5');res.end('{}');}});expect((await client(base).listChatMessages(account,chat,pagination)).kind).toBe('success');});
});
