import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect,it,vi } from 'vitest';
const m=vi.hoisted(()=>({research:vi.fn()}));
vi.mock('./app-shell',()=>({SidebarRegistration:()=>null}));
vi.mock('./research-panel',()=>({ResearchPanel:m.research}));
import { MandateWorkspace } from './mandate-workspace';
import { emptyBrief } from '@/domain/acquisition';
it('renders Companies without mounting the research-history poller',()=>{
  const mandate={id:'mandate',brief:emptyBrief(),createdAt:'2026-09-30'};
  const initial={mandate,memberships:[],coverage:[],valuations:[],buyerProfile:null,contacts:[],firmableRefreshes:[]};
  const html=renderToStaticMarkup(<MandateWorkspace mandates={[mandate]} initial={initial} tab="targets" />);
  expect(html).toContain('Companies');
  expect(m.research).not.toHaveBeenCalled();
});
