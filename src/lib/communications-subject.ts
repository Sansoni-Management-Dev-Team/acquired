import {types} from 'node:util';
import type {AccessScope} from '../../communications/packages/contracts/src';
/** Trusted composition still snapshots exact actor metadata before asynchronous work. */
export function captureCommunicationsSubject(value:unknown):Readonly<AccessScope>{
 if(!value||typeof value!=='object'||types.isProxy(value)||Object.getPrototypeOf(value)!==Object.prototype)throw Error('Invalid communications subject');
 const descriptors=Object.getOwnPropertyDescriptors(value),keys=['applicationId','tenantId','ownerId'] as const;
 if(Reflect.ownKeys(descriptors).sort().join(',')!==[...keys].sort().join(','))throw Error('Invalid communications subject');
 const captured={} as AccessScope;
 for(const key of keys){const d=descriptors[key];if(!d||!('value'in d)||typeof d.value!=='string'||!d.value||d.value.length>200||d.value.trim()!==d.value||/[\u0000-\u001f\u007f]/.test(d.value))throw Error('Invalid communications subject');captured[key]=d.value;}
 if(captured.applicationId!=='acquire')throw Error('Invalid communications subject');
 return Object.freeze(captured);
}
