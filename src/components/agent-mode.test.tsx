import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it, vi } from 'vitest';
import { emptyBrief } from '@/domain/acquisition';
vi.mock('next/navigation',()=>({useRouter:()=>({push:vi.fn()})}));
import { AgentModeToggle, AgentPlanReview } from './agent-mode';
it('offers an accessible opt-in switch that does not activate work',()=>{
 const html=renderToStaticMarkup(<AgentModeToggle enabled={false} onChange={()=>{}} />);
 expect(html).toContain('role="switch"');expect(html).toContain('aria-checked="false"');
 expect(html).toContain('Research-only preview');expect(html).not.toContain('Agent active');
});
it('shows the supplied brief, preserves unknowns and limits approval to research',()=>{
 const brief={...emptyBrief(),naturalLanguage:'Buy a Queensland refrigeration business.'};
 const html=renderToStaticMarkup(<AgentPlanReview brief={brief} busy={false} onStart={()=>{}} onBack={()=>{}} />);
 expect(html).toContain(brief.naturalLanguage);expect(html).toContain('Save mandate and start research');
 expect(html).toContain('Outreach and meeting booking are not enabled');expect(html).toContain('Not yet confirmed');
 expect(html).not.toContain('Activate autonomous outreach');
});
