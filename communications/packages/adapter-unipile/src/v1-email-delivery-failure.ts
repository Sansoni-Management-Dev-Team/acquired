import {plain} from './v1-read-guard';
/** Conservative machine DSN classification on a full, account-verified email.
 * This is delivery evidence, never a human reply. No body, display-name parsing,
 * alias guessing or model classification can choose the failed recipient. */
export function classifyEmailDeliveryFailure(mail:unknown):{kind:'none'}|{kind:'ambiguous'}|{kind:'bounce';recipient:string}{
 if(!plain(mail)||!Array.isArray(mail.headers))return {kind:'none'};
 const headers:Record<string,string[]>={};
 for(const header of mail.headers){if(!plain(header)||typeof header.name!=='string'||typeof header.value!=='string'||header.name.length>128||header.value.length>16384||/[\u0000-\u001f\u007f]/.test(header.value))return {kind:'none'};(headers[header.name.toLowerCase()]??=[]).push(header.value.trim().toLowerCase());}
 const values=(name:string)=>headers[name]??[],one=(name:string)=>values(name).length===1?values(name)[0]:null;
 const from=plain(mail.from_attendee)&&mail.from_attendee.identifier_type==='EMAIL_ADDRESS'&&typeof mail.from_attendee.identifier==='string'?mail.from_attendee.identifier.toLowerCase():'';
 const machine=/^(?:mailer-daemon|postmaster)(?:[+.-].*)?@/.test(from),report=values('content-type').some(value=>/^(?:multipart\/report\s*;.*report-type\s*=\s*"?delivery-status"?|message\/delivery-status)(?:\s*;|\s*$)/.test(value));
 if(!report||!values('return-path').includes('<>'))return {kind:'none'};
 if(!machine)return {kind:'ambiguous'};
 const recipient=one('x-failed-recipients');
 if(!recipient||recipient.length>254||! /^[A-Za-z0-9.!#$%&'*+\/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?$/.test(recipient))return {kind:'ambiguous'};
 const [local,domain]=recipient.split('@');if(local.length>64||local.startsWith('.')||local.endsWith('.')||local.includes('..')||!domain.includes('.')||domain.includes('..')||domain.split('.').some(part=>part.startsWith('-')||part.endsWith('-')||part.length>63))return {kind:'ambiguous'};
 return {kind:'bounce',recipient};
}
