export function config(env) {
  const deployment=env.RESEARCH_DEPLOYMENT||'local';
  if(!['local','digitalocean-test','digitalocean-production'].includes(deployment))throw new Error('Unsupported research deployment');
  // The hosted store retains its original initialized identity when promoted;
  // enabling production callbacks does not rename or migrate that database.
  const databaseName=deployment==='local'?'acquire_research_local':'acquire_research_do_test';
  const databaseMarker=deployment==='local'?'acquire-research-local-only':'acquire-research-do-test-only';
  const database = new URL(env.RESEARCH_DATABASE_URL || '');
  const callback = new URL(env.RESEARCH_APP_ORIGIN || '');
  if (!['postgres:','postgresql:'].includes(database.protocol) || database.pathname !== '/'+databaseName || !['database','127.0.0.1','localhost'].includes(database.hostname)) throw new Error('A dedicated research database is required');
  if (callback.protocol !== 'http:' || !['127.0.0.1','localhost'].includes(callback.hostname) || callback.username || callback.password || callback.pathname !== '/' || callback.search || callback.hash) throw new Error('A loopback callback relay is required');
  if ((env.RESEARCH_SERVICE_SECRET || '').length < 32) throw new Error('A local service secret of at least 32 characters is required');
  if(env.LOCAL_SEARCH_ENGINE!==undefined&&env.LOCAL_SEARCH_ENGINE!=='bing')throw new Error('Unsupported local search engine');
  const searchProvider=env.RESEARCH_SEARCH_PROVIDER||'local';
  const readerProvider=env.RESEARCH_READER_PROVIDER||'crawl4ai';
  if(!['local','tavily'].includes(searchProvider)||!['crawl4ai','tavily'].includes(readerProvider))throw new Error('Unsupported research provider');
  if((searchProvider==='tavily'||readerProvider==='tavily')&&!env.TAVILY_API_KEY)throw new Error('Selected Tavily provider needs its API key');
  return {
    databaseUrl: database.href,
    databaseName,
    databaseMarker,
    deployment,
    RESEARCH_SEARCH_PROVIDER: searchProvider,
    RESEARCH_READER_PROVIDER: readerProvider,
    TAVILY_API_KEY: env.TAVILY_API_KEY,
    APP_ORIGIN: callback.origin,
    SERVICE_SECRET: env.RESEARCH_SERVICE_SECRET,
    FIRMABLE_SEARCH_COUNTRY: 'AU',
    FIRMABLE_SERVICE_SECRET: env.RESEARCH_FIRMABLE_SECRET || env.RESEARCH_SERVICE_SECRET,
    FIRMABLE_CREDENTIAL_KEY: env.RESEARCH_FIRMABLE_CREDENTIAL_KEY,
    LOCAL_DEVELOPMENT: 'true',
    LOCAL_RESEARCH_POLICY: 'local',
    LOCAL_CRAWL4AI_URL: 'http://127.0.0.1:18083',
    LOCAL_SEARCH_URL: 'http://127.0.0.1:7000',
    LOCAL_SEARCH_ENGINE: env.LOCAL_SEARCH_ENGINE,
    LOCAL_SEARCH_REGION: 'AU',
    RESEARCH_AI_PROVIDER: env.RESEARCH_AI_PROVIDER || 'openai',
    OPENAI_API_KEY: env.OPENAI_API_KEY,
    OPENAI_RESEARCH_MODEL: env.OPENAI_RESEARCH_MODEL,
    OPENAI_RESEARCH_FALLBACK_MODEL: env.OPENAI_RESEARCH_FALLBACK_MODEL,
    OPENROUTER_API_KEY: env.OPENROUTER_API_KEY,
  };
}
