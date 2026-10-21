import {expect,it} from 'vitest';
import {firmableEnrichmentConfigured} from './firmable-readiness';
it('selects session service credentials rather than demanding a direct API key',()=>{
 expect(firmableEnrichmentConfigured({TARGET_DATA_PROVIDER:'live',FIRMABLE_TRANSPORT:'cloudflare-session',FIRMABLE_SERVICE_URL:'http://127.0.0.1:8787/firmable',FIRMABLE_SERVICE_SECRET:'synthetic'})).toBe(true);
 for(const missing of ['FIRMABLE_SERVICE_URL','FIRMABLE_SERVICE_SECRET'])expect(firmableEnrichmentConfigured({TARGET_DATA_PROVIDER:'live',FIRMABLE_TRANSPORT:'cloudflare-session',FIRMABLE_SERVICE_URL:'https://service.example.invalid',FIRMABLE_SERVICE_SECRET:'synthetic',FIRMABLE_API_KEY:'old-key',[missing]:' '})).toBe(false);
});
it('retains the direct legacy transport and allows fixtures only when explicitly selected',()=>{
 expect(firmableEnrichmentConfigured({TARGET_DATA_PROVIDER:'live',FIRMABLE_API_KEY:'synthetic'})).toBe(true);
 expect(firmableEnrichmentConfigured({TARGET_DATA_PROVIDER:'live',FIRMABLE_API_KEY:' '})).toBe(false);
 expect(firmableEnrichmentConfigured({TARGET_DATA_PROVIDER:'fixture'})).toBe(true);
 for(const mode of [undefined,'','fixtures','unknown'])expect(firmableEnrichmentConfigured({TARGET_DATA_PROVIDER:mode,FIRMABLE_API_KEY:'synthetic'})).toBe(false);
});
