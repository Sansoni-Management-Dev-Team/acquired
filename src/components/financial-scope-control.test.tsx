import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {expect,it,vi} from 'vitest';
vi.mock('next/navigation',()=>({useRouter:()=>({refresh:vi.fn()})}));
import {MandateBriefForm} from './mandate-brief-form';
import {emptyBrief} from '@/domain/acquisition';
it('offers company or AU-only financial scope without assuming operating geography limits financial scope',()=>{
 const html=renderToStaticMarkup(<MandateBriefForm mandateId="fixture" brief={emptyBrief()}/>);
 expect(html).toContain('Financial scope');expect(html).toContain('Company/group revenue');expect(html).toContain('Australian operations only');
});
