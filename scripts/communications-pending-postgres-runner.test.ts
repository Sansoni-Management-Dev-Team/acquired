import { afterEach, it, expect, vi } from 'vitest';
import { mkdtempSync, mkdirSync, copyFileSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pendingPostgresSuites, runPendingPostgresVerification } from './test-communications-pending-postgres-local.mjs';
const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true }); });
function fixture(fault = '') {
    const root = mkdtempSync(join(tmpdir(), 'pending-pg-orchestration-'));
    roots.push(root);
    for (const path of ['node_modules/vitest', 'src/db', 'communications/packages/core/src', 'scripts'])
        mkdirSync(join(root, path), { recursive: true });
    writeFileSync(join(root, 'communications/packages/core/src/fixture.ts'), 'export const fixture=true;\n');
    for (const suite of pendingPostgresSuites)
        copyFileSync(suite.file, join(root, suite.file));
    writeFileSync(join(root, 'node_modules/vitest/vitest.mjs'), `import {readFileSync,writeFileSync} from 'node:fs';import {join} from 'node:path';import assert from 'node:assert/strict';
const plan=${JSON.stringify(pendingPostgresSuites)},fault=${JSON.stringify(fault)};assert.equal(process.env.UNIPILE_API_KEY,'');assert.equal(process.env.WHATSAPP_SERVICE_SECRET,'');assert.equal(process.env.LINKEDIN_SERVICE_URL,'');assert.equal(process.env.COMMUNICATIONS_RUNTIME_ENABLED,'');assert.equal(process.env.CAMPAIGN_ISOLATED_CHANNEL_STACK,'1');for(const item of plan){const expr=readFileSync(item.file,'utf8').match(/const enabled = (.*);/)[1];assert.equal(Function('process','return ('+expr+')')(process),true,item.file);}assert.ok(process.argv.includes('--no-file-parallelism'));writeFileSync('child-ran','yes');const results=plan.map(item=>({name:join(process.cwd(),item.file),status:'passed',assertionResults:Array.from({length:item.cases},(_,i)=>({title:String(i),status:'passed'}))}));const total=plan.reduce((n,item)=>n+item.cases,0);if(fault==='skip')results[0].assertionResults[0].status='pending';if(fault==='count')results[0].assertionResults.pop();if(fault==='source')writeFileSync('communications/packages/core/src/fixture.ts','export const fixture=false;');const target=process.argv.find(p=>p.startsWith('--outputFile.json=')).slice('--outputFile.json='.length);writeFileSync(target,JSON.stringify({success:true,numTotalTests:total,numPassedTests:total-(fault==='skip'?1:0),numFailedTests:0,numPendingTests:fault==='skip'?1:0,numTodoTests:0,testResults:results}));`);
    const preflight = vi.fn(async () => ({ verified: true, targets: [] }));
    return { root, preflight, options: { root, env: { PATH: process.env.PATH, COMMUNICATIONS_PENDING_POSTGRES_AUDIT: '1', UNIPILE_API_KEY: 'must-not-leak', WHATSAPP_SERVICE_SECRET: 'must-not-leak', LINKEDIN_SERVICE_URL: 'must-not-leak' }, preflight } };
}
it('runs all frozen pending suites serially only after both target preflights with exact flags and sanitized environment', async () => { const f = fixture(), report = await runPendingPostgresVerification(f.options); expect(f.preflight).toHaveBeenCalledOnce(); expect(report.allTestsExecuted).toBe(true); expect(report.testsPassed).toBe(67); expect(report.testsSkipped).toBe(0); expect(report.sourceStable).toBe(true); expect(report.actualPostgresProof).toBe(false); expect(existsSync(join(f.root, 'child-ran'))).toBe(true); });
it('refuses absent new schema before starting any test child', async () => { const f = fixture(); f.preflight.mockRejectedValueOnce(Error('Pending approved schema absent')); await expect(runPendingPostgresVerification(f.options)).rejects.toThrow('Pending PostgreSQL prerequisites unavailable'); expect(existsSync(join(f.root, 'child-ran'))).toBe(false); });
it('requires explicit opt-in before preflight or fixture/private file access', async () => { const f = fixture(); await expect(runPendingPostgresVerification({ ...f.options, env: {} })).rejects.toThrow('Explicit pending PostgreSQL audit opt-in required'); expect(f.preflight).not.toHaveBeenCalled(); expect(existsSync(join(f.root, 'child-ran'))).toBe(false); });
it.each(['skip', 'count', 'source'])('successful child exit cannot certify %s evidence', async (fault) => { const f = fixture(fault); await expect(runPendingPostgresVerification(f.options)).rejects.toThrow('Pending PostgreSQL verification failed'); const report = JSON.parse(readFileSync(join(f.root, '.local-data/communications/verification/communications-pending-postgres.json'), 'utf8')); expect(report.allTestsExecuted && report.sourceStable).toBe(false); expect(report.migrationsPerformed).toBe(false); expect(report.providerWrites).toBe(0); });
