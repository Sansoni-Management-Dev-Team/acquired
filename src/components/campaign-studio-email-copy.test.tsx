import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, expect, it, vi } from 'vitest';
const opened=vi.hoisted(()=>({falseStates:0}));
vi.mock('react',async importOriginal=>{
 const actual=await importOriginal<typeof import('react')>();
 return {...actual,useState(initial:unknown){
  // Render the actual confirmation branch after its existing open-dialog state transition.
  const value=initial===false&&++opened.falseStates===3?true:initial;
  return actual.useState(value);
 }};
});
vi.mock('@/components/campaign-sequence-editor',()=>({CampaignSequenceEditor:()=>null}));
import { CampaignStudio, type StudioData } from './campaign-studio';
beforeEach(()=>{opened.falseStates=0;});
function confirmation(mailbox:StudioData['mailbox']){
 const definition={schemaVersion:1 as const,steps:[{id:'email',kind:'email' as const,title:'Introduction',subject:'Hello',body:'Hello'}]};
 const data:StudioData={mailbox,contacts:[],enrolments:[],sequences:[{id:'sequence',name:'Introduction',draft:definition,publishedDefinition:definition,publishedVersion:1,n8nWorkflowId:null,updatedAt:'2026-10-14T00:00:00.000Z'}]};
 const html=renderToStaticMarkup(<CampaignStudio mandateId="mandate" mandateName="Example" initialData={data}/>);
 expect(html).toContain('aria-label="Confirm automation"');
 return {html,button:html.match(/<button\b[^>]*>[\s\S]*?<\/button>/g)?.find(value=>value.includes('Confirm and start'))};
}
it('asks for an email account without exposing internal suppliers and preserves the unready confirmation gate',()=>{
 const {html,button}=confirmation(null);
 expect(html).toContain('From your email account.');
 expect(html).toContain('Connect an email account with verified reply monitoring for this sequence.');
 expect(html).not.toMatch(/your Gmail account|Connect Gmail|unipile|firmable|n8n/i);
 expect(button).toContain('disabled=""');
});
it('shows the selected email address and keeps a ready mailbox confirmation available',()=>{
 const {html,button}=confirmation({address:'sender@outlook.test',ready:true,dailyCap:100,status:'ready'});
 expect(html).toContain('From sender@outlook.test.');
 expect(html).not.toContain('Connect an email account');
 expect(button).not.toContain('disabled=""');
});
