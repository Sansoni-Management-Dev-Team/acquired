import { expect, it, vi } from 'vitest';
import { pdfMarkdown, MAX_RESEARCH_PDF_BYTES } from './pdf-reader';
const pdf = () => new Response('%PDF-1.7\nsynthetic fixture', { headers: {'content-type':'application/pdf'} });
it('converts actual PDF bytes through the binding and returns identifier evidence', async () => {
  const convert = vi.fn(async () => ({format:'markdown',data:'Headland Technology Pty Ltd\nABN 96 004 338 961'}));
  const fetcher = vi.fn<typeof fetch>().mockResolvedValue(pdf());
  expect(await pdfMarkdown({toMarkdown:convert}, 'https://headland.au/privacy.pdf', fetcher)).toContain('96 004 338 961');
  expect(convert).toHaveBeenCalledWith(expect.objectContaining({name:'privacy.pdf',blob:expect.any(Blob)}));
  expect(fetcher.mock.calls[0][1]).toMatchObject({redirect:'manual'});
});
it('blocks unsafe redirects, oversized documents and disguised HTML before conversion', async () => {
  const convert = vi.fn(async () => ({format:'markdown',data:'data'}));
  await expect(pdfMarkdown({toMarkdown:convert}, 'https://headland.au/privacy.pdf', async()=>new Response('',{status:302,headers:{location:'http://127.0.0.1/private.pdf'}}))).rejects.toThrow('Unsupported PDF redirect');
  await expect(pdfMarkdown({toMarkdown:convert}, 'https://headland.au/privacy.pdf', async()=>new Response('',{headers:{'content-type':'application/pdf','content-length':String(MAX_RESEARCH_PDF_BYTES+1)}}))).rejects.toThrow('PDF exceeds');
  await expect(pdfMarkdown({toMarkdown:convert}, 'https://headland.au/privacy.pdf', async()=>new Response('<html>not PDF</html>',{headers:{'content-type':'application/pdf'}}))).rejects.toThrow('Invalid PDF');
  expect(convert).not.toHaveBeenCalled();
});
it('follows bounded safe redirects and fails explicitly when conversion is unavailable', async () => {
  const convert = vi.fn(async () => ({format:'error',error:'cannot decode'}));
  await expect(pdfMarkdown(undefined,'https://headland.au/privacy.pdf',async()=>pdf())).rejects.toThrow('PDF conversion unavailable');
  const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(new Response('',{status:302,headers:{location:'/legal/privacy.pdf'}})).mockResolvedValueOnce(pdf());
  await expect(pdfMarkdown({toMarkdown:convert},'https://headland.au/privacy.pdf',fetcher)).rejects.toThrow('PDF conversion failed');
  expect(fetcher).toHaveBeenCalledTimes(2);
});

it('rejects a foreign public PDF redirect without claiming first-party provenance', async () => {
  const convert = vi.fn(async () => ({format:'markdown',data:'Other company ABN 96 004 338 961'}));
  const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response('', {status:302,headers:{location:'https://other.example.com/privacy.pdf'}}));
  await expect(pdfMarkdown({toMarkdown:convert}, 'https://headland.au/privacy.pdf', fetcher)).rejects.toThrow('Unsupported PDF redirect');
  expect(fetcher).toHaveBeenCalledOnce();
  expect(convert).not.toHaveBeenCalled();
});
it('permits an ordinary same-company www redirect', async () => {
  const convert = vi.fn(async () => ({format:'markdown',data:'Headland Technology Pty Ltd ABN 96 004 338 961'}));
  const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(new Response('', {status:302,headers:{location:'https://www.headland.au/privacy.pdf'}})).mockResolvedValueOnce(pdf());
  await expect(pdfMarkdown({toMarkdown:convert}, 'https://headland.au/privacy.pdf', fetcher)).resolves.toContain('96 004 338 961');
});
