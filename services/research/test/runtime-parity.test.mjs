import{test}from'node:test';import assert from'node:assert/strict';import{publicSettings,containerArchitecture}from'../runtime/parity.mjs';
const base={RESEARCH_DATABASE_URL:'postgresql://research:private-password@database/acquire_research_local',RESEARCH_APP_ORIGIN:'http://127.0.0.1:3100',RESEARCH_SERVICE_SECRET:'private-service-secret'.repeat(3),OPENAI_API_KEY:'private-provider-key',RESEARCH_FIRMABLE_CREDENTIAL_KEY:'private-encryption-key',OPENAI_RESEARCH_MODEL:'same-model'};
test('parity report excludes credentials, database URLs and callback transport differences',()=>{
 const hosted={...base,RESEARCH_DEPLOYMENT:'digitalocean-test',RESEARCH_DATABASE_URL:'postgresql://research:different-password@database/acquire_research_do_test',RESEARCH_APP_ORIGIN:'http://127.0.0.1:3110',RESEARCH_SERVICE_SECRET:'different-secret'.repeat(3)};
 assert.deepEqual(publicSettings(base),publicSettings(hosted));assert.doesNotMatch(JSON.stringify(publicSettings(base)),/private|postgres|secret|key/i);
});
test('parity report detects search-engine and model drift',()=>{
 assert.notDeepEqual(publicSettings(base),publicSettings({...base,LOCAL_SEARCH_ENGINE:'bing'}));
 assert.notDeepEqual(publicSettings(base),publicSettings({...base,OPENAI_RESEARCH_MODEL:'different-model'}));
});

test('reports the actual container architecture for a multi-platform image index',()=>{
 assert.equal(containerArchitecture({ImageManifestDescriptor:{platform:{architecture:'amd64'}}},{Architecture:'arm64'}),'amd64');
 assert.equal(containerArchitecture({}, {Architecture:'amd64'}),'amd64');
});
