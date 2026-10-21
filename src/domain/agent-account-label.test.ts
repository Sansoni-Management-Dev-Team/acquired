import {expect,it} from 'vitest';
import {formattedAgentAccountLabel} from './agent-account-label';
it('turns internal physical account labels into a neutral channel account without claiming simulation',()=>{
 const hash='a'.repeat(64);
 expect(formattedAgentAccountLabel(`whatsapp · whatsapp · physical-${hash}`,'whatsapp')).toBe('Recorded WhatsApp account');
 expect(formattedAgentAccountLabel(`email · gmail · physical-${hash}`,'email')).toBe('Recorded Email account');
 expect(formattedAgentAccountLabel('linkedin · linkedin','linkedin')).toBe('Recorded LinkedIn account');
 expect(formattedAgentAccountLabel(undefined,'email')).toBe('Recorded Email account');
});
it('preserves human account aliases and explicitly supplied simulated labels',()=>{
 expect(formattedAgentAccountLabel('Acquisitions team — Melbourne','email')).toBe('Acquisitions team — Melbourne');
 expect(formattedAgentAccountLabel('Simulated WhatsApp account','whatsapp')).toBe('Simulated WhatsApp account');
 expect(formattedAgentAccountLabel(`Operations team · whatsapp · physical-${'b'.repeat(64)}`,'whatsapp')).toBe('Operations team');
});
