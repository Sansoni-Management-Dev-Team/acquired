import {it,expect} from 'vitest';
import type {OutboundMessage} from '../../../packages/contracts/src';
import {parseSubmission} from './schema';
import {messageDigest} from '../../../packages/core/src/message-digest';
const binding={applicationId:'app',tenantId:'tenant',ownerId:'owner',connectionId:'original',accountId:'original-account',generation:1,channel:'email',platform:'gmail',backend:'unipile'} as const;
function input(parent:NonNullable<OutboundMessage['replyParent']>={message:{binding,id:'verified-parent'},contentDigest:'a'.repeat(64)}){const message={recipient:{kind:'email',value:'peer@example.invalid'} as const,subject:'Re: Original',text:'A contextual reply',replyParent:parent};return {snapshot:{binding,key:'original-operation',operation:'message' as const,payloadDigest:messageDigest('message',message)},message};}
it('retains an exact bound parent and its content fingerprint in the API payload',()=>{const value=input();expect(parseSubmission(value)).toEqual(value);});
it('rejects parent account/generation changes and simultaneous arbitrary thread selection',()=>{const value=input();expect(()=>parseSubmission(input({...value.message.replyParent,message:{binding:{...binding,generation:2},id:'verified-parent'}}))).toThrow();expect(()=>parseSubmission({...value,message:{...value.message,conversation:{binding,id:'other-thread'}}})).toThrow();});
it('binds parent changes into the immutable operation payload digest',()=>{expect(input().snapshot.payloadDigest).not.toBe(input({message:{binding,id:'other-parent'},contentDigest:'a'.repeat(64)}).snapshot.payloadDigest);});
