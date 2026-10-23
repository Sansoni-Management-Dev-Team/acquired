type Data=Record<string,unknown>;
export function firmableDoNotContact(raw:Data):boolean{
 return raw.do_not_contact===true||raw.doNotContact===true||(Array.isArray(raw.phones)&&raw.phones.some(phone=>Boolean(phone&&typeof phone==='object'&&(phone as Data).is_dnd===true)))||Boolean(raw.browserResponse&&typeof raw.browserResponse==='object'&&(raw.browserResponse as Data)!==raw&&firmableDoNotContact(raw.browserResponse as Data));
}
/** Preserve the preference while removing disclosed phone values, including the
 * retained provider-shaped response. Email contact research never reveals phones. */
export function withoutFirmablePersonPhones(raw:Data):Data{
 const strip=(value:unknown):unknown=>Array.isArray(value)?value.map(strip):value&&typeof value==='object'?Object.fromEntries(Object.entries(value).filter(([key])=>!['phone','phones','mobile'].includes(key)).map(([key,item])=>[key,strip(item)])):value;
 return {...strip(raw) as Data,do_not_contact:firmableDoNotContact(raw),has_phone:false,phone_available:false};
}
