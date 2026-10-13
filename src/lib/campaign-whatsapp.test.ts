import { expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
import { whatsappRecipientFor } from './campaign-whatsapp';
it('preserves canonical historical international phone identities without transport', () => {
    expect(whatsappRecipientFor({ phone: '+61 (412) 345-678' })).toBe('61412345678@s.whatsapp.net');
    for (const phone of ['0412345678', '+61 4xx xxx xxx', '+123', '+61412345678 ext 9', '61412345678@s.whatsapp.net', '']) expect(() => whatsappRecipientFor({ phone })).toThrow('country code');
});
