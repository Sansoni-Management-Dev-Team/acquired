import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {expect,it,vi} from 'vitest';
vi.mock('next/navigation',()=>({useRouter:()=>({refresh:vi.fn()})}));
import {MandateBriefForm} from './mandate-brief-form';
import {emptyBrief} from '@/domain/acquisition';
it('shows the brief description and search action without the removed criteria controls',()=>{
 const html=renderToStaticMarkup(<MandateBriefForm mandateId="fixture" brief={emptyBrief()}/>);
 expect(html).toContain('Describe the acquisition brief');
 expect(html).toContain('Find companies');
 expect(html).not.toContain('Financial scope');
 expect(html).not.toContain('Acquisition criteria');
 expect(html).not.toContain('Save criteria');
});
