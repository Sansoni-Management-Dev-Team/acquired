import {expect,it,vi} from 'vitest';vi.mock('server-only',()=>({}));
import {createAcquireCommunicationsService} from './communications-service';
it('refuses service startup when required storage is missing and never initializes or migrates it',async()=>{const preflight=vi.fn(async()=>false),webhooks=vi.fn();await expect(createAcquireCommunicationsService({unipile:{store:{preflight}},host:{createWebhooks:webhooks}} as never)).rejects.toThrow('Communications storage is not ready');expect(preflight).toHaveBeenCalledOnce();expect(webhooks).not.toHaveBeenCalled();});
