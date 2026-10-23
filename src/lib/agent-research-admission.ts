/** The existing concurrency queue is not spend admission. Native jobs and any
 * descendants are blocked at the callback boundary until all physical provider
 * attempts use the persisted budget protocol. Original UI jobs retain behavior. */
export function nativeResearchProviderAdmissionRequired(config:unknown,rootConfig?:unknown):boolean{
 const native=(v:unknown)=>Boolean(v&&typeof v==='object'&&'nativeAgent' in v);
 return native(config)||native(rootConfig);
}
