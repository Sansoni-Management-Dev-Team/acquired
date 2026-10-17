import {createHash} from 'node:crypto';
import type {CommunicationEvent,ConnectionBinding} from '../../contracts/src';
export type EmailBounce=Extract<CommunicationEvent,{type:'email_change';change:'bounce'}>;
export function emailBounceSemantics(binding:ConnectionBinding,event:EmailBounce){
 const scope=[binding.applicationId,binding.tenantId,binding.ownerId,binding.connectionId,binding.accountId,binding.generation,binding.channel,binding.platform,binding.backend];
 const hash=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
 return {eventKey:hash(['communications.email.bounce.event.v1',scope,event.reference.id]),fingerprint:hash(['communications.email.bounce.content.v1',scope,event.reference.id,event.recipient.kind,event.recipient.value,new Date(event.occurredAt).toISOString()])};
}
