import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
const root=new URL('../',import.meta.url),directory=new URL('ops/communications/production/database/',root);
const read=p=>readFileSync(new URL(p,root),'utf8'),sha=s=>createHash('sha256').update(s).digest('hex');
const split=s=>{const start=s.indexOf('BEGIN;\n')+7,end=s.indexOf('END $$;',start)+7;assert.ok(start>6&&end>6);return {header:s.slice(0,start),guard:s.slice(start,end),body:s.slice(end)};};
test('all eight production SQL artifacts retain exact reviewed service bodies and independently frozen hashes',()=>{
 const manifest=JSON.parse(readFileSync(new URL('manifest.json',directory),'utf8'));
 assert.equal(manifest.status,'prepared_unapproved_unapplied');assert.equal(manifest.target.host,'134.199.155.67');assert.equal(manifest.target.database,'acquire_communications');assert.equal(manifest.target.operator,'communications_admin');assert.equal(manifest.target.systemIdentifier,null);assert.equal(manifest.files.length,8);
 assert.deepEqual(readdirSync(directory).filter(n=>n.endsWith('.sql')).sort(),manifest.files.map(f=>f.production.split('/').at(-1)).sort());
 for(const f of manifest.files){const source=read(f.source),production=read(f.production);assert.equal(sha(source),f.sourceSha256);assert.equal(sha(production),f.sha256);const sourcePart=split(source);const productionStart=production.indexOf('-- BEGIN ORIGINAL PREREQUISITE GUARD\n');assert.ok(productionStart>0);const productionPart=split('BEGIN;\n'+production.slice(productionStart+'-- BEGIN ORIGINAL PREREQUISITE GUARD\n'.length));assert.equal(productionPart.body,sourcePart.body);assert.equal(sha(productionPart.body),f.bodySha256);}
});
test('every artifact requires exact production target, operator, deployment marker and fresh system-identifier attestation',()=>{
 const manifest=JSON.parse(readFileSync(new URL('manifest.json',directory),'utf8'));
 for(const f of manifest.files){const s=read(f.production);assert.match(s,/current_database\(\) <> 'acquire_communications'/);assert.match(s,/current_user <> 'communications_admin'/);assert.match(s,/session_user <> 'communications_admin'/);assert.match(s,/acquire-app-01\/acquire_communications/);assert.match(s,/current_setting\('acquire.expected_system_identifier', true\)/);assert.match(s,/IS DISTINCT FROM current_setting\('acquire.expected_system_identifier', true\)/);assert.doesNotMatch(s,/communications_fixture|7696118996713136162|127\.0\.0\.1:5446/);assert.match(s,/^BEGIN;/m);assert.match(s,/COMMIT;\s*$/);}
 const first=read(manifest.files[0].production);assert.match(first,/to_regnamespace\('communications'\) IS NOT NULL/);assert.match(first,/rolname IN \('communications_scoped','communications_control'\)/);assert.match(first,/n\.nspname='public'/);
});
