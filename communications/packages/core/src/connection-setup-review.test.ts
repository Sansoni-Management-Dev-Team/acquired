import {describe,expect,it,vi} from 'vitest';
import {createConnectionSetupCoordinator,type ConnectionSetupOptions} from './connection-setup';
function config(changes:Partial<ConnectionSetupOptions>){
  const issue=vi.fn(),createLink=vi.fn();
  const options:ConnectionSetupOptions={scope:{applicationId:'app',tenantId:'tenant',ownerId:'owner'},channel:'whatsapp',platform:'whatsapp',backend:'unipile',redirectOrigin:'https://app.example.test',successPath:'/success',failurePath:'/failed',notifyUrl:'https://service.example.test/notify',states:{issue,complete:vi.fn()},hostedAuth:{createLink},resolveReconnect:vi.fn(),...changes};
  return {options,issue,createLink};
}
describe('setup configuration agrees with channel backend contracts',()=>{
  for(const input of [{channel:'email',platform:'gmail',backend:'baileys'},{channel:'whatsapp',platform:'whatsapp',backend:'direct'},{channel:'linkedin',platform:'linkedin',backend:'direct'}] as const){
    it(`rejects ${input.channel}/${input.backend} before state or provider work`,()=>{
      const f=config(input);expect(()=>createConnectionSetupCoordinator(f.options)).toThrow('Invalid connection setup configuration');expect(f.issue).not.toHaveBeenCalled();expect(f.createLink).not.toHaveBeenCalled();
    });
  }
  for(const input of [{channel:'email',platform:'gmail',backend:'direct'},{channel:'whatsapp',platform:'whatsapp',backend:'baileys'},{channel:'linkedin',platform:'linkedin',backend:'browser'}] as const){
    it(`retains valid generic ${input.channel}/${input.backend} plugin configuration`,()=>{const f=config(input);expect(()=>createConnectionSetupCoordinator(f.options)).not.toThrow();});
  }
});
