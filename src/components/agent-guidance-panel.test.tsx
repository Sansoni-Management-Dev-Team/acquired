import {renderToStaticMarkup} from 'react-dom/server';
import {expect,it,vi} from 'vitest';
import {AgentGuidancePanel} from './agent-guidance-panel';
import type {AgentGuidanceView} from '@/domain/agent-guidance';
const item:AgentGuidanceView={id:'00000000-0000-4000-8000-000000000002',revision:2,state:'approved',organizationId:'org',mandateId:'mandate',userId:'user',input:{text:'Prefer maintenance.',category:'qualification',sourceMessageId:'00000000-0000-4000-8000-000000000001',triggerTerms:[]}};
it('labels scope and offers explicit revocation for approved guidance',()=>{
 const html=renderToStaticMarkup(<AgentGuidancePanel guidance={[item]} busy={false} onAction={vi.fn()} onCloseDraft={vi.fn()}/>);
 expect(html).toContain('For this mandate only');expect(html).toContain('Prefer maintenance.');expect(html).toContain('Revoke');expect(html).toContain('<details');
});
it('keeps candidate confirmation separate from outbound approvals',()=>{
 const html=renderToStaticMarkup(<AgentGuidancePanel guidance={[{...item,state:'proposed'}]} busy={false} onAction={vi.fn()} onCloseDraft={vi.fn()}/>);
 expect(html).toContain('Confirm guidance');expect(html).toContain('Not used until you confirm');expect(html).not.toContain('Approve all');
});
it('shows a bounded editable candidate instead of silently remembering a message',()=>{
 const html=renderToStaticMarkup(<AgentGuidancePanel guidance={[]} draft={{sourceMessageId:item.input.sourceMessageId,text:'A candidate preference'}} busy={false} onAction={vi.fn()} onCloseDraft={vi.fn()}/>);
 expect(html).toContain('Save suggestion');expect(html).toContain('A candidate preference');expect(html).toContain('maxLength="2000"');
});
it('shows the exact reviewed company phrases and immutable source provenance before confirmation',()=>{const policy={avoidTerms:['installation-heavy'],preferTerms:['recurring maintenance']},sourceEntity={kind:'operation' as const,id:'00000000-0000-4000-8000-000000000003',revision:4,digest:'a'.repeat(64)};const html=renderToStaticMarkup(<AgentGuidancePanel guidance={[{...item,state:'proposed',input:{...item.input,qualificationPolicy:policy,sourceEntity}}]} busy={false} onAction={vi.fn()} onCloseDraft={vi.fn()}/>);expect(html).toContain('installation-heavy');expect(html).toContain('recurring maintenance');expect(html).toContain(sourceEntity.id);expect(html).toContain('version 4');expect(html).toContain('Confirm guidance');expect(html).not.toContain('Approve all');});
