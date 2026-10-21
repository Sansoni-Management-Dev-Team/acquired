'use client';

import {useSyncExternalStore} from 'react';

const subscribe=()=>()=>{};
const clientSnapshot=()=>true;
const serverSnapshot=()=>false;

/** Keep SSR and hydration identical, then show the viewer's local timestamp. */
export function BrowserLocalTime({value}:{value:string|null}) {
  const mounted=useSyncExternalStore(subscribe,clientSnapshot,serverSnapshot);
  return value?<time dateTime={value}>{mounted?new Date(value).toLocaleString('en-AU',{dateStyle:'medium',timeStyle:'short'}):'—'}</time>:<>—</>;
}
