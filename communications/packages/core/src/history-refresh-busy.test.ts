import {it,expect} from 'vitest';
import {HistoryRefreshBusyError,isHistoryRefreshBusyError} from './history-refresh-busy';
import type {ConnectionBinding} from '../../contracts/src';
const binding:ConnectionBinding={applicationId:'app',tenantId:'tenant-private',ownerId:'owner-private',connectionId:'connection-private',accountId:'account-private',generation:1,channel:'email',platform:'gmail',backend:'unipile'};
it('retains exact private original scope without serializing account identifiers',()=>{
 const original={...binding},error=new HistoryRefreshBusyError(original);original.accountId='changed';
 expect(isHistoryRefreshBusyError(error,binding)).toBe(true);
 expect(isHistoryRefreshBusyError(error,{...binding,generation:2})).toBe(false);
 expect(isHistoryRefreshBusyError(error,{...binding,ownerId:'another'})).toBe(false);
 expect(JSON.stringify(error)+String(error)).not.toContain('private');
});
it('rejects serialized, name-only and prototype-forged causes',()=>{
 for(const error of [{name:'HistoryRefreshBusyError'},Object.create(HistoryRefreshBusyError.prototype),new Error('busy'),null])expect(isHistoryRefreshBusyError(error,binding)).toBe(false);
});
