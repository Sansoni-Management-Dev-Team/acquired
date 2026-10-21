import {expect,it} from 'vitest';
import {renderToStaticMarkup} from 'react-dom/server';
import {AgentResearchFunding} from './agent-research-funding';
const old={ready:true,exposure:{calls:'71',usdMicro:'71000000',perRequestMicro:'1000000'},scopes:[]};
it('retains the original whole-phase reserve disclosure for historical plans',()=>{const html=renderToStaticMarkup(<AgentResearchFunding funding={old}/>);expect(html).toContain('Whole-phase reserve: 71 calls');expect(html).toContain('Current limits cover this phase.');expect(html).not.toContain('per physical request');});
it('discloses a hard maximum separately from per-request call admission and its monetary reserve',()=>{const html=renderToStaticMarkup(<AgentResearchFunding funding={{...old,exposure:{calls:'24035',usdMicro:'11000000',perRequestMicro:'1000000',windowMinutes:17,callAdmission:'per_request',reserveCalls:'1'}}}/>);for(const text of['24,035','per physical request','$11.00','not reserved up front','saved work incomplete'])expect(html).toContain(text);expect(html).not.toContain('Whole-phase reserve: 24035 calls');});
