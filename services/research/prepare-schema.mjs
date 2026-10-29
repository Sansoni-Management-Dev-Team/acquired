// Emits SQL for review. Never connects to a database or applies migrations.
import {createRequire} from 'node:module';
import {writeFileSync} from 'node:fs';
import {dirname,resolve} from 'node:path';
import {createHash} from 'node:crypto';
const require=createRequire(import.meta.url);
const packageRoot=resolve(dirname(require.resolve('@dbos-inc/dbos-sdk')),'../..');
const {allMigrations}=require(resolve(packageRoot,'dist/src/sysdb_migrations/internal/migrations.js'));
const migrations=allMigrations('dbos');
let sql=`-- Fresh local database only. DBOS 5.3.0 plus research coordinator state.
-- Not a production upgrade script. Apply once, after specific approval.
BEGIN;
DO $$ BEGIN
 IF current_database() <> 'acquire_research_local' THEN RAISE EXCEPTION 'Wrong database'; END IF;
 IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname IN ('dbos','research_service')) THEN RAISE EXCEPTION 'Expected an empty research database'; END IF;
END $$;
CREATE SCHEMA research_service;
CREATE TABLE research_service.identity (singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton), marker text NOT NULL CHECK(marker='acquire-research-local-only'));
INSERT INTO research_service.identity(marker) VALUES ('acquire-research-local-only');
CREATE TABLE research_service.state(namespace text NOT NULL, key text NOT NULL, value jsonb NOT NULL, PRIMARY KEY(namespace,key));
`;
for(const [index,migration] of migrations.entries()) {
  if(!migration.pg?.length)continue;
  sql+=`\n-- SDK migration ${index+1}: ${migration.name || 'unnamed'}\n`;
  for(const statement of migration.pg)sql+=statement.replace(/\bCONCURRENTLY\s+/g,'')+';\n';
}
sql+=`\nDELETE FROM dbos.dbos_migrations;\nINSERT INTO dbos.dbos_migrations(version) VALUES (${migrations.length});\nREVOKE ALL ON SCHEMA research_service, dbos FROM PUBLIC;\nCOMMIT;\n`;
const path='migrations/001-local-research.sql';
writeFileSync(path,sql);
const manifest={target:{database:'acquire_research_local',host:'127.0.0.1',port:5441,marker:'acquire-research-local-only'},sdk:'@dbos-inc/dbos-sdk@5.3.0',sdkSchemaVersion:migrations.length,file:path,sha256:createHash('sha256').update(sql).digest('hex'),note:'Fresh database: online index statements converted to transactional CREATE INDEX. No application schema changes. Not applied.'};
writeFileSync('migrations/manifest.json',JSON.stringify(manifest,null,2)+'\n');console.log(JSON.stringify(manifest));
