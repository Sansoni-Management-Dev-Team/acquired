import {expect,it} from 'vitest';
import {messagesAroundInlineAction} from './agent-chat-timeline';

it('places later saved messages below the action that prompted them, preserving message chronology',()=>{
 const messages=[{id:'earlier',content:'Choose accounts.'},{id:'saved',content:'Accounts saved.'},{id:'next',content:'Prepare contacts.'}];
 expect(messagesAroundInlineAction(messages,['earlier'])).toEqual({before:[messages[0]],after:messages.slice(1)});
 expect(messages.map(message=>message.id)).toEqual(['earlier','saved','next']);
});
it('keeps the live editor after existing messages until an action is taken',()=>{
 const messages=[{id:'first'},{id:'second'}];
 expect(messagesAroundInlineAction(messages,null)).toEqual({before:messages,after:[]});
});
it('keeps the boundary when a refresh omits the last previously visible message',()=>{
 const messages=[{id:'first'},{id:'response'}];
 expect(messagesAroundInlineAction(messages,['first','removed'])).toEqual({before:[messages[0]],after:[messages[1]]});
 expect(messagesAroundInlineAction([{id:'new-response'}],[])).toEqual({before:[],after:[{id:'new-response'}]});
});
