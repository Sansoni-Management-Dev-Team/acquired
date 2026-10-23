import{expect,it,vi}from'vitest';
import{readJsonResponse}from'./read-json-response';
it.each(['','{"result":','<!DOCTYPE html><title>Failure</title>','null','[]','42'])('refuses an unconfirmed object response without exposing its body: %s',async body=>{
 await expect(readJsonResponse(new Response(body),'Check saved progress before retrying.')).rejects.toThrow('Check saved progress before retrying.');
});
it('retains valid receipts and HTTP error envelopes for existing caller status checks',async()=>{expect(await readJsonResponse(Response.json({result:{revision:2}}),'unconfirmed')).toEqual({result:{revision:2}});expect(await readJsonResponse(Response.json({error:'Changed'},{status:409}),'unconfirmed')).toEqual({error:'Changed'});});
it('handles an interrupted body read without another request or leaking transport details',async()=>{const json=vi.fn().mockRejectedValue(Error('private upstream detail'));await expect(readJsonResponse({json}as never,'Could not confirm the action.')).rejects.toThrow('Could not confirm the action.');expect(json).toHaveBeenCalledOnce();});
