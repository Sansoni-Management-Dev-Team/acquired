import { cloudflareTest } from '@cloudflare/vitest-plugin';
import { defineConfig } from 'vitest/config';
process.env.WRANGLER_SEND_METRICS = 'false';
process.env.CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV = 'false';
process.env.CLOUDFLARE_INCLUDE_PROCESS_ENV = 'false';
export default defineConfig({
  plugins: [cloudflareTest({
    wrangler: { configPath: new URL('./workflow-tests/wrangler.jsonc', import.meta.url).pathname },
    miniflare: { outboundService: () => new Response('External network blocked in RCA', { status: 503 }) },
  })],
  test: { include: ['cloudflare/research/workflow-tests/field-search-admission.test.ts'], testTimeout: 20000 },
});
