import {afterEach,expect,it,vi} from 'vitest';
import {BackgroundAdmission,withBackgroundBudget,backgroundBudget,backgroundRemaining} from './background-workload';
afterEach(()=>vi.useRealTimers());
it('limits concurrent work and rejects overflow without starting it',async()=>{
 const gate=new BackgroundAdmission({maximumQueued:1});let finish!:()=>void;
 const first=gate.run(()=>new Promise<void>(resolve=>{finish=resolve;}));
 const next=vi.fn(async()=>7),second=gate.run(next);const overflow=vi.fn(async()=>9);
 await expect(gate.run(overflow)).rejects.toMatchObject({reason:'busy'});expect(overflow).not.toHaveBeenCalled();expect(next).not.toHaveBeenCalled();
 finish();await first;expect(await second).toBe(7);
});
it('opens after three database failures and admits only one recovery attempt',async()=>{
 vi.useFakeTimers();const gate=new BackgroundAdmission({random:()=>0});const failure=()=>Promise.reject(Object.assign(Error('cancelled'),{code:'57014'}));
 for(let n=0;n<3;n++)await expect(gate.run(failure)).rejects.toThrow();
 const work=vi.fn(async()=>1);await expect(gate.run(work)).rejects.toMatchObject({reason:'cooldown'});expect(work).not.toHaveBeenCalled();
 await vi.advanceTimersByTimeAsync(30000);let finish!:()=>void;
 const probe=gate.run(()=>new Promise<void>(resolve=>{finish=resolve;}));
 await expect(gate.run(work)).rejects.toMatchObject({reason:'cooldown'});finish();await probe;expect(await gate.run(work)).toBe(1);
});
it('does not open the circuit for ordinary validation errors',async()=>{
 const gate=new BackgroundAdmission();for(let n=0;n<5;n++)await expect(gate.run(async()=>{throw Error('invalid actor');})).rejects.toThrow();
 expect(await gate.run(async()=>1)).toBe(1);
});
it('expires queued admission and never runs the expired work later',async()=>{
 vi.useFakeTimers();const gate=new BackgroundAdmission({waitMs:20});let finish!:()=>void;
 const first=gate.run(()=>new Promise<void>(resolve=>{finish=resolve;}));const work=vi.fn(async()=>1);
 const second=expect(gate.run(work)).rejects.toMatchObject({reason:'busy'});await vi.advanceTimersByTimeAsync(21);await second;
 finish();await first;expect(work).not.toHaveBeenCalled();
});
it('scopes deadlines to background work and prevents SQL after expiry',async()=>{
 expect(backgroundBudget()).toBeUndefined();await withBackgroundBudget('test',1,async()=>{
  expect(backgroundBudget()?.label).toBe('test');await new Promise(resolve=>setTimeout(resolve,5));expect(()=>backgroundRemaining()).toThrow();
 });expect(backgroundBudget()).toBeUndefined();
});
