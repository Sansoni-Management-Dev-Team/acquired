import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { expect, it } from 'vitest';
const root = new URL('../', import.meta.url);
const read = (name: string) => readFileSync(new URL(name, root), 'utf8');
const sha = (text: string) => createHash('sha256').update(text).digest('hex');
const commentsRemoved = (text: string) => text.split('\n').filter(line => !line.trimStart().startsWith('--')).join('\n');
const section = (source: string, start: string, end: string) => { const a = source.indexOf(start), b = source.indexOf(end, a); if (a < 0 || b < 0)
    throw Error('Reviewed source boundary missing'); return source.slice(a, b).trim(); };
it('shared application artifacts guard5434 by exact database/operator/system and exclude service objects', () => {
    for (const name of ['001-app-prerequisites.local.sql', '002-send-admission.local.sql']) {
        const sql = commentsRemoved(read('ops/communications/application-shared/' + name));
        expect(sql).toContain("current_database()<>'project_acquire'");
        expect(sql).toContain("current_user<>'project_acquire'");
        expect(sql).toContain("system_identifier::text FROM pg_control_system())<>'7680143844628185121'");
        expect(sql).toContain("to_regnamespace('communications') IS NOT NULL");
        expect(sql).not.toMatch(/\bcommunications\./);
        expect(sql).not.toMatch(/(?:CREATE\s+(?:TABLE|FUNCTION|INDEX|TRIGGER|POLICY)|ALTER\s+TABLE|GRANT\s+[^;]+TO)\s+communications_(?:control|scoped)\b/i);
        expect(sql.trimStart().startsWith('BEGIN;')).toBe(true);
        expect(sql.trimEnd().endsWith('COMMIT;')).toBe(true);
    }
});
it('new prerequisite artifact preserves complete app002 ownership/RLS and only PUBLIC003 consumption bodies', () => {
    const sql = read('ops/communications/application-shared/001-app-prerequisites.local.sql'), binding = read('ops/communications/002-acquire-bindings.local.sql'), consumer = read('ops/communications/003-reply-consumption.local.sql');
    expect(sql).toContain(section(binding, '-- Immutable exact service binding snapshots;', 'COMMIT;'));
    for (const [start, end] of [['ALTER TABLE public.communication_event_receipts', '-- Presence/revision'], ['CREATE TABLE public.communication_consumer_checkpoints', '-- Control repositories MUST'], ['CREATE FUNCTION public.communications_lock_reply_member', 'REVOKE ALL ON FUNCTION communications.lock_reply_barrier'], ['ALTER TABLE public.communication_consumer_checkpoints ENABLE', '-- No DELETE grants, automatic']])
        expect(sql).toContain(section(consumer, start, end));
    expect(sql).toContain('REVOKE ALL ON FUNCTION public.communications_checkpoint_guard(),public.communications_review_guard() FROM PUBLIC;');
    for (const table of ['communication_bindings', 'communication_defaults', 'campaign_channel_bindings', 'campaign_attempt_bindings', 'outreach_draft_bindings', 'communication_reply_monitors', 'communication_event_receipts', 'communication_consumer_checkpoints', 'communication_reply_review_latches']) {
        expect(sql).toContain(`CREATE TABLE public.${table}`);
        expect(sql).toContain(`ALTER TABLE public.${table} FORCE ROW LEVEL SECURITY`);
    }
    expect(sql).toContain("to_regclass('public.communication_bindings') IS NOT NULL");
    expect(sql).toContain('NOT rolsuper AND NOT rolbypassrls AND NOT rolcanlogin');
});
it('shared admission body remains identical to frozen isolated004 after the explicit target guard', () => {
    const original = read('ops/communications/004-send-admission.local.sql'), shared = read('ops/communications/application-shared/002-send-admission.local.sql');
    expect(sha(original)).toBe('9968570f93ff145c137a2d9d165e6d663b28396d9609b36ef3eb8cc031eefb04');
    const start = " IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='acquire_communications_writer')";
    expect(shared.slice(shared.indexOf(start))).toBe(original.slice(original.indexOf(start)));
    expect(shared).toContain("current_database()<>'project_acquire'");
    expect(shared).not.toContain('7694812678792806433');
    expect(shared).not.toContain("current_database()<>'acquire_channels'");
});
it('review documentation keeps isolated/shared migration approval and proof separate', () => { const doc = read('ops/communications/application-shared/README.md'); for (const value of ['127.0.0.1:5434', '7680143844628185121', '127.0.0.1:5445', '7694812678792806433', '127.0.0.1:5446', 'UNAPPROVED', 'UNAPPLIED', 'backup', 'no automatic', 'application-only'])
    expect(doc).toContain(value); });
it('approved isolated sources and declared shared artifacts retain their exact recorded hashes', () => { const manifest = JSON.parse(read('ops/communications/application-shared/source-manifest.json')); expect(manifest.status).toBe('prepared_unapproved_unapplied'); expect(manifest.target).toEqual({ host: '127.0.0.1', port: 5434, database: 'project_acquire', systemIdentifier: '7680143844628185121' }); expect(manifest.sources).toEqual({ 'ops/communications/002-acquire-bindings.local.sql': 'f25cba158289dde111e3aae6038be286b12f1dc4a64db9bf4c94f404259b14cf', 'ops/communications/003-reply-consumption.local.sql': '4f79939442b22109fed2bee069059d8701126170202fa902e9aa6655b039fefd', 'ops/communications/004-send-admission.local.sql': '9968570f93ff145c137a2d9d165e6d663b28396d9609b36ef3eb8cc031eefb04' }); for (const [file, hash] of Object.entries(manifest.sources))
    expect(sha(read(file))).toBe(hash); for (const [file, details] of Object.entries(manifest.artifacts))
    expect(sha(read(file))).toBe((details as {
        sha256: string;
    }).sha256); });
