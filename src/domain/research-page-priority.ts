import { uniqueResearchUrls } from './research';

/** Core company evidence precedes product catalogues and dated articles. */
export function researchPagePriority(url: string): number {
  const path = new URL(url).pathname.toLowerCase();
  if (/(?:^|\/)(?:about(?:-us)?|company|contact(?:-us)?|team|leadership|management|managing-board|board|directors|our-people|legal|privacy(?:-policy)?|terms)(?:[/.\-_]|$)/.test(path)) return 0;
  if (/\.(?:pdf)$/.test(path)) return 1;
  if (/(?:^|\/)(?:news|blog|articles?|case-studies|events|resources)(?:\/|$)/.test(path)) return 3;
  return 2;
}

export function prioritiseResearchPages(urls: string[]): string[] {
  return uniqueResearchUrls(urls).sort((a, b) => researchPagePriority(a) - researchPagePriority(b) || a.localeCompare(b));
}
