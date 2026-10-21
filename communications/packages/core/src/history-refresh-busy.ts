import {assertSameBinding,type ConnectionBinding} from '../../contracts/src';
const originals=new WeakMap<object,ConnectionBinding>();
/** Emitted only after the authenticated checkpoint repository observes a live
 * competing refresh. Scope is private; serialized errors confer no authority. */
export class HistoryRefreshBusyError extends Error{
 constructor(binding:ConnectionBinding){super('Recorded history refresh is already in progress');this.name='HistoryRefreshBusyError';assertSameBinding(binding,binding);originals.set(this,structuredClone(binding));}
}
export function isHistoryRefreshBusyError(error:unknown,expected?:ConnectionBinding):error is HistoryRefreshBusyError{
 if(typeof error!=='object'||error===null)return false;const original=originals.get(error);if(!original)return false;
 try{if(expected)assertSameBinding(expected,original);return true;}catch{return false;}
}
