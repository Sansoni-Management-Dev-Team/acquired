import { afterEach, expect, it, vi } from 'vitest';
import { randomUuid } from './random-uuid';
afterEach(() => vi.unstubAllGlobals());
it('uses native randomUUID when available', () => {
 const native=vi.fn(()=> '12345678-1234-4234-8234-123456789abc');
 vi.stubGlobal('crypto',{randomUUID:native});
 expect(randomUuid()).toBe('12345678-1234-4234-8234-123456789abc');
 expect(native).toHaveBeenCalledOnce();
});
it('creates a v4 UUID using secure bytes on HTTP origins without randomUUID', () => {
 const getRandomValues=vi.fn((bytes:Uint8Array)=>{ bytes.fill(255);return bytes; });
 vi.stubGlobal('crypto',{getRandomValues});
 expect(randomUuid()).toBe('ffffffff-ffff-4fff-bfff-ffffffffffff');
 expect(getRandomValues).toHaveBeenCalledOnce();
});
it('never falls back to predictable randomness when crypto is missing', () => {
 vi.stubGlobal('crypto',undefined);
 expect(()=>randomUuid()).toThrow('Secure random number generation is unavailable');
});
