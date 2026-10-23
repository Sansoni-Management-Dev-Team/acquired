import {renderToStaticMarkup} from 'react-dom/server';
import {afterEach,expect,it,vi} from 'vitest';
const route=vi.hoisted(()=>({pathname:'/',query:''}));
vi.mock('next/navigation',()=>({usePathname:()=>route.pathname,useSearchParams:()=>new URLSearchParams(route.query)}));
import {AcquisitionProgress} from './acquisition-progress';
const mandate='/mandates/997bc96a-04a6-41ca-823f-e7ed7f2d899e';
afterEach(()=>{route.pathname='/';route.query='';});
it.each([mandate+'/agent',mandate+'/agent/'])('does not label the agent conversation as manual stage1 (%s)',pathname=>{route.pathname=pathname;expect(renderToStaticMarkup(<AcquisitionProgress/>)).toBe('');});
it.each([
 ['/', '', 'Stage 1 of 4 · Brief'],
 [mandate, '', 'Stage 1 of 4 · Brief'],
 [mandate, 'tab=targets', 'Stage 2 of 4 · Companies'],
 [mandate+'/targets/company-id', '', 'Stage 2 of 4 · Companies'],
 [mandate+'/people', '', 'Stage 3 of 4 · People'],
 ['/preview/outreach', '', 'Stage 4 of 4 · Outreach'],
])('preserves the manual progress on %s?%s',(pathname,query,label)=>{Object.assign(route,{pathname,query});const html=renderToStaticMarkup(<AcquisitionProgress/>);expect(html).toContain('aria-label="Acquisition progress"');expect(html).toContain(label);expect(html.match(/aria-current="step"/g)).toHaveLength(1);});
