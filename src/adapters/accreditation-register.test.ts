import { expect,it } from 'vitest';
import { accreditationSourceUrls,parseAccreditationContact } from './accreditation-register';
const url='https://nata.com.au/accredited-organisation/synthetic-laboratory-12345-67890/';
const html='<h1>Synthetic Laboratory Pty Ltd</h1><p>Accreditation No. 12345</p><p>Site No. 67890</p><a href="https://www.synthetic.example.test/">Company website</a><h3>Contact</h3><p>Dr Avery Morgan P: +61 0400 000 999</p>';
it('retains a source-linked public register contact without inventing an executive role',()=>{
 expect(parseAccreditationContact(html,url,'synthetic.example.test','2026-10-08T00:00:00Z')).toEqual({name:'Avery Morgan',phone:'+61 0400 000 999',role:'Accreditation contact',sourceUrl:url,registry:'NATA',accreditationNumber:'12345',siteNumber:'67890',capturedAt:'2026-10-08T00:00:00Z'});
});
it('rejects mismatched identity, hidden links, unlabelled phone and unrelated host',()=>{
 expect(parseAccreditationContact(html,url,'another.example.test')).toBeNull();
 expect(parseAccreditationContact(html.replace('<a href="https://www.synthetic.example.test/">Company website</a>','<!-- <a href="https://synthetic.example.test">Hidden</a> -->'),url,'synthetic.example.test')).toBeNull();
 expect(parseAccreditationContact(html.replace('P:','Office'),url,'synthetic.example.test')).toBeNull();
 expect(parseAccreditationContact(html,'https://other.example.test/accredited-organisation/test/','synthetic.example.test')).toBeNull();
});
it('uses only bounded documented NATA source URLs and preserves independently disclosed sites',()=>{
 expect(accreditationSourceUrls({org_registers:[{url},{url},{url:'http://127.0.0.1/private'}, {url:'https://api.firmable.com/internal/guessed'}],description:url})).toEqual([url]);
 expect(accreditationSourceUrls({description:url})).toEqual([]);
 const other=html.replace('Site No. 67890','Site No. 67891');
 expect(parseAccreditationContact(other,url,'synthetic.example.test')?.siteNumber).toBe('67891');
});
