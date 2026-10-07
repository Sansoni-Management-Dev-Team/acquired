import { expect, it } from 'vitest';
import { contactCompanyEligible, contactDeadlineAdmits, selectCompanyContacts } from './company-contact-policy';
const candidate = (id: string, position: string, emailAvailable = false) => ({ id, position, emailAvailable, phoneAvailable: false });
it('RC-09-regression: excluded workforce cannot enter automatic contacts', () => {
  expect(contactCompanyEligible('excluded', { geography: 'supported', sector: 'supported', headcount: 'excluded' })).toBe(false);
  expect(selectCompanyContacts(Array.from({length:209}, (_,i)=>candidate(`${i}`, 'Technician')))).toEqual([]);
});
it('RC-09-generalization: evidence gates independently of country, brand and financial uncertainty', () => {
  for (const qualification of ['research','enriched','qualified']) {
    expect(contactCompanyEligible(qualification,{geography:'supported',sector:'supported',revenue:'review'})).toBe(true);
    for (const field of ['geography','sector']) expect(contactCompanyEligible(qualification,{geography:'supported',sector:'supported',[field]:'review'})).toBe(false);
  }
  expect(contactCompanyEligible('research',undefined)).toBe(false);
  expect(contactCompanyEligible('research',{geography:'supported',sector:'supported',revenue:'excluded'})).toBe(false);
});
it('RC-09-generalization: role ranking is deterministic, deduplicated, bounded and not employee-count driven', () => {
  const people = [candidate('technician','Technician'),candidate('director','Director',true),candidate('owner','Owner'),candidate('owner','Owner'),...Array.from({length:8},(_,i)=>candidate(`c${i}`,'Chief Financial Officer'))];
  const chosen=selectCompanyContacts(people);
  expect(chosen.map(person=>person.id)).toEqual(['owner','director','c0','c1','c2']);
  expect(selectCompanyContacts([...people].reverse())).toEqual(chosen);
});
it('RC-10-generalization: admission leaves one minute and cannot start at deadline', () => {
  for(const offset of [-1,0,1,59_999,60_000]) expect(contactDeadlineAdmits(1_000_000,1_000_000-offset)).toBe(false);
  expect(contactDeadlineAdmits(1_000_000,939_999)).toBe(true);
});
