import { publicResearchUrl } from '../../src/domain/research';
import { localReaderEndpoint, type LocalReaderEnv } from './local-reader';
import { researchFetch } from './local-policy';

type CompanyPageEnv = LocalReaderEnv & { APP_ORIGIN?: string; CRAWL4AI_URL?: string; CRAWL4AI_SECRET?: string };

/** Full-page crawler evidence for the application, using existing Worker credentials. */
export async function companyPage(request: Request, env: CompanyPageEnv, fetcher: typeof fetch = fetch) {
  if (request.method !== 'POST') return Response.json({ error: 'Method not allowed' }, { status: 405, headers: { Allow: 'POST' } });
  const text = await request.text();
  if (text.length > 20000) return Response.json({ error: 'Request too large' }, { status: 413 });
  let input: unknown;
  try { input = JSON.parse(text); } catch { return Response.json({ error: 'Invalid JSON' }, { status: 400 }); }
  const url = input && typeof input === 'object' && 'url' in input && typeof input.url === 'string' ? publicResearchUrl(input.url) : null;
  if (!url) return Response.json({ error: 'Unsupported public URL' }, { status: 400 });
  const local = env.LOCAL_DEVELOPMENT === 'true';
  let endpoint: string;
  try {
    if (!local && (!env.CRAWL4AI_URL || !env.CRAWL4AI_SECRET)) throw Error('Not configured');
    endpoint = local ? localReaderEndpoint(env) : new URL('/crawl', env.CRAWL4AI_URL!).href;
    if (!local && (new URL(endpoint).protocol !== 'https:' || new URL(endpoint).username || new URL(endpoint).password)) throw Error('Invalid service');
  } catch { return Response.json({ error: 'Company page reader unavailable' }, { status: 503 }); }
  try {
    const response = await researchFetch(env, fetcher)(endpoint, {
      method: 'POST', headers: { 'Content-Type': 'application/json', ...(!local ? { authorization: `Bearer ${env.CRAWL4AI_SECRET}` } : {}) },
      body: JSON.stringify({ url, only_main_content: false }), signal: AbortSignal.timeout(35000), redirect: 'manual',
    });
    if (!response.ok) { await response.body?.cancel(); return Response.json({ error: 'Company page reader unavailable' }, { status: 503 }); }
    const reader = response.body?.getReader();
    if (!reader) throw Error('Missing response');
    const chunks: Uint8Array[] = []; let bytes = 0;
    for (;;) {
      const chunk = await reader.read(); if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > 2000000) { await reader.cancel(); throw Error('Response too large'); }
      chunks.push(chunk.value);
    }
    const joined = new Uint8Array(bytes); let offset = 0;
    for (const chunk of chunks) { joined.set(chunk, offset); offset += chunk.byteLength; }
    const data = JSON.parse(new TextDecoder().decode(joined));
    const finalUrl = typeof data.url === 'string' ? publicResearchUrl(data.url) : null;
    if (!finalUrl || data.only_main_content !== false || typeof data.html !== 'string' || !data.html.trim()) throw Error('Invalid full-page contract');
    return Response.json({ url: finalUrl, html: data.html.slice(0, 250000), ...(typeof data.markdown === 'string' ? { markdown: data.markdown.slice(0, 100000) } : {}), truncated: data.truncated === true || data.html.length > 250000 || typeof data.markdown === 'string' && data.markdown.length > 100000, only_main_content: false }, { headers: { 'Cache-Control': 'no-store' } });
  } catch {
    return Response.json({ error: 'Full-page company read failed' }, { status: 502 });
  }
}
