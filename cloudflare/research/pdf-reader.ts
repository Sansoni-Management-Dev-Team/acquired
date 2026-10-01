import { publicResearchUrl, researchDomain } from '../../src/domain/research';

export const MAX_RESEARCH_PDF_BYTES = 5 * 1024 * 1024;
export type ResearchPdfConverter = {
  toMarkdown(file: {name: string; blob: Blob}): Promise<{format: string; data?: string; error?: string}>;
};

// Browser markdown cannot extract PDF text. Use the documented Workers AI
// conversion binding, with bounded reads and validation before sending bytes.
export async function pdfMarkdown(converter: ResearchPdfConverter | undefined, source: string, fetcher: typeof fetch = fetch): Promise<string> {
  if (!converter) throw new Error('PDF conversion unavailable');
  let url = publicResearchUrl(source);
  if (!url) throw new Error('Unsupported PDF URL');
  const deadline = AbortSignal.timeout(25000);
  let response: Response | undefined;
  for (let redirects = 0; redirects <= 3; redirects++) {
    response = await fetcher(url, {redirect:'manual', signal:deadline, headers:{accept:'application/pdf'}});
    if (response.status < 300 || response.status >= 400) break;
    const location = response.headers.get('location');
    await response.body?.cancel();
    let next: string | null = null;
    try { next = location ? publicResearchUrl(new URL(location, url).href) : null; } catch { /* Invalid redirect. */ }
    if (!next || researchDomain(next) !== researchDomain(source) || redirects === 3) throw new Error('Unsupported PDF redirect');
    url = next;
  }
  if (!response?.ok || !response.body) throw new Error('PDF read failed');
  const length = Number(response.headers.get('content-length') || '0');
  if (length > MAX_RESEARCH_PDF_BYTES) { await response.body.cancel(); throw new Error('PDF exceeds read limit'); }
  if (!/^application\/pdf(?:;|$)/i.test(response.headers.get('content-type') || '')) { await response.body.cancel(); throw new Error('Invalid PDF content type'); }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > MAX_RESEARCH_PDF_BYTES) { await reader.cancel(); throw new Error('PDF exceeds read limit'); }
      chunks.push(chunk.value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  if (new TextDecoder().decode(bytes.slice(0, 5)) !== '%PDF-') throw new Error('Invalid PDF signature');
  const name = new URL(url).pathname.split('/').at(-1) || 'document.pdf';
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const result = await Promise.race([
      converter.toMarkdown({name, blob:new Blob([bytes], {type:'application/pdf'})}),
      new Promise<never>((_, reject) => {timer = setTimeout(() => reject(new Error('PDF conversion timed out')), 25000);}),
    ]);
    if (!['markdown', 'text'].includes(result.format) || !result.data?.trim()) throw new Error('PDF conversion failed');
    return result.data.slice(0, 30000);
  } finally { if (timer) clearTimeout(timer); }
}
