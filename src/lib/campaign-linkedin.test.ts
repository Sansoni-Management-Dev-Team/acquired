import { expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
import { linkedinProfileFor } from './campaign-linkedin';
it('preserves historical profile normalization and rejects lookalike hosts or company pages', () => {
    expect(linkedinProfileFor({ linkedinUrl: 'https://au.linkedin.com/in/alex' })).toBe('https://www.linkedin.com/in/alex');
    expect(() => linkedinProfileFor({ linkedinUrl: 'https://linkedin.com.evil.test/in/alex' })).toThrow();
    expect(() => linkedinProfileFor({ linkedinUrl: 'https://linkedin.com/company/alex' })).toThrow();
});
